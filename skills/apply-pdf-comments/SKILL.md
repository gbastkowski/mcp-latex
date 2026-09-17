---
name: apply-pdf-comments
description: Read the highlights and comments a human left on a rendered PDF and revise the source document from them. Use when the user says they annotated, commented on, marked up, or highlighted a PDF, asks you to "apply my comments", or wants review feedback from a PDF fed back into the Markdown/Org source. Also for simply listing what annotations a PDF contains.
---

# Apply PDF comments

The return leg of a render. A document goes out as a PDF, someone reads it on a
tablet and marks it up, and the comments have to come back into the source
they were about.

Read the annotations with the MCP tool `read_pdf_annotations` (from this
plugin's `latex` server). It returns each one with the words it marks, the note
attached to it, and the nearest heading.

## How to read them

- `pdf_path`: path to the annotated PDF
- `format`: `"text"` (default) for the readable listing, `"json"` when you want
  to process them programmatically

## Working from the result

**Anchor on the heading, not the page number.** The tool reports PDF page
numbers, which differ from the printed folio by however much front matter the
document has — and which change completely on the next render. The heading is
what still identifies the place after the source has been edited.

**Find the marked text in the source before editing.** The quoted words come
from the PDF, where line breaks, hyphenation and ligatures differ from the
Markdown. Search the source for a distinctive phrase from the quote rather than
expecting a literal match, and confirm you are in the section the heading
names.

**A highlight with no note is not self-explanatory.** It means "look at this",
not "rewrite this". If the intent is not obvious from the marked text, ask what
the reader wanted rather than guessing at a change they did not request — a
wrong guess costs them a review cycle.

**Multi-line quotes can be clipped.** A mark that only clips the first or last
line of a passage may report fewer words than the reader selected. When a quote
reads as a fragment, look at the surrounding sentence in the source before
deciding what was meant.

## When there are no annotations

An empty result usually means the annotations never reached the file, not that
the reader made none. Three causes, in order of likelihood:

1. **The app stores them privately.** Some readers (ReadEra, for one) keep
   highlights in their own database and never write the PDF. They need an
   export, and the export is not a PDF.
2. **A save or sync has not completed.** A note's text can arrive after its
   highlight, so a file read mid-sync shows the mark with no comment. If the
   file's timestamp is seconds old, read it again.
3. **The annotated copy is elsewhere.** Some apps "save as" rather than in
   place, leaving the original untouched.

Say which of these it looks like rather than reporting "no comments found",
which reads as though the reader had nothing to say.

## Re-rendering afterwards

Rendering over the annotated PDF destroys the annotations. If the review is
iterative, keep the reviewed copy under a separate name that no render writes
to, and tell the user that is what you have done.
