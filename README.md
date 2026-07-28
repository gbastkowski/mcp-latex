# mcp-latex

A Claude Code **plugin** that renders Markdown to a nicely-styled PDF
— classic LaTeX `article` look, tuned: Palatino serif, fancyhdr header/footer
with "Page N of M", subtle dark-blue links, A4 — via **pandoc + xelatex**.

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
| `toc` / `number_sections` | true / true | |
| `engine` | `auto` | `auto` \| `native` \| `docker` |
| `use_host_fonts` | false | Docker: mount macOS fonts read-only |
| `open_in` | `none` | `Skim` \| `Preview` \| `none` |

### Engines

- **native** — local `pandoc` + `xelatex`. Fast, macOS system fonts, can open
  in Skim. Requires BasicTeX/MacTeX + pandoc.
- **docker** — `pandoc/latex` image. Reproducible/portable, no local TeX.
  Palatino/Menlo defaults are swapped to TeX Gyre Pagella / DejaVu Sans Mono,
  unless `use_host_fonts: true` mounts the real macOS fonts in.
- **auto** — native if available, else docker.

## Prerequisites (native, macOS)

```sh
# pandoc + a TeX engine
brew install pandoc
# BasicTeX is minimal — install the packages the header needs:
sudo tlmgr update --self
sudo tlmgr install fancyhdr lastpage newunicodechar xcolor
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
