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
- `mcp/assets/` — the LaTeX header, split into three composable pieces (see
  **Presets** below). Placeholders `__TITLE__`, `__HEADER_RIGHT__` and
  `__LINK_COLOR__` are substituted at render time.
- `docker/Dockerfile` — custom TeX image `ghcr.io/gbastkowski/mcp-latex-tex`.
- `hosts/` — ports for non-Claude MCP hosts (opencode, hermes) + `install.sh`.

## Non-Claude hosts (`hosts/`)

The MCP server itself is host-agnostic: plain stdio, no Claude APIs, and it
resolves `assets/` relative to `import.meta.url`, so any
launcher works. Other hosts have no `${CLAUDE_PLUGIN_ROOT}`, so they launch it
via `npx -y github:gbastkowski/mcp-latex` — no local checkout and no build,
because `mcp/dist/index.js` is committed and the **root** `package.json`
exposes it as `bin: mcp-latex-server`.

That root manifest declares **no `scripts`** on purpose: npm runs `prepare` on
git installs, and `mcp/package.json`'s `prepare` would kick off an esbuild
bundle that needs devDependencies. Keep it script-free.

Only the skill's manual-fallback path is localised — `__MCP_LATEX_ROOT__` is
substituted with the repo path by `hosts/install.sh`.

```sh
./hosts/install.sh opencode            # ./.opencode + ./opencode.json in $PWD
./hosts/install.sh opencode --global   # ~/.config/opencode
./hosts/install.sh hermes              # ~/.hermes  (then /reload-mcp)
```

- **opencode** — `opencode.json` `mcp.latex` (`type: local`, `command` array);
  command → `commands/latex-pdf.md`, skill → `skills/latex-pdf/SKILL.md`.
  Plural dir names are current; singular is legacy-compatible.

  opencode's command namespace is flat (the filename *is* the command), so the
  ports are prefixed `latex-` to group future siblings. Claude Code namespaces
  plugin commands itself, so `commands/render-pdf.md` keeps its name rather
  than becoming `/mcp-latex:latex-pdf`.
- **hermes** — `~/.hermes/config.yaml` under `mcp_servers.latex`; skills live in
  `~/.hermes/skills/` (agentskills.io standard, so SKILL.md ports as-is plus a
  `version:` field). `hermes mcp add` is the interactive equivalent.

The installer never rewrites an existing config in place: if `opencode.json`
exists, or `config.yaml` already has `mcp_servers`, it prints the block to
stderr for manual merging instead. Re-running is safe.

Keep the three SKILL.md copies in sync when editing `skills/latex-pdf/SKILL.md`
— the ports differ only in frontmatter and two host-neutral wording fixes.

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
  `common.tex.tmpl` via `newunicodechar`.
- Long unbreakable `\texttt{...}` tokens overran table columns; `\texttt` is
  redefined in the header to break after underscores.
- TOC depth is `--toc-depth=2` by default (tool arg `toc_depth`).
- `toc`, `number_sections` and `shift_headings` are tri-state
  (`auto`|`true`|`false`, default `auto`).
- The TOC heuristic counts **entries the TOC would actually show**, not total
  headings: at least 4 entries at or above `toc_depth` and at least 3 top-level
  sections. A total-heading threshold gave a TOC to one-page notes with a single
  section and four subsections. It also accounts for `shift_headings`, since
  promotion changes which source levels land in the TOC.
- `sectsty` and `titlesec` are NOT in BasicTeX — layouts patch headings with
  `\@startsection` instead.
- Colouring a heading needs `\let\normalcolor\relax` in the style argument:
  with `--number-sections` the section-number box restores `\normalcolor` and
  resets the heading to black mid-line.
- pandoc sets only `mainfont`/`monofont`, never `sansfont`. A layout using
  `\sffamily` must set one itself or `\sffamily` silently falls back to Latin
  Modern Sans, which clashes with Palatino. Guard with `\IfFontExistsTF`.
- `\newfontfamily` on a missing font is a hard error — probe with
  `\IfFontExistsTF` *before* declaring, not after.
- Redefining `\maketitle` to use `\@title`/`\@date` must sit inside
  `\makeatletter`…`\makeatother`, else xelatex dies with "You can't use
  `\spacefactor` in vertical mode".
- `multicol` is deliberately unused: pandoc emits tables as `longtable`, which
  hard-errors inside `multicols` ("longtable not in 1-column mode"), and code
  blocks clip at a narrow measure.

## Presets

Styling is a `preset` string, `<layout>-<type>`, split on the FIRST dash and
composed as `common.tex.tmpl` + `types/<type>` + `layouts/<layout>` — layout last
so it can override the furniture the type set up. Adding a file to
`assets/layouts/` or `assets/types/` is enough; there is no registry to update
and no code change. An invalid preset returns the full list of valid combinations.

`TYPE_DEFAULTS` in `mcp/src/index.ts` lets a type override the `auto` tri-states
where the LaTeX cannot — a `newspaper` has to refuse the TOC there, because a
partial cannot decline pandoc's `--toc` flag.

Demos: `scratchpad/render-demos.py` renders all 6 presets **through the server**
over JSON-RPC (not by assembling pandoc calls, which would skip preset
composition, type defaults and heading shift). Reports and newspapers use
different source documents, since a technical doc says nothing about whether a
masthead works.

## Config wiring

Registered in dotfiles like the `mcp-emacs` plugin: `dotfiles/claude/settings.json`
(marketplace + enabled), `dotfiles/claude.nix` (plugin list + a ghcr-login
activation). Activate with `home-manager switch`, then restart claude.
