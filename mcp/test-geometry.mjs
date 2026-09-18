#!/usr/bin/env node --experimental-strip-types
// Unit tests for the two geometry decisions in annots.ts.
//
//     node mcp/test-geometry.mjs
//
// These are separate from smoke-annots.mjs on purpose. That test proves the
// feature works end to end through a real render; this one proves the two
// defects the implementation exists to avoid stay fixed. Both defects are
// about coordinates, and coaxing a real PDF's layout into reproducing them
// exactly is fragile — a font change moves the geometry and the test silently
// stops covering the case it was written for. Synthetic boxes state the case
// directly and cannot drift.
//
// Run against src/ rather than the bundle: these are pure functions, and the
// bundle is covered by the smoke test. The shebang carries
// --experimental-strip-types so node can import the .ts directly; `npm test`
// passes it too.
import { markedText, headingAbove, firstBodyY } from "./src/annots.ts";

const fail = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    fail.push(name);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     got:      ${JSON.stringify(actual)}`);
  }
};

const word = (text, x0, y0, x1, y1) => ({ text, x0, y0, x1, y1 });

// ---------------------------------------------------------------- markedText

// Three lines of text, 10pt tall each, as a renderer would lay them out.
const LINE1 = [word("alpha", 100, 100, 140, 110), word("beta", 145, 100, 180, 110)];
const LINE2 = [word("gamma", 100, 115, 145, 125), word("delta", 150, 115, 190, 125)];
const LINE3 = [word("epsilon", 100, 130, 155, 140), word("zeta", 160, 130, 195, 140)];
const PAGE = [...LINE1, ...LINE2, ...LINE3];

// A mark over one line only.
check(
  "a single-line mark takes that line's words",
  markedText(PAGE, [{ x0: 98, y0: 114, x1: 192, y1: 126 }]),
  "gamma delta",
);

// THE REGRESSION CASE. A real multi-line mark carries one quad per line. The
// defect this guards against was using the mark's *bounding rectangle*, which
// spans all three lines and every x between them — so a narrow mark returned a
// vertical slice of each line instead of the marked words.
const NARROW_SPANNING_QUADS = [
  { x0: 145, y0: 99, x1: 182, y1: 111 }, // "beta" on line 1
  { x0: 100, y0: 114, x1: 147, y1: 126 }, // "gamma" on line 2
];
check(
  "a multi-line mark takes the words its quads cover",
  markedText(PAGE, NARROW_SPANNING_QUADS),
  "beta gamma",
);
// Stated as its own check because this is the shape that produced
// "Model Conte manipulate at.": the union of those quads is a box from
// (100,99) to (182,126), which clips into all of line 1 and line 2.
const UNION_OF_QUADS = [{ x0: 100, y0: 99, x1: 182, y1: 126 }];
check(
  "the bounding box of the same mark would over-select",
  markedText(PAGE, UNION_OF_QUADS),
  "alpha beta gamma delta",
);

// Partial coverage: a mark clipping the line above must not claim it.
check(
  "a word nicked at its edge is not marked",
  markedText(PAGE, [{ x0: 98, y0: 108, x1: 192, y1: 126 }]),
  "gamma delta",
);
check(
  "a word covered past the threshold is marked",
  markedText([word("solo", 100, 100, 140, 110)], [
    { x0: 100, y0: 100, x1: 140, y1: 106 },
  ]),
  "solo",
);
check(
  "a word covered below the threshold is not",
  markedText([word("solo", 100, 100, 140, 110)], [
    { x0: 100, y0: 100, x1: 140, y1: 103 },
  ]),
  "",
);

// Hyphenation: the quote is matched against the source, which has no break.
check(
  "a hyphenated word is rejoined",
  markedText(
    [word("cover-", 100, 100, 140, 110), word("age", 100, 115, 130, 125)],
    [
      { x0: 99, y0: 99, x1: 141, y1: 111 },
      { x0: 99, y0: 114, x1: 131, y1: 126 },
    ],
  ),
  "coverage",
);
check(
  "a real hyphenated compound is left alone",
  markedText([word("well-known", 100, 100, 180, 110)], [
    { x0: 99, y0: 99, x1: 181, y1: 111 },
  ]),
  "well-known",
);

check("no boxes selects nothing", markedText(PAGE, []), "");
check("no words selects nothing", markedText([], UNION_OF_QUADS), "");

// -------------------------------------------------------------- headingAbove

// Headings as headingIndex records them: y ascending down the page.
const HEADINGS = [
  { y: 40, title: "Chapter One" },
  { y: 110, title: "A Subsection" },
  { y: 300, title: "A Later Subsection" },
];

// Nearest above, and the heading below it does not claim the mark.
check(
  "a mark takes the nearest heading above it",
  headingAbove(HEADINGS, 150, "carried"),
  "A Subsection",
);
check(
  "a mark below every heading takes the last",
  headingAbove(HEADINGS, 400, "carried"),
  "A Later Subsection",
);
check(
  "a mark above every heading falls back to the carried one",
  headingAbove(HEADINGS, 20, "Previous Chapter"),
  "Previous Chapter",
);
check(
  "a page with no headings falls back to the carried one",
  headingAbove([], 150, "Previous Chapter"),
  "Previous Chapter",
);

// THE OTHER REGRESSION CASE. headingIndex excludes hits above HEADER_Y because
// the running head reprints a section title at the top of every page. Without
// that filter, a heading that actually starts *below* the mark is recorded at
// the header's y — roughly 34 — and then, being the last entry at or above the
// mark, wrongly claims it. This is what the unfiltered index looks like.
const UNFILTERED = [
  { y: 40, title: "Chapter One" },
  { y: 110, title: "A Subsection" },
  { y: 34, title: "A Later Subsection" }, // its running-head occurrence
];
check(
  "furniture recorded above the mark would mis-claim it",
  headingAbove(UNFILTERED, 150, "carried"),
  "A Later Subsection",
);
// With HEADER_Y applied that entry keeps its real y of 300, and the mark is
// unaffected — the difference between the two lists above is the filter.

// --------------------------------------------------------------- firstBodyY

// A heading title found twice on its page: once in the running head, once as
// the heading itself. Taking the header's y is the defect — it records the
// heading as starting above marks it actually follows.
check(
  "the running-head occurrence is skipped",
  firstBodyY([{ x0: 471, y0: 34, x1: 540, y1: 44 }, { x0: 103, y0: 106, x1: 200, y1: 118 }]),
  106,
);
check(
  "a heading found only in the body is taken as-is",
  firstBodyY([{ x0: 103, y0: 106, x1: 200, y1: 118 }]),
  106,
);
check(
  "a heading found only in furniture yields nothing",
  firstBodyY([{ x0: 471, y0: 34, x1: 540, y1: 44 }]),
  undefined,
);
check("no hits yields nothing", firstBodyY([]), undefined);
// The boundary itself, so the constant cannot drift unnoticed.
check("a hit exactly at the cutoff is body", firstBodyY([{ x0: 0, y0: 60, x1: 10, y1: 70 }]), 60);
check("a hit just above the cutoff is furniture", firstBodyY([{ x0: 0, y0: 59, x1: 10, y1: 70 }]), undefined);

console.log(
  `\n${fail.length === 0 ? "all checks passed" : `${fail.length} failed: ${fail.join(", ")}`}`,
);
process.exit(fail.length === 0 ? 0 : 1);
