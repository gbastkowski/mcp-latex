# Preset demos

Renders every `<layout>-<type>` preset from source material shaped like the
thing that type is for, so a styling change can be judged by looking at it.

```sh
cd mcp && npm run bundle && cd ..    # the script uses dist/, not src/
python3 demos/render.py              # all 15 presets -> demos/out/
python3 demos/render.py --open       # ...and open them in Skim (macOS)
python3 demos/render.py ista-newspaper classic-koma   # just these
```

Output goes to `demos/out/`, which is git-ignored. The paths are stable, so a PDF
left open in a viewer reloads in place while templates are being tuned.

## Why it goes through the server

The script speaks JSON-RPC to `mcp/dist/index.js` instead of calling pandoc
itself. Driving pandoc directly would skip preset composition, the per-type
defaults and the heading shift — the PDFs would look plausible while no longer
reflecting what an MCP client actually gets.

For the same reason it checks the preset the server echoes back. Leaving the
`preset` argument out does not fail: the server falls back to `classic-report`
and cheerfully reports success, so every demo comes out as a well-rendered copy of
the wrong preset. That happened once; hence the assertion.

## Sources

| file | used by | why |
|---|---|---|
| `sources/report.md` | `report`, `koma` | headings several levels deep, tables with long identifiers, code in five languages |
| `sources/newspaper.md` | `newspaper` | front page: headline, deck, byline, markets table, letters, engravings |
| `sources/reference.md` | `reference`, `komabook` | eight chapters, ~28 pages — enough to show chapter openings and a deep TOC |

The KOMA types reuse their standard-class counterpart's source on purpose, so the
comparison is like-for-like: same copy, different typography.

`img/` holds the newspaper engravings as vector PDFs, with their TikZ sources.
Regenerate with `xelatex fig-portrait.tex` (and so on) — `standalone` and
`pdfcrop` are not in BasicTeX, so each source sets a small papersize instead.

## Verifying by eye

A clean exit code proves TeX finished, not that the styling applied. Several
things have compiled perfectly while doing nothing at all — `\MakeUppercase` in an
`\@startsection` argument, a heading colour reset by the section-number box,
`\bfseries` on a family with no bold. Render a page and look:

```sh
pdftoppm -png -r 100 -f 2 -l 2 demos/out/ista-report.pdf page
pdffonts demos/out/ista-report.pdf     # which faces actually got embedded
pdftotext demos/out/ista-report.pdf -  # text transforms, e.g. small caps
```
