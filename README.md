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
  assets/header.tex.tmpl       tuned Palatino page furniture
```

## The tool

`render_markdown_to_pdf` — key arguments:

| arg | default | notes |
|-----|---------|-------|
| `markdown_path` / `markdown` | — | input file, or inline source |
| `output_path` | `<input>.pdf` | |
| `title` | "" | left running-header |
| `header_right` | "" | right running-header, e.g. `PRD` |
| `main_font` / `mono_font` | Palatino / Menlo | |
| `papersize` / `fontsize` / `margin` | a4 / 11pt / 2.5cm | |
| `link_color` | `1F4E79` | hex, no `#` |
| `toc` / `number_sections` | auto / auto | `auto`\|`true`\|`false`; auto = on only with ≥3 headings |
| `engine` | `auto` | `auto` \| `native` \| `docker` |
| `open_in` | `none` | `Skim` \| `Preview` \| `none` |

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
3. **Build `header.tex`** — the template `mcp/assets/header.tex.tmpl` with three
   placeholders substituted: `__TITLE__`, `__HEADER_RIGHT__`, `__LINK_COLOR__`.
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
- **`header.tex.tmpl` is the styling brain** — fancyhdr furniture, a
  `newunicodechar` glyph map (arrows, emoji), and a breakable `\texttt` so long
  identifiers wrap in table cells. The server only substitutes placeholders.
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
./hosts/install.sh opencode                         # ./.opencode/ + ./opencode.json
./hosts/install.sh opencode --global                # ~/.config/opencode/
./hosts/install.sh hermes                           # $HERMES_HOME or ~/.hermes/
./hosts/install.sh hermes --profile gunnar          # ~/.hermes/profiles/gunnar/
```

| host | MCP config | skill | command |
|------|-----------|-------|---------|
| Claude Code | `.claude-plugin/plugin.json` | `skills/latex-pdf/` | `/mcp-latex:render-pdf` |
| opencode | `opencode.json` → `mcp.latex` | `.opencode/skills/latex-pdf/` | `/render-pdf` |
| hermes | `$HERMES_HOME/config.yaml` → `mcp_servers.latex` | `$HERMES_HOME/skills/latex-pdf/` | `/latex-pdf` (skill) |

If the target config already exists, the installer prints the block to merge
rather than overwriting it. For Hermes, `$HERMES_HOME` is profile-aware: it is
`~/.hermes` for the default profile and `~/.hermes/profiles/<name>` for a named
profile (or pass `--home` to override). The templates live in `hosts/opencode/`
and `hosts/hermes/` if you prefer to wire it up by hand.

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
