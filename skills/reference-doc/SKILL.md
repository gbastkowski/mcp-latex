---
name: reference-doc
description: Write long-form reference documentation for a codebase — read the project, draft a chaptered Markdown reference, and render it to PDF with the `*-reference` preset (report class, chapters, deep TOC, numbered headings). Use when the user wants reference docs, a manual, a handbook, or "document this project as a PDF".
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

The reader is a technical professional; this is not a user manual. Do not ask
whether to explain programming, and do not budget pages for it. What varies is
**focus** — which part of the system they came for — and **seniority** — how
much of this particular stack they already carry.

Put the questions to the user in one round (`AskUserQuestion`), then proceed
without further interruption:

1. **Who reads this?** — the focus axis, and the single highest-leverage answer.
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
3. **How senior is this reader in this stack?** — not general experience, but
   fluency in the specific technologies and conventions this project is built
   on. Name them in the question rather than asking abstractly, so the answer
   is about this project and not about programming: the language and framework,
   the protocol or build tool, the house patterns.
   - *New to the stack* — competent engineer, first contact with these
     technologies. Explain the project's use of them: which framework concepts
     the code leans on, what the build produces, which conventions are load
     bearing. Not the technologies themselves — link their own documentation.
   - *Familiar* — uses them, has not internalised this project's idioms. Name
     the non-obvious choices and move on.
   - *Fluent* — writes this stack daily. Assume all of it; the document is
     about what is specific to this codebase and nothing else.

Ask further questions only when the answers leave something genuinely
undecidable — a depth or version question worth a fourth option. Do **not** ask
about styling, fonts or layout: the preset decides those.

**The seniority answer mostly tells you what to leave out**, and that half is
the one that gets ignored. Padding a manual with what the reader already knows
trains them to skim, and then they skim past the part that mattered. So: never
explain a language feature, a framework primitive or a standard tool. Explain
this project's use of them, and only as far down as the answer warrants — a
sentence for a fluent reader, a subsection for one new to the stack. Project
specific vocabulary — invented abstractions, domain nouns, words with a local
meaning — is defined at every level, because no amount of seniority elsewhere
supplies it.

Then state the audience, scope and seniority back in one line before starting
the read, so a wrong assumption is caught before the expensive part, and record
it in the `Overview` chapter — a reference manual that says who it is for lets
the wrong reader leave early.

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

While reading, keep a list of the terms this project uses as if they were
obvious — invented abstractions, domain nouns, overloaded words with a local
meaning. Those are the `Concepts` entries. They are easier to spot now, on first
contact, than after the codebase has made them feel obvious to you too.

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
- **Nothing they already know** — the other direction, and the one that gets
  skipped: a section teaching the framework, the language or a standard tool.
  Cut it and reclaim the pages for what is specific to this codebase.

**Show the revised outline to the user and get agreement before writing the
body.** This is the second and last checkpoint: they see the shape, the chapter
list and the rough page weight, and a structural objection here is cheap.
Present it as a short list, not as a file. If they change it, revise and
continue — do not re-run the read.

## Write chapter by chapter

A reference manual for a real codebase runs long — a hundred pages is ordinary.
One context writing all of it start to finish degrades: the later chapters drift
from the earlier vocabulary, and the whole thing is serial. Above roughly six
chapters or twenty pages, **fan the writing out, one agent per chapter**. Below
that, write it inline; the coordination costs more than it returns.

Chapters live as separate files under `docs/chapters/`, named `NN-slug.md` in
reading order — `01-overview.md`, `02-concepts.md`. Separate files are easier to
review and to re-generate one at a time, and they keep a long document out of
this context.

### Pin the vocabulary first

**Write `Concepts` before fanning out**, in one pass, and do not parallelise it.
It is the shared vocabulary: if two chapter agents invent two names for the same
abstraction, every later chapter inherits the split. Everything downstream reads
it as fixed.

### One agent per chapter

Spawn the chapter agents concurrently — independent work, one message, several
tool calls. Each one gets:

- its chapter's headings from the agreed outline, and nothing about other
  chapters' internals
- the facts from the read that back those headings, as file:line specifics
- the audience, scope and seniority answers
- the finished `Concepts` terms, as fixed vocabulary it must use and must not
  redefine
- the writing rules below
- the full chapter list — titles and file names only — so it knows what exists
  to refer to

Each returns its chapter file **and a short manifest**:

- the headings it actually wrote, so other chapters can link to them
- any term it introduced that is not already in `Concepts`
- **cross-references it wants** — "something should explain retry backoff; I did
  not write it" — named by topic, not by section number

Subagents cannot talk to each other and cannot come back mid-run for an answer.
Coordination goes through you, between rounds, which is why the manifest matters
more than it looks.

### Resolve the cross-references, then a second round

Collect the manifests and resolve them yourself — this is bookkeeping, not a job
for another agent:

- a wanted reference that **matches a heading** another chapter declared becomes
  a link by heading name
- a wanted reference that **matches nothing** is a gap: assign it to the chapter
  where it belongs, or accept it as an explicit gap
- **two chapters explaining the same thing** — pick the one a reader reaches
  first, and cut the other down to a cross-reference
- **a term coined twice** — pick one, and push it back into `Concepts`

Then respawn **only the chapters that changed**, with their resolution spelled
out ("backoff is §4.2 *Retry policy* — link it, drop your own version"). Two
rounds converge in practice, because the outline already fixed the boundaries.

### Assemble

Concatenate the chapter files in order into `reference.md` at the project root
(or `docs/reference.md` where a `docs/` exists), front matter first. Pandoc has
no include mechanism — it accepts multiple input files and joins them itself,
but this plugin's server takes a single `input_path`, so the concatenation has
to happen before the render.

`reference.md` is a build product. The chapter files are the source that gets
reviewed and re-generated; say so to the user, so nobody edits the concatenated
file and loses it on the next run.

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
chapter that reader would never open rather than padding it.

`Concepts` holds this project's own vocabulary, never a primer on the
technologies it uses. Its length follows the seniority answer — a page for a
fluent reader, a chapter where the stack's conventions need placing — but its
subject does not change.

Front matter carries the title block, and belongs at the top of the assembled
`reference.md` — not in a chapter file:

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
- **Assume the stack, define the project.** Use the language's and the
  framework's terms bare. Define this codebase's own terms on first use. When a
  passage explains something the reader already knows, delete it — do not demote
  it to a footnote.
- **Cross-reference by heading name**, not page number — the numbers move, and a
  chapter written in isolation cannot know them. This is what makes
  independently written chapters compose.
- **No invention.** If the code does not say, the document does not say. Write
  down what is unverified as an explicit gap rather than guessing plausibly;
  a confident wrong default in a reference manual is worse than a missing one.
- Keep an inline code span ASCII-only — an em-dash inside backticks breaks the
  render.

## Check the whole document

Concatenation is not a document. Read the assembled `reference.md` end to end
once, whatever wrote it — this pass is required after a fan-out and worth it
after an inline write:

- **Every cross-reference resolves** to a heading that exists, spelled the way
  the target spells it. This is the failure mode of parallel authoring, and the
  one a reader hits hardest.
- **No duplicate explanations** — two chapters covering the same ground, each
  written without seeing the other.
- **Terminology is consistent** — one name per concept, matching `Concepts`.
- **The seams read** — chapter openings that repeat the previous chapter's
  setup, or assume a paragraph that ended up elsewhere.
- **Headings still describe their content** — sections grow past their planned
  scope, and a heading that no longer fits is worse than none. Fix headings and
  promote or demote levels here, before the render.

Fix these in the chapter files, then re-assemble. Editing the concatenated file
loses the fix on the next run.

## Render

Call `render_markdown_to_pdf` (this plugin's `latex` server):

- `input_path`: the assembled `reference.md`
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
  place a dropped or renamed chapter shows up. After a fan-out it is also where a
  chapter file left out of the concatenation shows up.
- Tables fit their columns — long `code_tokens` used to overrun.
- Code blocks are highlighted, not flat black.

Also check the page count against the project's size. A four-page "reference"
for a large codebase means the read phase was too shallow, not that the project
is simple.

## Prerequisites

Same as `latex-pdf`: `pandoc` and `xelatex` on PATH for the native engine, or
Docker for the containerised one. Missing `.sty` errors are fixed one package at
a time with `sudo tlmgr install <name>`.
