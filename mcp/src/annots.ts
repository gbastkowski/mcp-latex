// Read the annotations a human left on a rendered PDF, so a document can be
// revised from comments made in a viewer.
//
// This is the return leg of the render: the tool writes a PDF, someone reads it
// on a tablet and highlights a sentence, and the comment has to come back
// attached to enough context to act on -- which means the words actually marked
// and the heading they sit under, not a page number.
//
// mupdf is used rather than a pure-JS PDF library because two things are
// needed that most do not expose: an annotation's quadpoints, and a box per
// character. The cost is a WASM blob in the bundle.
import * as mupdf from "mupdf";

// Annotation types that mark existing text, as opposed to adding something of
// their own. Only these get quoted text; a sticky note carries only its own
// contents, and a drawing carries neither.
const TEXT_MARKUP = new Set([
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
]);

// A word must be this much covered by the mark to count as marked. Half is
// deliberately generous: a reader dragging across a line clips the glyphs
// above and below it, and those neighbours are covered only at their very
// edge -- so anything near half is the intended line, and anything well under
// it is spill. Measured against real tablet annotations, the losing words sat
// at 0.11-0.17 and the winning one at 1.0, so the threshold is nowhere near
// either.
const COVERAGE = 0.5;

// The running header repeats the chapter and section title at the top of every
// page, so searching a page for a heading's text finds it there first. Anything
// above this y is furniture, not content.
const HEADER_Y = 60;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Word extends Box {
  text: string;
}

export interface Annotation {
  /** 1-based index into the PDF's pages, which is not the printed folio. */
  page: number;
  /** Annotation type as the PDF names it: Highlight, Text, Ink, ... */
  type: string;
  /** The words the mark covers. Empty for annotations that mark no text. */
  quoted: string;
  /** What the human typed, if anything. */
  note: string;
  /** Nearest heading at or above the annotation, from the PDF outline. */
  heading: string;
}

/** Bounding box of one quadpoint, whose corners are not in a fixed order. */
function quadBox(q: ArrayLike<number>): Box {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

const area = (r: Box) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);

const overlap = (a: Box, b: Box): Box => ({
  x0: Math.max(a.x0, b.x0),
  y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
});

/**
 * Words on a page, each with its own box.
 *
 * Assembled from characters rather than read from the structured-text JSON,
 * which carries boxes per *line* only. A line box is useless here: a mark
 * covering one word would be scored against the width of the whole line and
 * either claim all of it or none.
 */
function pageWords(page: mupdf.Page): Word[] {
  const words: Word[] = [];
  let cur: Word | null = null;
  const flush = () => {
    if (cur) {
      words.push(cur);
      cur = null;
    }
  };
  page.toStructuredText("preserve-whitespace").walk({
    onChar(c: string, _origin: unknown, _font: unknown, _size: number, quad: ArrayLike<number>) {
      if (/\s/.test(c)) return flush();
      const b = quadBox(quad);
      if (!cur) cur = { text: c, ...b };
      else {
        cur.text += c;
        cur.x0 = Math.min(cur.x0, b.x0);
        cur.y0 = Math.min(cur.y0, b.y0);
        cur.x1 = Math.max(cur.x1, b.x1);
        cur.y1 = Math.max(cur.y1, b.y1);
      }
    },
    // A word cannot span a line break, and mupdf does not always emit a space
    // at one.
    endLine: flush,
  });
  flush();
  return words;
}

/**
 * The boxes an annotation covers.
 *
 * Markup annotations carry quadpoints -- one quad per line of text covered --
 * and mupdf *throws* when asked for their Rect. A sticky note is the reverse.
 * So both are attempted and whichever answers is used.
 */
function annotBoxes(an: mupdf.PDFAnnotation): Box[] {
  try {
    const qp = an.getQuadPoints?.();
    if (qp?.length) return Array.from(qp, quadBox);
  } catch {
    // Not a markup annotation; fall through to the rectangle.
  }
  try {
    const r = an.getRect();
    return [{ x0: r[0], y0: r[1], x1: r[2], y1: r[3] }];
  } catch {
    return [];
  }
}

// OutlineItem is an interface mupdf does not export, so the shape is restated
// here rather than reaching into the module's internals.
interface Outline {
  title?: string;
  page?: number;
  down?: Outline[];
}

/**
 * Resolve each outline entry to a page and a y, so a comment can be filed
 * under the heading above it rather than under whichever heading the page
 * happens to start with.
 *
 * A heading's y is found by searching its own page for its title text. That is
 * a text search rather than a structural lookup because the PDF outline stores
 * a destination, not a position we can trust across renderers.
 */
function headingIndex(doc: mupdf.PDFDocument): Map<number, { y: number; title: string }[]> {
  const byPage = new Map<number, { y: number; title: string }[]>();
  const walk = (entries: Outline[] | undefined) => {
    for (const e of entries ?? []) {
      const title = (e.title ?? "").trim();
      const pno = typeof e.page === "number" ? e.page : -1;
      if (title && pno >= 0) {
        let y = 0;
        try {
          // Long titles are truncated: mupdf's search wants a literal, and a
          // title that wrapped across two lines in the body will not match in
          // full.
          // search returns one array of quads per hit -- a hit that wraps a
          // line has several -- so the first quad of each is enough to place it.
          const hits = doc.loadPage(pno).search(title.slice(0, 60), {});
          const below = (hits ?? [])
            .filter((quads) => quads.length > 0)
            .map((quads) => quadBox(quads[0]))
            .filter((b) => b.y0 >= HEADER_Y);
          if (below.length) y = below[0].y0;
        } catch {
          // A title that cannot be located still orders correctly by page.
        }
        const list = byPage.get(pno) ?? [];
        list.push({ y, title });
        byPage.set(pno, list);
      }
      walk(e.down);
    }
  };
  walk((doc.loadOutline() as Outline[] | null) ?? undefined);
  for (const list of byPage.values()) list.sort((a, b) => a.y - b.y);
  return byPage;
}

/** Read every annotation in a PDF, with its quoted text and heading. */
export async function readAnnotations(pdfPath: string): Promise<Annotation[]> {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(pdfPath);
  const doc = mupdf.Document.openDocument(buf, "application/pdf") as mupdf.PDFDocument;
  const headings = headingIndex(doc);

  // Carried across pages: a comment on a page with no heading of its own
  // belongs to the last heading seen before it.
  let lastHeading = "";
  const out: Annotation[] = [];

  for (let pno = 0; pno < doc.countPages(); pno++) {
    const page = doc.loadPage(pno);
    const onPage = headings.get(pno) ?? [];
    const annots = page.getAnnotations() ?? [];

    if (annots.length === 0) {
      if (onPage.length) lastHeading = onPage[onPage.length - 1].title;
      continue;
    }

    // Words are only assembled for pages that actually carry an annotation:
    // walking every character of a 150-page document to quote two sentences is
    // most of the work for none of the result.
    const words = pageWords(page);

    for (const an of annots) {
      const type = an.getType();
      let note = "";
      try {
        note = (an.getContents() ?? "").trim();
      } catch {
        // An annotation with no contents entry is normal, not an error.
      }
      const boxes = annotBoxes(an);
      const top = boxes.length ? Math.min(...boxes.map((b) => b.y0)) : 0;

      let quoted = "";
      if (TEXT_MARKUP.has(type) && boxes.length) {
        quoted = words
          .filter((w) => {
            const a = area(w);
            if (!a) return false;
            const covered = Math.max(
              ...boxes.map((b) => area(overlap(w, b))),
              0,
            );
            return covered / a >= COVERAGE;
          })
          .map((w) => w.text)
          .join(" ");
      }

      const above = onPage.filter((h) => h.y <= top + 2);
      const heading = above.length
        ? above[above.length - 1].title
        : onPage.length
          ? lastHeading
          : lastHeading;

      out.push({ page: pno + 1, type, quoted, note, heading });
    }

    if (onPage.length) lastHeading = onPage[onPage.length - 1].title;
  }

  return out;
}

/** Render annotations as the text an agent reads back. */
export function formatAnnotations(annots: Annotation[], pdfPath: string): string {
  if (annots.length === 0) {
    return (
      `No annotations found in ${pdfPath}.\n\n` +
      "If comments were made in a viewer, they may not have been written into " +
      "the file: some readers keep highlights in their own database and need " +
      "an explicit save or export. Others write on a synced copy that has not " +
      "arrived yet."
    );
  }
  const lines = [`${annots.length} annotation(s) in ${pdfPath}:`, ""];
  annots.forEach((a, i) => {
    lines.push(`[${i + 1}] p${a.page} · ${a.heading || "(no heading)"} · ${a.type}`);
    if (a.quoted) lines.push(`    marked: “${a.quoted}”`);
    if (a.note) lines.push(`    note:   ${a.note.replace(/\n/g, "\n            ")}`);
    if (!a.quoted && !a.note) lines.push("    (no text)");
    lines.push("");
  });
  lines.push(
    "Page numbers are PDF pages, not printed folios — front matter shifts them.",
  );
  return lines.join("\n");
}
