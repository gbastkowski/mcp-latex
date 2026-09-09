---
name: reference-doc
version: 1.0.0
description: Write long-form reference documentation for a codebase — read the project, draft a chaptered Markdown reference, and render it to PDF with the `*-reference` preset (report class, chapters, deep TOC, numbered headings). Use when the user wants reference docs, a manual, a handbook, or "document this project as a PDF".
platforms:
  - macos
metadata:
  hermes:
    category: documents
    tags: [pdf, latex, pandoc, markdown, documentation]
---

# Reference documentation for a project

Produce a navigable reference manual for a codebase: read the project, write
`reference.md` with real content, render it with a `<layout>-reference` preset.
The output is a `report`-class PDF — `\chapter` openings, chapter-scoped
numbering (3.1, 3.2), a three-level TOC, running heads carrying chapter left and
section right.

Reference documentation is **scanned, not read start to finish**. Every claim
must be findable, citable by number, and true of the code as it stands. That
constraint drives everything below.

## Ask about the audience first

**Always ask before reading the project.** Audience is not inferable from a
codebase — the same repo yields three different manuals depending on who opens
it, and guessing wrong wastes the whole read phase. Ask even when the request
sounds complete; "document this project" names a target, not a reader.

Put the questions to the user in one round, then proceed
without further interruption:

1. **Who reads this?** — the single highest-leverage answer.
   - *API consumer / integrator* — someone calling it from outside. Endpoints,
     tool schemas, request and response shapes, error codes, auth, limits,
     worked examples. Internal structure is noise to them.
   - *Maintainer / contributor* — someone changing the code. Module layout,
     invariants, extension points, the reasons behind the design, the gotchas
     that bite a newcomer.
   - *Operator / on-call* — someone running it. Configuration, metrics, alerts,
     failure modes, runbook, capacity.
   - *Mixed* — all three, one part per chapter. Say so explicitly, because it
     roughly triples the length and the read phase has to cover every surface.
2. **What is in scope?** — whole repo, one module or service, the public surface
   only. A repo-wide manual for a large codebase is a different job from
   documenting one component.
3. **Assumed background** — can the document take the domain vocabulary and the
   toolchain for granted, or does it define its terms? This decides whether a
   Concepts chapter is a page or a third of the document.

Ask further questions only when the answers leave something genuinely
undecidable — a depth or version question worth a fourth option. Do **not** ask
about styling, fonts or layout: the preset decides those.

Then state the audience and scope back in one line before starting the read, so
a wrong assumption is caught before the expensive part, and record it in the
`Overview` chapter — a reference manual that says who it is for lets the wrong
reader leave early.

## Read the project

Gather facts before writing a line of prose. **The audience answer reorders this
list** — read what that reader needs deeply, and the rest only far enough to
stay honest:

- *API consumer* — the public surface and the errors are the document. Read
  every exported signature, schema and status code; skim internals.
- *Maintainer* — `AGENTS.md`, the module graph and the commit history carry the
  weight, because the *why* lives there and nowhere else.
- *Operator* — configuration defaults, metric and log names, failure paths,
  timeouts and retries. Read the deployment and startup code.

In rough order of value:

1. `AGENTS.md` / `CLAUDE.md` — the maintainers' own account of the design and,
   more usefully, the gotchas. These are the parts a reader cannot derive from
   the source.
2. `README.md` — the intended framing, and the entry points it names.
3. Manifests — `package.json`, `build.sbt`, `Cargo.toml`, `pyproject.toml`,
   `flake.nix`. They give the real module list, the dependencies and the
   commands.
4. The public surface — exported symbols, HTTP routes, CLI subcommands, MCP
   tools, published schemas. Read the actual definitions, not the docs about
   them.
5. Configuration — env vars, config files, defaults. Reference readers look
   these up constantly, so they earn a table.
6. Errors — error types, exit codes, status codes.
7. `git log` for what changed recently, when it explains a surprising shape.

Delegate the sweep when the project is large: a read-only search agent per area
(public API, config, errors, ops) returns the file:line facts without filling
this context with source dumps. Ask each one for **verifiable specifics** —
identifier, path, line, default value — not prose.

Prefer generated truth to remembered truth. If the CLI has a `--help`, run it.
If there is a schema, read it. A default value copied out of the source is worth
more than one recalled from a README that drifted.

## Settle the structure before writing prose

Do not go from the read straight into thirty pages. The outline is cheap to
change and the prose is not: a chapter that turns out to be wrongly placed,
duplicated or missing costs one line to fix now and a rewrite later. Iterate
here, deliberately, before writing a single paragraph of body text.

**Draft the outline** — every `#` and `##`, with a one-line note per section
saying what it will contain and which facts from the read back it. Nothing
longer; this is a plan, not a document.

**Then critique your own draft** and revise it. At least one pass, more while
passes still find something. Check for:

- **Gaps** — a public surface, config group or failure mode from the read that
  no section covers. Every fact worth documenting needs a home, and every
  section needs facts; a section with no backing facts means either a shallow
  read or a chapter invented out of habit.
- **Duplication** — the same thing explained in two chapters. Pick the one place
  a reader would look first and cross-reference from the other.
- **Order** — does a section use a term the document has not defined yet? Move
  the definition earlier or into `Concepts`.
- **Balance** — a chapter with one short section usually belongs as a section of
  its neighbour; a chapter with fifteen wants splitting. Uneven depth is the
  most common outline flaw.
- **Findability** — anything a reader looks up must sit at `###` or above to
  appear in the TOC. A key buried in a paragraph is invisible.
- **Audience fit** — walk the outline as the reader you asked about. Would they
  open each chapter? Cut what they never would.

**Show the revised outline to the user and get agreement before writing the
body.** This is the second and last checkpoint: they see the shape, the chapter
list and the rough page weight, and a structural objection here is cheap.
Present it as a short list, not as a file. If they change it, revise and
continue — do not re-run the read.

After the body is written, check the structure once more against what the prose
actually became: sections often grow past their planned scope, and a heading
that no longer describes its content is worse than no heading. Fix headings and
promote or demote levels then, not during the render.

## Write the Markdown

Structure. Top-level `#` becomes a chapter, `##` a section, `###` a subsection —
and `###` is the deepest level the TOC shows, so anything a reader needs to find
must sit at `###` or above. A workable chapter spine, adapted to the project:

```
# Overview          — what it is, what problem it solves, WHO THIS IS FOR
# Concepts          — the domain vocabulary, defined once and used consistently
# <Surface>         — the API / CLI / tool surface, one chapter per major surface
# <Behaviour>       — the parts with rules worth stating: validation, lifecycle
# Operations        — running it: metrics, alerts, runbook, capacity
# Reference         — the lookup tables: config keys, error codes, glossary
```

The audience decides which of those chapters carry the document and which
shrink to a page — a consumer manual leads with the surface and its errors and
barely mentions internals; a maintainer manual leads with structure and
rationale; an operator manual leads with `Operations` and `Reference`. Cut a
chapter that reader would never open rather than padding it. The `Concepts`
chapter is sized by the assumed-background answer.

Front matter carries the title block:

```markdown
---
title: <Project Name>
subtitle: Reference Documentation
author: <Team>
date: <Month Year>
---
```

Writing rules that matter for this format specifically:

- **Tables for anything enumerable.** Config keys, error codes, CLI flags,
  metric names, status codes. Three columns beat three paragraphs — a reader
  scanning for `ingest.batch.max_size` finds it in a table and misses it in
  prose. Give every key a type and a default.
- **State defaults explicitly**, including the units, and say what happens at
  the boundary.
- **Code fences carry the language tag** — the layouts syntax-highlight. Tag
  Emacs Lisp as `elisp`; the server maps it (skylighting has no elisp grammar).
- **Say why, not just what.** The what is in the source and will drift; the
  reason a batch limit is 10000 is nowhere else. This is the highest-value
  content in the document, and it comes mostly from `AGENTS.md`, commit messages
  and the code's own comments.
- **Cross-reference by heading name**, not page number — the numbers move.
- **No invention.** If the code does not say, the document does not say. Write
  down what is unverified as an explicit gap rather than guessing plausibly;
  a confident wrong default in a reference manual is worse than a missing one.
- Keep an inline code span ASCII-only — an em-dash inside backticks breaks the
  render.

Write to `reference.md` in the project (or `docs/reference.md` if a `docs/`
directory exists), not into a scratch directory: this is a document the project
keeps and re-renders.

## Render

Call `render_markdown_to_pdf` (this plugin's `latex` server):

- `input_path`: the `.md` just written
- `preset`: `classic-reference` by default. `ista-reference` for ista-branded
  work, `eisvogel-reference` for a more modern look. `komabook` is the KOMA
  long-form alternative if the user prefers that typography.
- `title`: the project name — it prints in the footer left
- `doc_version`: a revision string if the user has one (`rev A`, `1.4.0`)
- `logo_path`: only if the user names a logo file. Nothing is auto-discovered.
- `open_in`: `"Skim"` to preview, else `"none"`

Leave `toc`, `number_sections` and `toc_depth` alone. The `reference` type
already forces the TOC on, numbers every heading, and sets depth 3 — these are
not `auto` for this type, so overriding them fights the preset.

`doc_date` defaults to the input file's mtime, which keeps a re-render of an
unchanged document byte-stable. Pass it only to override.

## Verify

A clean exit code means xelatex ran, not that the document is right. Always
check the rendered pages:

```sh
pdftoppm -png -r 100 -f 1 -l 3 reference.pdf /tmp/ref   # title, TOC, first chapter
```

Read those images and confirm:

- The title block shows title, subtitle, date and version — a KOMA subtitle in
  particular has a history of being silently dropped.
- Chapters number from 1, not 0. A `0.1` in the TOC means the top-level division
  did not take.
- The TOC lists chapters, sections and subsections, the page numbers are not all
  identical, and it matches the outline the user agreed to — the TOC is the first
  place a dropped or renamed chapter shows up.
- Tables fit their columns — long `code_tokens` used to overrun.
- Code blocks are highlighted, not flat black.

Also check the page count against the project's size. A four-page "reference"
for a large codebase means the read phase was too shallow, not that the project
is simple.

## Prerequisites

Same as `latex-pdf`: `pandoc` and `xelatex` on PATH for the native engine, or
Docker for the containerised one. Missing `.sty` errors are fixed one package at
a time with `sudo tlmgr install <name>`.
