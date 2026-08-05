---
description: Render a Markdown file to a styled PDF (pandoc + xelatex) via the mcp-latex server.
---

Render a Markdown document to a nicely-styled PDF using the
`render_markdown_to_pdf` MCP tool from the `latex` server.

**Input**: `$ARGUMENTS`
- First token: path to the input Markdown file (`$1`).
- Remaining tokens: optional document title used as the left running-header.

**Steps**

1. If no path was given, ask which Markdown file to render.
2. Call `render_markdown_to_pdf` with:
   - `markdown_path`: the resolved input path (`$1`)
   - `title`: the title argument if provided, else omit
   - `header_right`: omit unless the user asked for one
   - `open_in`: `"Skim"` on macOS if the user wants to preview, else `"none"`
   - leave `engine` at its default (`auto`) unless the user asked for `docker`
3. Report the output PDF path the tool returns. On failure, surface the
   tool's stderr (it already includes the tlmgr hint for missing packages).

Keep it to a single render call — do not re-render or tweak styling unless the
user asks. The tuned defaults (Palatino, A4, TOC, numbered sections, "Page N
of M" footer) are intentional.
