---
name: latex-pdf
description: Render a Markdown document to a nicely-styled PDF (classic-but-tuned Palatino report — fancyhdr header/footer with "Page N of M", subtle dark-blue links, A4, TOC). Use when the user wants to turn Markdown/a PRD/a doc into a polished PDF, or mentions pandoc, xelatex, or LaTeX styling. macOS.
---

# LaTeX PDF (classic-but-tuned Palatino report)

Turn a Markdown document into a polished PDF: classic LaTeX `article` look,
Palatino serif, fancyhdr header/footer with "Page N of M", subtle dark-blue
links, A4. Rendered with pandoc + xelatex.

## How to render

Prefer the MCP tool `render_markdown_to_pdf` (from this plugin's `latex`
server). It builds the tuned `header.tex`, runs pandoc + xelatex, and returns
the output path.

Typical call:

- `markdown_path`: path to the input `.md` (or pass `markdown` inline)
- `title`: left running-header text (document title)
- `header_right`: right running-header text (e.g. "PRD"), or omit
- `open_in`: `"Skim"` to open on success, else `"none"`

Sensible defaults: A4, 11pt, 2.5cm margins, Palatino body, Menlo mono,
link color `#1F4E79`, TOC + numbered sections on.

## Engine (native vs Docker)

`engine` picks how the render runs:

- `auto` (default): use native `pandoc` + `xelatex` if both are on PATH
  (keeps macOS system fonts and `open_in`); otherwise fall back to Docker.
- `native`: force native. Fast, uses your BasicTeX/MacTeX and system fonts.
- `docker`: force the custom image `ghcr.io/gbastkowski/mcp-latex-tex`
  (`docker/Dockerfile`) — `pandoc/latex` with the header's LaTeX packages baked
  in. Reproducible/portable, no local TeX. amd64-only (emulated on Apple
  Silicon). It has no system fonts, so the Palatino/Menlo defaults are dropped
  and xelatex uses Latin Modern.

`open_in` works with either engine because the PDF lands on the host.

## Prerequisites (macOS, one-time)

- `pandoc` (brew), `xelatex` (BasicTeX/MacTeX, in `/Library/TeX/texbin`).
- Fonts Palatino and Menlo ship with macOS.
- BasicTeX is minimal. Install the required packages:
  ```sh
  sudo tlmgr update --self
  sudo tlmgr install fancyhdr lastpage newunicodechar soul xcolor
  ```
  If a render errors with `File 'foo.sty' not found`, run
  `sudo tlmgr install foo` and retry — BasicTeX pulls missing `.sty` one at a time.

## Gotchas

- An **inline code span containing an em-dash or other non-ASCII** breaks the
  render (listings/verbatim chokes on non-ASCII). Keep such notes as prose,
  not code spans.
- Palatino lacks a U+2192 (→) glyph; the header maps it to a math arrow. Other
  exotic glyphs may need the same treatment.

## Manual fallback (no MCP)

If the MCP server is unavailable, render directly — see the partials under `mcp/assets/` (`common.tex.tmpl` plus one
`layouts/*` and one `types/*`, concatenated in that order)
for the header, then:

```sh
pandoc doc.md -o doc.pdf --pdf-engine=xelatex --toc --number-sections \
  --include-in-header=header.tex \
  -V documentclass=article -V papersize=a4 -V fontsize=11pt \
  -V geometry:margin=2.5cm -V mainfont="Palatino" -V monofont="Menlo" \
  -V colorlinks=true -V linkcolor="Blue" -V urlcolor="Blue" -V toccolor="black"
```
