// Read the annotations a human left on a rendered PDF, so a document can be
// revised from comments made in a viewer. A comment comes back with the words
// it marks and the heading it sits under, because a page number does not
// survive the next render.
//
// mupdf rather than a pure-JS PDF library: it exposes an annotation's
// quadpoints and a box per character, which most do not.
import * as mupdf from "mupdf";
import { readFile } from "node:fs/promises";

// Annotation types that mark existing text, and so have words to quote. A
// sticky note carries only its own contents; a drawing carries neither.
const TEXT_MARKUP = new Set([
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
]);

// How much of a word the mark must cover to count as marked. Uncritical:
// against a real tablet annotation the clipped neighbours scored 0.11-0.17 and
// the marked word 1.0.
const COVERAGE = 0.5;

// The running head reprints a section title on every page, so a search for a
// heading matches furniture up here as well as the real thing.
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
 * Assembled from characters: the structured-text JSON carries boxes per *line*
 * only, and a mark covering one word would then be scored against the whole
 * line.
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
 * Markup annotations carry quadpoints, one per line covered, and mupdf
 * *throws* when asked for their Rect; a sticky note is the reverse. Hence
 * both, whichever answers.
 */
function annotBoxes(an: mupdf.PDFAnnotation): Box[] {
  try {
    const qp = an.getQuadPoints?.();
    if (qp?.length) return Array.from(qp, quadBox);
  } catch {
    // Not a markup annotation.
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
 * The y of the first hit that is body text rather than page furniture.
 *
 * A heading's title is reprinted in the running head, and that occurrence sits
 * near the top of the page — above any mark on it. Taking it would record the
 * heading as starting above a mark it actually follows, which then claims
 * comments that belong to the heading before it.
 */
export function firstBodyY(boxes: Box[]): number | undefined {
  return boxes.find((b) => b.y0 >= HEADER_Y)?.y0;
}

/**
 * Each outline entry with a page and a y, so a comment lands under the heading
 * above it rather than the one the page opens with.
 *
 * The y comes from searching the page for the title text, because the outline
 * stores a destination rather than a position to trust across renderers.
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
          // Truncated: search wants a literal, and a title that wrapped in
          // the body will not match in full.
          const hits = doc.loadPage(pno).search(title.slice(0, 60), {});
          // One array of quads per hit; the first places it.
          const boxes = (hits ?? [])
            .filter((quads) => quads.length > 0)
            .map((quads) => quadBox(quads[0]));
          y = firstBodyY(boxes) ?? 0;
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

/**
 * The words a mark covers, as one string.
 *
 * By coverage per word, not by clipping page text to the mark's rectangle: a
 * mark spanning several lines has a rectangle that cuts a vertical slice
 * through all of them, yielding a fragment of each line.
 */
export function markedText(words: Word[], boxes: Box[]): string {
  return words
    .filter((w) => {
      const a = area(w);
      if (!a) return false;
      const covered = Math.max(...boxes.map((b) => area(overlap(w, b))), 0);
      return covered / a >= COVERAGE;
    })
    .map((w) => w.text)
    .join(" ")
    // Rejoin a word the renderer hyphenated across a line break: the quote is
    // used to find the passage in the *source*, where no such break exists,
    // so "cover- age" would match nothing.
    .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2");
}

/**
 * The heading a mark sits under: the lowest one starting at or above it, else
 * the last heading seen on an earlier page.
 */
export function headingAbove(
  onPage: { y: number; title: string }[],
  top: number,
  carried: string,
): string {
  return onPage.filter((h) => h.y <= top + 2).at(-1)?.title ?? carried;
}

/** Read every annotation in a PDF, with its quoted text and heading. */
export async function readAnnotations(pdfPath: string): Promise<Annotation[]> {
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
      } catch {}
      const boxes = annotBoxes(an);
      const top = boxes.length ? Math.min(...boxes.map((b) => b.y0)) : 0;

      const quoted =
        TEXT_MARKUP.has(type) && boxes.length ? markedText(words, boxes) : "";
      const heading = headingAbove(onPage, top, lastHeading);

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
