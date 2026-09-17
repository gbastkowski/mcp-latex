---
description: Read the comments left on an annotated PDF and revise the source document from them.
---

Read the annotations on a PDF with the `read_pdf_annotations` MCP tool from the
`latex` server, then apply them to the document's source, following the
`apply-pdf-comments` skill.

**Input**: `$ARGUMENTS`
- First token: path to the annotated PDF (`$1`).
- Second token: path to the source document (`$2`). When omitted, assume the
  same basename with a `.md` or `.org` extension beside the PDF, and say which
  file you picked.

**Steps**

1. If no PDF path was given, ask which one — or, when exactly one annotated PDF
   is obvious from the conversation, use it and say so.
2. Call `read_pdf_annotations` with `pdf_path`. Report what came back before
   editing anything: the count, and one line per comment. An empty result is a
   finding, not a failure — diagnose it per the skill rather than reporting
   "no comments".
3. Locate each comment in the source by its heading, then by a distinctive
   phrase from its quoted text. Do not trust page numbers: they are PDF pages,
   and they change on every render.
4. Apply the changes the comments ask for. Where a comment marks text without
   saying what to do, ask rather than inventing an edit — and group the
   questions into one round rather than asking per comment.
5. Re-render only if asked. A render overwrites the PDF the annotations live in,
   so say that before doing it, and prefer a separate reviewed copy when the
   review is still going.
