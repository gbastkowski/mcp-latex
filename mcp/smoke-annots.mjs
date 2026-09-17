#!/usr/bin/env node
// Round-trip smoke test for read_pdf_annotations: render a document, annotate
// the PDF, read the annotations back through the server, and check that what
// comes out is what went in.
//
//     node mcp/smoke-annots.mjs
//
// Both tools are driven over stdio, the same way a real MCP client does, so
// this exercises the committed bundle rather than src/ — including whether
// mupdf-wasm.wasm actually sits beside it.
//
// The annotations are written with mupdf directly, because the thing under test
// is the reading. Marks are placed by searching for known words, so the
// expected quotes are known without hardcoding coordinates.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "dist", "index.js");

const DOC = `---
title: "Annotation Round-Trip"
---

# First Chapter

The quick brown fox jumps over the lazy dog, and does so repeatedly.

## A Subsection

Sentences here exist to be marked up by a test.

# Second Chapter

Nothing in this chapter is annotated, so it should never be reported.
`;

/** One JSON-RPC session against the server; returns each tool call's text. */
async function callTools(calls) {
  const proc = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
  const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
  const results = [];
  await new Promise((resolve, reject) => {
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: calls[0] });
        return;
      }
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      results.push(msg.result?.content?.[0]?.text ?? "");
      if (msg.result?.isError) return reject(new Error(results.at(-1)));
      const next = calls[results.length];
      if (!next) return resolve();
      send({
        jsonrpc: "2.0",
        id: 2 + results.length,
        method: "tools/call",
        params: next,
      });
    });
    proc.on("error", reject);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke-annots", version: "1" },
      },
    });
  });
  proc.kill();
  return results;
}

/** Highlight a phrase and drop a sticky note, the way a reader would. */
async function annotate(pdfPath, phrase, note) {
  const doc = mupdf.Document.openDocument(
    await readFile(pdfPath),
    "application/pdf",
  );
  let placed = false;
  for (let i = 0; i < doc.countPages() && !placed; i++) {
    const page = doc.loadPage(i);
    const hits = page.search(phrase, {});
    if (!hits?.length) continue;
    const hl = page.createAnnotation("Highlight");
    hl.setQuadPoints(hits[0]);
    hl.setContents(note);
    hl.update();
    placed = true;
  }
  if (!placed) throw new Error(`phrase not found in PDF: ${phrase}`);
  const out = pdfPath.replace(/\.pdf$/, "-annotated.pdf");
  await writeFile(out, doc.saveToBuffer("incremental").asUint8Array());
  return out;
}

const fail = [];
const check = (name, actual, expected) => {
  const ok =
    typeof expected === "function" ? expected(actual) : actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    fail.push(name);
    console.log(`     got: ${JSON.stringify(actual)}`);
  }
};

const dir = await mkdtemp(join(tmpdir(), "mcp-latex-annots-"));
const src = join(dir, "doc.md");
const pdf = join(dir, "doc.pdf");
await writeFile(src, DOC, "utf8");

console.log("rendering...");
const [rendered] = await callTools([
  {
    name: "render_markdown_to_pdf",
    arguments: { input_path: src, output_path: pdf, preset: "classic-report" },
  },
]);
check("render reports the output path", rendered.includes(pdf), true);

console.log("annotating...");
const PHRASE = "quick brown fox";
const NOTE = "is this sentence pulling its weight?";
const annotated = await annotate(pdf, PHRASE, NOTE);

console.log("reading back...");
const [text, json] = await callTools([
  { name: "read_pdf_annotations", arguments: { pdf_path: annotated } },
  {
    name: "read_pdf_annotations",
    arguments: { pdf_path: annotated, format: "json" },
  },
]);

const annots = JSON.parse(json);
check("exactly one annotation", annots.length, 1);
const a = annots[0] ?? {};
check("type is Highlight", a.type, "Highlight");
check("note round-trips", a.note, NOTE);
// The marked words are what the coverage selection is for: clipping text to
// the mark's rectangle would return a fragment instead.
check("quoted text is the marked phrase", a.quoted, (q) =>
  typeof q === "string" && q.includes("quick") && q.includes("fox"),
);
// Not merely non-empty: the phrase sits under "First Chapter", and a
// page-level lookup would just as happily report the page's last heading.
check("heading is the annotated section", a.heading, "First Chapter");
check("unannotated chapter is absent", text.includes("Second Chapter"), false);
check("listing names the note", text.includes(NOTE), true);

// An empty read must explain itself rather than looking like "no comments".
const [empty] = await callTools([
  { name: "read_pdf_annotations", arguments: { pdf_path: pdf } },
]);
check("clean PDF reports none", empty.includes("No annotations found"), true);
check(
  "empty result suggests why",
  empty.includes("own database") || empty.includes("not arrived"),
  true,
);

console.log(
  `\n${fail.length === 0 ? "all checks passed" : `${fail.length} failed: ${fail.join(", ")}`}`,
);
console.log(`artifacts: ${dir}`);
process.exit(fail.length === 0 ? 0 : 1);
