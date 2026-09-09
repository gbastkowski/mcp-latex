---
description: Write long-form reference documentation for a project and render it to PDF via the mcp-latex server.
---

Write reference documentation for a codebase and render it with a
`<layout>-reference` preset, following the `reference-doc` skill.

**Input**: `$ARGUMENTS`
- First token: the path or scope to document (`$1`). Defaults to the current
  project when omitted.
- Optional second token: a preset (`classic-reference`, `ista-reference`,
  `eisvogel-reference`). Defaults to `classic-reference`.

**Steps**

1. **Ask about the audience before reading anything**, in one round: who reads it (API consumer / maintainer / operator / mixed), what is
   in scope (whole repo, one module, public surface only), and how much
   background to assume. Audience is not inferable from a codebase and decides
   what the whole document contains — ask even when the request sounds complete.
   Do not ask about styling; the preset decides that.
2. Read the project for facts, weighted by that answer: `AGENTS.md`/`CLAUDE.md`
   (design and gotchas), `README.md`, the manifests, the public surface
   (exports, routes, CLI subcommands, MCP tools), configuration defaults, error
   codes. A consumer manual needs the surface read exhaustively; a maintainer
   manual needs the rationale and the module graph; an operator manual needs
   config, metrics and failure paths. Delegate the sweep to read-only search
   agents when the codebase is large, and ask each for file:line specifics
   rather than prose.
3. **Settle the structure before writing prose.** Draft an outline — every `#`
   and `##` with a one-line note per section — then critique and revise it:
   gaps (a fact from the read with no home), duplication, term order, balance
   (a one-section chapter belongs as a section), findability (`###` or above to
   reach the TOC), audience fit. Show the revised outline to the user and get
   agreement before writing the body; a structural objection is cheap now and a
   rewrite later. If they change it, revise — do not re-run the read.
4. Write `reference.md` (or `docs/reference.md` where a `docs/` exists) with
   pandoc front matter and a chapter spine: `#` per chapter, `##` per section,
   `###` per subsection — `###` is the deepest level the TOC shows. Weight the
   chapters to the audience and cut the ones that reader would never open; say
   in `Overview` who the document is for. Put anything enumerable in a table
   with type and default. Say *why*, not only *what*. Do not invent a default
   the code does not state.
5. Re-check the structure against what the prose became — sections grow past
   their planned scope, and a heading that no longer describes its content is
   worse than none. Fix headings and levels here, before the render.
6. Call `render_markdown_to_pdf` with `input_path`, `preset`, `title` (the
   project name), `doc_version` if the user has one, and `open_in: "Skim"` when
   they want a preview. Leave `toc`, `toc_depth` and `number_sections` at their
   defaults — the `reference` type already forces TOC, depth 3 and numbering.
7. Verify by pixels, not by exit code:
   `pdftoppm -png -r 100 -f 1 -l 3 reference.pdf /tmp/ref` and read the images.
   Check the title block carries subtitle/date/version, chapters number from 1
   (a `0.1` means the top-level division did not take), the TOC has three
   levels, and tables fit their columns.
8. Report the PDF path and anything the read phase could not verify, listed as
   explicit gaps.
