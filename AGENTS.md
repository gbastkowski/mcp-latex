# AGENTS.md — mcp-latex

Claude Code **plugin** that renders Markdown to a classic-but-tuned Palatino PDF
via pandoc + xelatex. Bundles a skill, a slash command, and a TypeScript MCP
server.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest; declares the MCP server via
  `${CLAUDE_PLUGIN_ROOT}`.
- `.claude-plugin/marketplace.json` — this repo is its own single-plugin
  marketplace.
- `skills/latex-pdf/SKILL.md` — model-invoked skill.
- `commands/render-pdf.md` — user command `/mcp-latex:render-pdf <file> [title]`.
- `mcp/` — MCP server (TypeScript). Tool: `render_markdown_to_pdf`.
- `mcp/assets/header.tex.tmpl` — the tuned LaTeX header (page furniture, glyph
  maps, table-wrap fix). Placeholders `__TITLE__`, `__HEADER_RIGHT__`,
  `__LINK_COLOR__` are substituted at render time.
- `docker/Dockerfile` — custom TeX image `ghcr.io/gbastkowski/mcp-latex-tex`.

## Build / test

The server ships as a **single committed esbuild bundle** at `mcp/dist/index.js`
— Claude Code runs NO build step on install, so the bundle must be present and
current.

```sh
cd mcp
npm install
npm run bundle      # esbuild -> dist/index.js   (rebuild after ANY src edit)
npm run typecheck   # tsc --noEmit
```

Smoke-test the server over stdio by spawning `node dist/index.js` and sending an
`initialize` + `tools/call` JSON-RPC pair (see git history for the harness).
Convert a page to PNG for visual review: `pdftoppm -png -r 110 -f N -l N in.pdf out`.

## Engines

`engine: auto | native | docker` (default `auto`):

- **native** — local `pandoc` + `xelatex` (BasicTeX/MacTeX). Uses macOS system
  fonts (Palatino/Menlo), can `open_in` Skim. Needs the LaTeX packages below.
- **docker** — custom image (`docker/Dockerfile`). amd64-only (emulated on
  Apple Silicon via `--platform linux/amd64`); ships no system fonts, so the
  font vars are dropped and xelatex falls back to Latin Modern. Image is private
  on ghcr; `docker login ghcr.io` must be authed to pull.

## Gotchas (see also memory: pandoc-latex-pdf-gotchas)

- Native prereqs: `sudo tlmgr install fancyhdr lastpage newunicodechar soul xcolor`.
  `soul` is needed for `~~strikethrough~~`.
- Fonts without a glyph render as an empty box; arrows/emoji are mapped in
  `header.tex.tmpl` via `newunicodechar`.
- Long unbreakable `\texttt{...}` tokens overran table columns; `\texttt` is
  redefined in the header to break after underscores.
- TOC depth is `--toc-depth=2` by default (tool arg `toc_depth`).
- `toc` and `number_sections` are tri-state (`auto`|`true`|`false`, default
  `auto`): a doc with fewer than 3 headings renders plain (no TOC, no numbers).

## Config wiring

Registered in dotfiles like the `mcp-emacs` plugin: `dotfiles/claude/settings.json`
(marketplace + enabled), `dotfiles/claude.nix` (plugin list + a ghcr-login
activation). Activate with `home-manager switch`, then restart claude.
