# mcp-latex

A Claude Code **plugin** that renders Markdown to a nicely-styled PDF
— classic LaTeX `article` look, tuned: Palatino serif, a fancyhdr running
header with an `N/M` page marker, subtle dark-blue links, A4 — via
**pandoc + xelatex**.

It bundles two things:

- a **skill** (`skills/latex-pdf/`) that tells Claude when and how to render;
- an **MCP server** (`mcp/`, TypeScript) exposing the tool
  `render_markdown_to_pdf`, usable from any MCP client.

## Layout

```
.claude-plugin/plugin.json    plugin manifest (declares the MCP server)
skills/latex-pdf/SKILL.md      instructions, prerequisites, gotchas
mcp/                           TypeScript MCP server
  src/index.ts                 render_markdown_to_pdf tool
  assets/common.tex.tmpl       glyph maps + table-wrap fix (shared)
  assets/layouts/              fonts, colour, page furniture
  assets/types/                document structure
```

## The tool

`render_markdown_to_pdf` — key arguments:

| arg | default | notes |
|-----|---------|-------|
| `input_path` / `input` | — | input file, or inline source (aliases: `markdown_path` / `markdown`) |
| `input_format` | `auto` | `auto`\|`markdown`\|`org`; auto infers from the extension |
| `preset` | `classic-report` | `<layout>-<type>`; see **Presets** below |
| `output_path` | `<input>.pdf` | |
| `title` | "" | left running-header |
| `header_right` | "" | right running-header, e.g. `PRD` |
| `main_font` / `mono_font` | Palatino / Menlo | |
| `papersize` / `fontsize` / `margin` | a4 / 11pt / 2.5cm | some types override `margin` — a newspaper runs to 1cm |
| `link_color` | `1F4E79` | hex, no `#` |
| `toc` | `auto` | `auto`\|`true`\|`false`; auto = on only when the TOC would have something to navigate |
| `number_sections` | `auto` | `auto`\|`true`\|`false`; auto = on above 3 headings |
| `logo_path` | "" | image: flanks the newspaper nameplate, or sits above the title on page one for other types |
| `doc_date` | "" | creation date in the page furniture; empty = the input file's mtime, `none` = omit |
| `doc_version` | "" | version shown beside the date, e.g. `v2.1` or a git SHA |
| `shift_headings` | `auto` | `auto`\|`true`\|`false`; auto promotes when a lone H1 is the title |
| `engine` | `auto` | `auto` \| `native` \| `docker` |
| `open_in` | `none` | `Skim` \| `Preview` \| `none` |

### Presets

Styling is a `preset` named `<layout>-<type>`. **Layout** owns fonts, colour and
page furniture; **type** owns structure. Any layout composes with any type, and
an invalid name returns the list of valid ones.

#### Which type?

| type | use it for | what sets it apart |
|---|---|---|
| `report` | **the default.** One-off documents up to ~30 pages: specs, PRDs, notes, analyses | flat sections, TOC only when there is something to navigate |
| `reference` | long-form documentation, tens to hundreds of pages | chapters, chapter-scoped numbering (`3.1`, not one long run), three-level TOC always on |
| `koma` | like `report`, for typographically fussy or German-language work | KOMA-Script: type area computed from paper and font size, so a wider and more even measure than a fixed margin gives |
| `komabook` | like `reference`, same reasoning | KOMA-Script with chapters |
| `newspaper` | documents actually meant to look like a newspaper | landscape, three columns, Didot masthead, small-caps headlines, no TOC |

Reach for `report` unless another type clearly fits. `reference` earns its
chapters somewhere past twenty pages; below that the extra structure is noise.
`newspaper` is the wrong shape for anything with code blocks or wide tables — a
third of a landscape page cannot hold them.

#### Which layout?

| layout | use it for | what sets it apart |
|---|---|---|
| `classic` | anything with no house style to follow | Palatino body, black Helvetica Neue headings, no header rule |
| `ista` | ista work | navy Optima headings, navy links, mint table rules, code tokens in the brand palette |
| `eisvogel` | matching Eisvogel output produced elsewhere | approximates the well-known pandoc template: slate accent, thin header rule, centred folio |

The two axes are independent, so `ista-reference` is ista branding on a long
document and `eisvogel-report` is the Eisvogel look on a short one.

A type may also set the document class, class options, body font and page margin
— a newspaper is not set in a book face, and `article` has no `\chapter` for a
reference to use. Some types override the `auto` defaults too: a newspaper never
gets a TOC or numbered sections whatever the heading count, and a reference always
does. An explicit `true`/`false` still wins.

### Heading promotion

With `shift_headings: auto` (the default), a document with exactly one top-level
heading and something beneath it has every heading promoted one level: that H1
becomes the PDF's title rather than a numbered section competing with its own
children, and the H2s become top-level sections. For the `newspaper` type this is
also what feeds the masthead.

### Engines

- **native** — local `pandoc` + `xelatex`. Fast, uses the macOS system fonts
  (Palatino/Menlo), can open in Skim. Requires BasicTeX/MacTeX + pandoc.
- **docker** — the custom image `ghcr.io/gbastkowski/mcp-latex-tex`
  (`docker/Dockerfile`): `pandoc/latex` + the header's LaTeX packages baked in.
  Reproducible/portable, no local TeX. amd64-only, so on Apple Silicon it runs
  under emulation. The image ships no system fonts, so the Palatino/Menlo
  defaults are dropped and xelatex falls back to Latin Modern (pass an explicit
  `main_font`/`mono_font` only if you know it exists in the image).
- **auto** — native if available, else docker.

## How it works

The MCP server is a single stdio process exposing one tool,
`render_markdown_to_pdf`. It has no network access and no state — each call is
self-contained. It is built on `@modelcontextprotocol/sdk`: an `McpServer`
wired to a `StdioServerTransport`, with the tool registered under a `zod`
schema so arguments are validated before the handler runs.

A render request runs through seven steps:

1. **Resolve input** — either a `markdown_path` or inline `markdown`. Inline
   source is written to a temp file first.
2. **Pick engine** — `auto` uses native when `pandoc` and `xelatex` are on
   PATH, else docker; `native`/`docker` force one.
3. **Compose `header.tex`** — from the `preset`: `common.tex.tmpl`, then
   `types/<type>.tex.tmpl`, then `layouts/<layout>.tex.tmpl`, concatenated in
   that order so the layout can override the furniture its type set up. Three
   placeholders are substituted: `__TITLE__`, `__HEADER_RIGHT__`, `__LINK_COLOR__`.
4. **Build pandoc args** — `--pdf-engine=xelatex`, the include-header, TOC
   (`--toc --toc-depth=N`), numbered sections, and `-V` variables for fonts,
   paper size, margins and link colours.
5. **Run** — native spawns `pandoc` directly; docker stages the input and
   header into a scratch dir, mounts it at `/data`, runs the container with
   `--platform linux/amd64`, then copies `/data/out.pdf` back to the host.
6. **Open (optional)** — `open_in` runs `open -a <App>` on the result.
7. **Return** — the output path and engine used, or the captured stderr plus a
   tlmgr hint on failure.

Notable design points:

- **One engine abstraction** — a single `buildPandocArgs()` feeds both engines;
  only the paths differ (host absolute paths vs `/data/...` in the container).
- **The assets are the styling brain** — `common.tex.tmpl` holds what every
  preset needs (a `newunicodechar` glyph map for arrows and emoji, a breakable
  `\texttt` so long identifiers wrap in table cells, and ligature suppression in
  monospace so `--` in code stays two hyphens). `layouts/*` own fonts, colour and
  page furniture; `types/*` own structure. The server only concatenates them and
  substitutes placeholders — adding a layout or type needs no code change.
- **Scratch dir** — `mkdtemp` per call, removed in a `finally`; docker needs the
  input and header co-located under one mount, so they are staged there.
- **Packaging** — the server is esbuild-bundled to a single `dist/index.js`
  with no runtime `node_modules`, so it loads with no install step.

## Other MCP hosts (opencode, hermes)

The server is a plain stdio MCP process with no Claude-specific API, so other
hosts can use it directly. They launch it straight from GitHub — no checkout, no
build step, since `mcp/dist/index.js` is committed and the root `package.json`
exposes it as a `bin`:

```json
"latex": { "type": "local", "command": ["npx", "-y", "github:gbastkowski/mcp-latex"] }
```

`hosts/install.sh` writes that config plus a ported skill/command:

```sh
./hosts/install.sh opencode            # ./.opencode/ + ./opencode.json
./hosts/install.sh opencode --global   # ~/.config/opencode/
./hosts/install.sh hermes              # ~/.hermes/  (then /reload-mcp)
```

| host | MCP config | skill | command |
|------|-----------|-------|---------|
| Claude Code | `.claude-plugin/plugin.json` | `skills/latex-pdf/` | `/mcp-latex:render-pdf` |
| opencode | `opencode.json` → `mcp.latex` | `.opencode/skills/latex-pdf/` | `/latex-pdf` |
| hermes | `~/.hermes/config.yaml` → `mcp_servers.latex` | `~/.hermes/skills/latex-pdf/` | `/latex-pdf` (skill) |

If the target config already exists, the installer prints the block to merge
rather than overwriting it. The templates live in `hosts/opencode/` and
`hosts/hermes/` if you prefer to wire it up by hand.

## Prerequisites (native, macOS)

```sh
# pandoc + a TeX engine
brew install pandoc
# BasicTeX is minimal — install the packages the header needs:
sudo tlmgr update --self
sudo tlmgr install fancyhdr lastpage newunicodechar soul xcolor
```

If a render errors with `File 'foo.sty' not found`, run
`sudo tlmgr install foo` and retry.

## Build the server

```sh
cd mcp
npm install
npm run build   # -> dist/index.js
```

The plugin manifest launches `node ${CLAUDE_PLUGIN_ROOT}/mcp/dist/index.js`.

## Gotchas

- An **inline code span containing an em-dash / non-ASCII** breaks the render
  (verbatim chokes on non-ASCII). Keep such notes as prose.
- Palatino has no U+2192 (→) glyph; the header maps it to a math arrow.
