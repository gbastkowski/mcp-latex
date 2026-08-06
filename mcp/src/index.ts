#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  access,
  copyFile,
  readdir,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// assets live next to package root: mcp/assets/, dist/ is a sibling.
const ASSETS_DIR = join(__dirname, "..", "assets");
// Shared prelude, then a type partial, then a layout partial — concatenated in
// that order so a layout can override the furniture its type set up.
const COMMON_PATH = join(ASSETS_DIR, "common.tex.tmpl");
const LAYOUTS_DIR = join(ASSETS_DIR, "layouts");
const TYPES_DIR = join(ASSETS_DIR, "types");

// A preset is "<layout>-<type>". Both axes are free to grow: adding a file to
// assets/layouts or assets/types is enough, no code change. The type name may
// not itself contain a dash, so the split is on the FIRST dash.
const DEFAULT_PRESET = "classic-report";

// Keep in step with package.json, mcp/package.json and
// .claude-plugin/plugin.json. Reported by the MCP
// handshake and appended to every render result, so it is possible to tell which
// build actually produced a PDF — npx caches git installs, so the version in the
// result is the only reliable check that a new one is being used.
const SERVER_VERSION = "1.2.0";

// Per-type overrides for the tri-state defaults. A type that is structurally
// wrong with a TOC says so here; the LaTeX partial cannot refuse pandoc's
// --toc on its own. An explicit caller argument still wins.
const TYPE_DEFAULTS: Record<string, { toc?: boolean; numberSections?: boolean }> =
  {
    // A newspaper has no table of contents and no numbered sections.
    newspaper: { toc: false, numberSections: false },
    // A reference document is navigated, not read through: the TOC is always
    // worth its pages and every heading needs a number to cite.
    reference: { toc: true, numberSections: true },
    // Same reasoning for the KOMA long-form variant.
    komabook: { toc: true, numberSections: true },
  };

// Per-type LaTeX document class and class options. `article` has no \chapter,
// which a long reference document needs, and twoside only makes sense for
// something long enough to bind. A partial cannot set either — pandoc passes the
// class before any header include is read.
const TYPE_CLASSES: Record<
  string,
  {
    documentclass: string;
    classoption?: string[];
    tocDepth?: number;
    topLevelDivision?: "chapter" | "section" | "part";
  }
> = {
  reference: {
    documentclass: "report",
    classoption: ["twoside", "openright"],
    // At this length the TOC is the primary navigation, so it goes deeper than
    // the two levels a short report wants.
    tocDepth: 3,
    // `report` numbers sections within a chapter, but pandoc's top level is
    // \section unless told otherwise — so nothing ever issued a \chapter, the
    // chapter counter stayed at zero, and every section came out as "0.1",
    // "0.1.2.1", with a running head reading "0.1 Overview".
    topLevelDivision: "chapter",
  },
  // Landscape gives the three columns a usable measure: at A4 portrait a third
  // of the width cannot hold a line of prose without hyphenating every word.
  newspaper: {
    documentclass: "article",
    classoption: ["landscape"],
  },
  // KOMA-Script variants. scrartcl/scrreprt compute their type area from the
  // paper and font size rather than a fixed margin, and expose heading fonts
  // through \setkomafont — which replaces the \@startsection patching the
  // standard-class types need. All of KOMA is in BasicTeX, so no extra install.
  koma: {
    documentclass: "scrartcl",
  },
  komabook: {
    documentclass: "scrreprt",
    classoption: ["twoside", "openright"],
    tocDepth: 3,
    topLevelDivision: "chapter",
  },
};

// Per-type body serif, used only when the caller left main_font at the default.
// This lives here rather than in the partial because pandoc's `-V mainfont`
// overrides anything a header include sets, and because a font the caller asked
// for explicitly must not be silently replaced.
const TYPE_FONTS: Record<string, { main?: string }> = {
  // Higher stroke contrast than Palatino and old-style figures — a newspaper
  // register rather than a book one. Falls back if the face is absent.
  newspaper: { main: "Hoefler Text" },
};

// The page-margin default a type wants, used only when the caller left `margin`
// at DEFAULT_MARGIN. A newspaper is set to the edge of the sheet: broad columns
// and a wide masthead are the point, and a book's 2.5cm of white space wastes
// most of the measure that going landscape just bought.
const DEFAULT_MARGIN = "2.5cm";
const TYPE_MARGINS: Record<string, string> = {
  newspaper: "1cm",
};

async function listPresetParts(dir: string): Promise<string[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  return files
    .filter((f) => f.endsWith(".tex.tmpl"))
    .map((f) => f.replace(/\.tex\.tmpl$/, ""))
    .sort();
}

// Split "ista-newspaper" into its layout and type halves and check both exist.
// Returns a human-readable error listing the valid combinations otherwise.
async function resolvePreset(
  preset: string,
): Promise<
  { ok: true; layout: string; type: string } | { ok: false; error: string }
> {
  const layouts = await listPresetParts(LAYOUTS_DIR);
  const types = await listPresetParts(TYPES_DIR);
  const valid = () =>
    layouts.flatMap((l) => types.map((t) => `${l}-${t}`)).join(", ");

  const dash = preset.indexOf("-");
  if (dash <= 0 || dash === preset.length - 1) {
    return {
      ok: false,
      error: `Invalid preset '${preset}': expected '<layout>-<type>'. Valid presets: ${valid()}`,
    };
  }
  const layout = preset.slice(0, dash);
  const type = preset.slice(dash + 1);
  if (!layouts.includes(layout) || !types.includes(type)) {
    const which = !layouts.includes(layout)
      ? `unknown layout '${layout}' (have: ${layouts.join(", ")})`
      : `unknown type '${type}' (have: ${types.join(", ")})`;
    return {
      ok: false,
      error: `Invalid preset '${preset}': ${which}. Valid presets: ${valid()}`,
    };
  }
  return { ok: true, layout, type };
}

// Docker image with pandoc + a working TeX stack. Only published for amd64,
// so we pin the platform — on Apple Silicon this runs under emulation (slower
// but works) rather than failing with a missing-manifest error.
// Custom image (docker/Dockerfile): pandoc/latex + the header's LaTeX packages
// baked in. Only published for amd64, so we pin the platform — on Apple Silicon
// this runs under emulation.
const DOCKER_IMAGE = "ghcr.io/gbastkowski/mcp-latex-tex:latest";
const DOCKER_PLATFORM = "linux/amd64";
// The Docker image ships NO fontconfig system fonts, so named fonts like
// Palatino/Menlo cannot resolve there. Under Docker we drop the font vars and
// let xelatex fall back to its built-in Latin Modern. The macOS defaults below
// are only used by the native engine; on Linux they are swapped for the free
// equivalents below (apt: fonts-texgyre fonts-dejavu).
const MAC_DEFAULT_MAIN = "Palatino";
const MAC_DEFAULT_MONO = "Menlo";
const LINUX_DEFAULT_MAIN = "TeX Gyre Pagella";
const LINUX_DEFAULT_MONO = "DejaVu Sans Mono";

// Prepend the standard macOS TeX bin dir so xelatex is found even when the
// MCP host launches us with a minimal PATH.
const TEXBIN = "/Library/TeX/texbin";
const ENV = {
  ...process.env,
  PATH: `${TEXBIN}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`,
};

function run(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, env: ENV });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      resolvePromise({ code: 127, stdout, stderr: stderr + String(err) }),
    );
    child.on("close", (code) =>
      resolvePromise({ code: code ?? 1, stdout, stderr }),
    );
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// True if `cmd` is runnable (native engine probe).
async function onPath(cmd: string): Promise<boolean> {
  const res = await run("command", ["-v", cmd]);
  if (res.code === 0) return true;
  // `command` is a shell builtin; spawn can't run it directly. Fall back to
  // probing the known texbin / brew locations plus a direct exec attempt.
  const probe = await run(cmd, ["--version"]);
  return probe.code === 0;
}

async function dockerAvailable(): Promise<boolean> {
  const res = await run("docker", ["info"]);
  return res.code === 0;
}

// True if fontconfig can resolve `name`. Used to check a type's preferred body
// serif before requesting it, so a machine without that face degrades to the
// normal default instead of failing the render with a fontspec error.
// Cached: the same font is asked about on every call and fc-list is not cheap.
const fontCache = new Map<string, boolean>();
async function fontExists(name: string): Promise<boolean> {
  const hit = fontCache.get(name);
  if (hit !== undefined) return hit;
  const res = await run("fc-list", [name, "family"]);
  // fc-list exits 0 with empty output for an unknown family, so check the text.
  const ok = res.code === 0 && res.stdout.trim().length > 0;
  fontCache.set(name, ok);
  return ok;
}

// In 'auto' mode a document with fewer than this many headings is treated as
// "simple": no section numbering.
const SIMPLE_DOC_MAX_HEADINGS = 3;

// A TOC earns its page only when there is something to navigate. Counting every
// heading is the wrong signal: a one-page note with a single section and four
// subsections trips a total-count threshold while having nothing worth listing.
// What matters is the number of entries the TOC will actually show, which means
// counting only headings at or above `toc_depth`, and requiring enough
// top-level sections that a reader would want to jump between them.
const MIN_TOC_ENTRIES = 4;
const MIN_TOC_TOP_LEVEL = 3;

// Count headings per level (1-based) up to `maxLevel`, skipping code/example
// blocks. Shared by the TOC heuristic and the title-detection logic.
function headingLevelCounts(
  src: string,
  fmt: InputFormat,
  maxLevel: number,
): number[] {
  const counts = new Array(maxLevel).fill(0);
  const marker = fmt === "org" ? "*" : "#";
  const openFence = fmt === "org" ? /^\s*#\+begin_/i : /^\s*(```+|~~~+)/;
  const closeFence = fmt === "org" ? /^\s*#\+end_/i : /^\s*(```+|~~~+)/;

  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    if (!inBlock && openFence.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (closeFence.test(line)) inBlock = false;
      continue;
    }
    const m = line.match(fmt === "org" ? /^(\*+)\s+\S/ : /^(#+)\s+\S/);
    if (!m) continue;
    const level = m[1].length;
    if (level >= 1 && level <= maxLevel) counts[level - 1]++;
  }
  return counts;
}

// Decide whether a TOC is worth printing, given the depth it will be cut at and
// whether headings are being promoted a level first.
function tocMakesSense(
  src: string,
  fmt: InputFormat,
  tocDepth: number,
  shifted: boolean,
): boolean {
  // With --shift-heading-level-by=-1 the H1 becomes the title and everything
  // moves up, so what the TOC lists is the source's level 2..(depth+1).
  const offset = shifted ? 1 : 0;
  const counts = headingLevelCounts(src, fmt, tocDepth + offset + 1);

  let entries = 0;
  for (let lvl = 1 + offset; lvl <= tocDepth + offset; lvl++) {
    entries += counts[lvl - 1] ?? 0;
  }
  const topLevel = counts[offset] ?? 0;

  return entries >= MIN_TOC_ENTRIES && topLevel >= MIN_TOC_TOP_LEVEL;
}

// Input formats we accept. pandoc infers from the extension too, but being
// explicit lets inline source (which has no extension) pick a format, and lets
// a .txt/.text file be treated as either.
const INPUT_FORMATS = { markdown: "md", org: "org" } as const;
type InputFormat = keyof typeof INPUT_FORMATS;

// Guess the input format from a file extension. Anything unrecognised falls
// back to markdown, which is what the tool has always assumed.
function formatFromPath(p: string): InputFormat {
  return extname(p).toLowerCase() === ".org" ? "org" : "markdown";
}

// Count org headings (`*`..`******` at line start), skipping #+begin_…/#+end_…
// blocks so a `* bullet` inside an example block is not counted. Org uses `*`
// for headings where Markdown uses `#`, so the Markdown counter returns 0 for
// every org file — which would silently disable the auto-TOC heuristic.
function countOrgHeadings(src: string): number {
  let count = 0;
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*#\+begin_/i.test(line)) {
      inBlock = true;
      continue;
    }
    if (/^\s*#\+end_/i.test(line)) {
      inBlock = false;
      continue;
    }
    if (!inBlock && /^\*{1,6}\s+\S/.test(line)) count++;
  }
  return count;
}

// Count headings at a single level (1 = `#` / `*`), skipping code and example
// blocks. Used to detect the "one H1 = document title" shape.
function countHeadingsAtLevel(
  src: string,
  fmt: InputFormat,
  level: number,
): number {
  const marker = fmt === "org" ? "\\*" : "#";
  // Exactly `level` markers, then whitespace — so `##` never matches level 1.
  const re = new RegExp(`^${marker}{${level}}(?!${marker})\\s+\\S`);
  const openFence =
    fmt === "org" ? /^\s*#\+begin_/i : /^\s*(```+|~~~+)/;
  const closeFence = fmt === "org" ? /^\s*#\+end_/i : /^\s*(```+|~~~+)/;

  let count = 0;
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    if (!inBlock && openFence.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (closeFence.test(line)) inBlock = false;
      continue;
    }
    if (re.test(line)) count++;
  }
  return count;
}

// True when the document has exactly one top-level heading and at least one
// heading below it: that H1 is almost certainly the document title, so every
// heading should move up a level and the title becomes the PDF's title rather
// than a numbered section competing with its own children.
function shouldShiftHeadings(src: string, fmt: InputFormat): boolean {
  // A document whose title already comes from metadata (YAML front matter, or
  // org's #+title:) has no title heading to absorb, so promoting would lift its
  // real sections to a level the styling does not expect. Leave it alone.
  if (hasMetadataTitle(src, fmt)) return false;
  return (
    countHeadingsAtLevel(src, fmt, 1) === 1 &&
    countHeadingsAtLevel(src, fmt, 2) > 0
  );
}

// True if the source declares its own title in metadata rather than as a
// heading: YAML front matter `title:` for markdown, `#+title:` for org.
function hasMetadataTitle(src: string, fmt: InputFormat): boolean {
  if (fmt === "org") return /^\s*#\+title:/im.test(src);
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n/);
  return m ? /^title\s*:/im.test(m[1]) : false;
}

// Count ATX headings (`#`..`######`) in Markdown, ignoring anything inside
// fenced code blocks so a `# comment` in a code sample is not mistaken for one.
function countHeadings(md: string): number {
  let count = 0;
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{1,6}\s+\S/.test(line)) count++;
  }
  return count;
}

// Resolve a tri-state ('auto' | 'true' | 'false') against the heading count.
function resolveAuto(v: "auto" | "true" | "false", headings: number): boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  return headings >= SIMPLE_DOC_MAX_HEADINGS;
}

// LaTeX-escape a value that lands in a running-header text field.
function texEscape(s: string): string {
  return s.replace(/([#$%&_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}");
}

// Shared pandoc argument list. Paths are supplied by the caller so the same
// builder works for native (absolute host paths) and docker (/data/... paths).
function buildPandocArgs(opts: {
  input: string;
  output: string;
  header: string;
  format: InputFormat;
  documentclass: string;
  classoption: string[];
  topLevelDivision?: string;
  papersize: string;
  fontsize: string;
  margin: string;
  mainFont: string;
  monoFont: string;
  shiftHeadings: boolean;
  toc: boolean;
  tocDepth: number;
  numberSections: boolean;
}): string[] {
  const a = [
    opts.input,
    "-o",
    opts.output,
    // Explicit, so inline source (no extension) and .txt files are unambiguous.
    "--from",
    opts.format,
    "--pdf-engine=xelatex",
    `--include-in-header=${opts.header}`,
    "-V",
    `documentclass=${opts.documentclass}`,
    "-V",
    `papersize=${opts.papersize}`,
    "-V",
    `fontsize=${opts.fontsize}`,
    "-V",
    `geometry:margin=${opts.margin}`,
    "-V",
    "colorlinks=true",
    "-V",
    "linkcolor=Blue",
    "-V",
    "urlcolor=Blue",
    "-V",
    "toccolor=black",
  ];
  // Fonts are optional: an empty value means "let xelatex use its default"
  // (Latin Modern), which is the only reliable choice in the Docker image
  // since it ships no fontconfig system fonts.
  for (const opt of opts.classoption) a.push("-V", `classoption=${opt}`);
  if (opts.topLevelDivision)
    a.push(`--top-level-division=${opts.topLevelDivision}`);
  if (opts.mainFont) a.push("-V", `mainfont=${opts.mainFont}`);
  if (opts.monoFont) a.push("-V", `monofont=${opts.monoFont}`);
  // Promote every heading one level: the lone H1 becomes the document title
  // (pandoc lifts it into metadata) and H2s become top-level sections.
  if (opts.shiftHeadings) a.push("--shift-heading-level-by=-1");
  if (opts.toc) a.push("--toc", `--toc-depth=${opts.tocDepth}`);
  if (opts.numberSections) a.push("--number-sections");
  return a;
}

const TLMGR_HINT =
  "Hint: BasicTeX is minimal — if a .sty is missing, run " +
  "`sudo tlmgr install <pkg>` (fancyhdr lastpage newunicodechar soul xcolor).";

const server = new McpServer({ name: "mcp-latex", version: SERVER_VERSION });

server.tool(
  "render_markdown_to_pdf",
  "Render a Markdown or Org document to a nicely-styled PDF using pandoc + " +
    "xelatex. Styling comes from a `preset` named '<layout>-<type>' (e.g. " +
    "'ista-report', 'eisvogel-newspaper'); call with an invalid preset to get " +
    "the list of valid ones. Runs natively (macOS fonts, can open in Skim) or " +
    "in a Docker image (portable/reproducible).",
  {
    input_path: z
      .string()
      .optional()
      .describe(
        "Path to the input file (.md or .org). Provide this OR `input`. " +
          "Alias: `markdown_path`.",
      ),
    input: z
      .string()
      .optional()
      .describe(
        "Inline document source. Provide this OR `input_path`. Alias: `markdown`.",
      ),
    input_format: z
      .enum(["auto", "markdown", "org"])
      .default("auto")
      .describe(
        "Input syntax. 'auto' infers from the file extension (.org -> org, " +
          "anything else -> markdown) and defaults to markdown for inline input.",
      ),
    preset: z
      .string()
      .default(DEFAULT_PRESET)
      .describe(
        "Styling preset, '<layout>-<type>'. Layout controls fonts/colour/" +
          "furniture, type controls structure. Any layout composes with any " +
          "type; an invalid value returns the list of valid presets.",
      ),
    shift_headings: z
      .enum(["auto", "true", "false"])
      .default("auto")
      .describe(
        "Promote every heading one level. 'auto' does so when the document has " +
          "exactly one top-level heading and something beneath it — that H1 is " +
          "the document title, so it becomes the PDF title and the H2s become " +
          "top-level sections instead of being nested under it.",
      ),
    markdown_path: z
      .string()
      .optional()
      .describe("Deprecated alias for `input_path`."),
    markdown: z
      .string()
      .optional()
      .describe("Deprecated alias for `input`."),
    output_path: z
      .string()
      .optional()
      .describe(
        "Output PDF path. Defaults to the input file with a .pdf extension, " +
          "or ./document.pdf for inline input.",
      ),
    title: z
      .string()
      .default("")
      .describe("Left running-header text (usually the document title)."),
    header_right: z
      .string()
      .default("")
      .describe("Right running-header text, e.g. 'PRD'. Empty to omit."),
    main_font: z
      .string()
      .default(MAC_DEFAULT_MAIN)
      .describe(
        "Serif body font. The macOS default 'Palatino' is auto-swapped to " +
          "'TeX Gyre Pagella' on Linux, and dropped for Latin Modern under " +
          "the docker engine.",
      ),
    mono_font: z
      .string()
      .default(MAC_DEFAULT_MONO)
      .describe(
        "Monospace font. The macOS default 'Menlo' is auto-swapped to " +
          "'DejaVu Sans Mono' on Linux, and dropped for Latin Modern under " +
          "the docker engine.",
      ),
    papersize: z.string().default("a4"),
    fontsize: z.string().default("11pt"),
    margin: z
      .string()
      .default(DEFAULT_MARGIN)
      .describe(
        "Page margin, e.g. '2.5cm'. Some types override this default — a " +
          "newspaper runs much closer to the edge of the sheet.",
      ),
    link_color: z
      .string()
      .default("1F4E79")
      .describe("Hex link color (no leading #)."),
    toc: z
      .enum(["auto", "true", "false"])
      .default("auto")
      .describe(
        "Table of contents. 'auto' includes one only when the document has " +
          "several headings; 'true'/'false' force it.",
      ),
    toc_depth: z
      .number()
      .int()
      .min(1)
      .max(6)
      .default(2)
      .describe("Deepest heading level shown in the TOC."),
    number_sections: z
      .enum(["auto", "true", "false"])
      .default("auto")
      .describe(
        "Number the sections. 'auto' numbers only when the document has " +
          "several headings; 'true'/'false' force it.",
      ),
    engine: z
      .enum(["auto", "native", "docker"])
      .default("auto")
      .describe(
        "Render engine. 'auto' uses native pandoc+xelatex when present " +
          "(keeps system fonts and open_in), else Docker. 'native' or " +
          "'docker' force one.",
      ),
    open_in: z
      .enum(["Skim", "Preview", "none"])
      .default("none")
      .describe(
        "Open the rendered PDF in this macOS app on success, or 'none'. " +
          "Works with either engine since the PDF lands on the host.",
      ),
  },
  async (args) => {
    const {
      input_path,
      input,
      input_format,
      preset,
      shift_headings,
      markdown_path,
      markdown,
      output_path,
      title,
      header_right,
      main_font,
      mono_font,
      papersize,
      fontsize,
      margin,
      link_color,
      toc,
      toc_depth,
      number_sections,
      engine,
      open_in,
    } = args;

    // Accept the pre-preset argument names as aliases.
    const srcPath = input_path ?? markdown_path;
    const srcInline = input ?? markdown;

    if (!srcPath && srcInline === undefined) {
      return errText("Provide either `input_path` or `input`.");
    }

    const resolved = await resolvePreset(preset);
    if (!resolved.ok) return errText(resolved.error);
    const { layout, type } = resolved;

    // Resolve the engine.
    let chosen: "native" | "docker";
    if (engine === "native" || engine === "docker") {
      chosen = engine;
    } else {
      const native = await onPath("xelatex");
      const nativePandoc = native && (await onPath("pandoc"));
      if (nativePandoc) {
        chosen = "native";
      } else if (await dockerAvailable()) {
        chosen = "docker";
      } else {
        return errText(
          "No render engine available: native pandoc+xelatex not found and " +
            "Docker is not running. Install BasicTeX/MacTeX + pandoc, or start Docker.",
        );
      }
    }

    // Fonts: the native engine uses the requested fonts. The Docker image has
    // no system fonts, so the macOS defaults are dropped there and xelatex
    // falls back to Latin Modern. On Linux the macOS defaults don't exist
    // either, so they are swapped for the free metric-compatible equivalents.
    // An explicit non-default font is always passed through (the caller is
    // then responsible for it existing).
    let mainFont = main_font;
    let monoFont = mono_font;
    if (main_font === MAC_DEFAULT_MAIN) {
      // A type may prefer its own body serif (a newspaper is not set in a book
      // face). Only consulted when the caller left the default, and only on the
      // native engine — the Docker image has no system fonts to find it in.
      const typeFont = TYPE_FONTS[type]?.main;
      if (chosen === "docker") mainFont = "";
      else if (typeFont && (await fontExists(typeFont))) mainFont = typeFont;
      else if (process.platform === "linux") mainFont = LINUX_DEFAULT_MAIN;
    }
    if (mono_font === MAC_DEFAULT_MONO) {
      if (chosen === "docker") monoFont = "";
      else if (process.platform === "linux") monoFont = LINUX_DEFAULT_MONO;
    }

    const scratch = await mkdtemp(join(tmpdir(), "mcp-latex-"));
    try {
      // Resolve the input syntax before touching the filesystem: the inline
      // scratch file needs the matching extension so pandoc reads it correctly.
      const fmt: InputFormat =
        input_format === "auto"
          ? srcPath
            ? formatFromPath(srcPath)
            : "markdown"
          : input_format;

      // Resolve/prepare the input file and final output path (host side).
      let inputFile: string;
      let outFile: string;
      if (srcPath) {
        inputFile = resolve(srcPath);
        if (!(await exists(inputFile))) {
          return errText(`Input not found: ${inputFile}`);
        }
        outFile = output_path
          ? resolve(output_path)
          : join(
              dirname(inputFile),
              basename(inputFile, extname(inputFile)) + ".pdf",
            );
      } else {
        inputFile = join(scratch, `document.${INPUT_FORMATS[fmt]}`);
        await writeFile(inputFile, srcInline ?? "", "utf8");
        outFile = output_path ? resolve(output_path) : resolve("document.pdf");
      }

      // Compose header.tex: shared prelude, then the type partial, then the
      // layout partial. Layout comes last so it can override the page furniture
      // the type set up (rules, running heads, footer position).
      const parts = await Promise.all([
        readFile(COMMON_PATH, "utf8"),
        readFile(join(TYPES_DIR, `${type}.tex.tmpl`), "utf8"),
        readFile(join(LAYOUTS_DIR, `${layout}.tex.tmpl`), "utf8"),
      ]);
      const header = parts
        .join("\n")
        .replace(/__TITLE__/g, texEscape(title))
        .replace(/__HEADER_RIGHT__/g, texEscape(header_right))
        .replace(/__LINK_COLOR__/g, link_color.replace(/^#/, ""));
      const headerFile = join(scratch, "header.tex");
      await writeFile(headerFile, header, "utf8");

      // Resolve the tri-state toc / number_sections. In 'auto', a document is
      // "simple" (no TOC, no numbering) when it has fewer than this many
      // headings — a short doc reads better plain. Some types are structurally
      // wrong with a TOC (newspaper) and override 'auto' outright; an explicit
      // 'true'/'false' from the caller still wins.
      const source =
        srcInline ?? (await readFile(inputFile, "utf8").catch(() => ""));
      const headingCount =
        fmt === "org" ? countOrgHeadings(source) : countHeadings(source);
      const shift =
        shift_headings === "auto"
          ? shouldShiftHeadings(source, fmt)
          : shift_headings === "true";

      // Document class comes from the type; a long reference needs \chapter and
      // twoside, which `article` cannot give.
      const typeClass = TYPE_CLASSES[type];
      const documentclass = typeClass?.documentclass ?? "article";
      const classoption = typeClass?.classoption ?? [];
      const topLevelDivision = typeClass?.topLevelDivision;
      // A type may want a deeper TOC than the default, but an explicit caller
      // value still wins.
      const effectiveTocDepth =
        toc_depth === 2 && typeClass?.tocDepth ? typeClass.tocDepth : toc_depth;

      // A type may want a different page margin, but an explicit caller value
      // still wins.
      const effectiveMargin =
        margin === DEFAULT_MARGIN ? (TYPE_MARGINS[type] ?? margin) : margin;

      const typeDefaults = TYPE_DEFAULTS[type] ?? {};
      const wantToc =
        toc === "auto"
          ? typeDefaults.toc !== undefined
            ? typeDefaults.toc
            : tocMakesSense(source, fmt, effectiveTocDepth, shift)
          : toc === "true";
      const wantNumbers =
        number_sections === "auto" && typeDefaults.numberSections !== undefined
          ? typeDefaults.numberSections
          : resolveAuto(number_sections, headingCount);

      let res: { code: number; stdout: string; stderr: string };

      if (chosen === "native") {
        const pandocArgs = buildPandocArgs({
          input: inputFile,
          output: outFile,
          header: headerFile,
          format: fmt,
          documentclass,
          classoption,
          topLevelDivision,
          shiftHeadings: shift,
          papersize,
          fontsize,
          margin: effectiveMargin,
          mainFont,
          monoFont,
          toc: wantToc,
          tocDepth: effectiveTocDepth,
          numberSections: wantNumbers,
        });
        res = await run("pandoc", pandocArgs, dirname(inputFile));
      } else {
        // Docker: stage input + header inside `scratch`, mount it at /data,
        // render to /data/out.pdf, copy the result to the host outFile. The
        // staged name keeps the source extension so pandoc's own format
        // detection agrees with the explicit --from we pass.
        const stagedName = `input.${INPUT_FORMATS[fmt]}`;
        await copyFile(inputFile, join(scratch, stagedName));
        const pandocArgs = buildPandocArgs({
          input: `/data/${stagedName}`,
          output: "/data/out.pdf",
          header: "/data/header.tex",
          format: fmt,
          documentclass,
          classoption,
          topLevelDivision,
          shiftHeadings: shift,
          papersize,
          fontsize,
          margin: effectiveMargin,
          mainFont,
          monoFont,
          toc: wantToc,
          tocDepth: effectiveTocDepth,
          numberSections: wantNumbers,
        });
        // The custom image bakes in the header's LaTeX packages, so the
        // upstream `pandoc` entrypoint is used directly.
        const dockerArgs = [
          "run",
          "--rm",
          "--platform",
          DOCKER_PLATFORM,
          "-v",
          `${scratch}:/data`,
          DOCKER_IMAGE,
          ...pandocArgs,
        ];
        res = await run("docker", dockerArgs);
        if (res.code === 0) {
          await copyFile(join(scratch, "out.pdf"), outFile);
        }
      }

      if (res.code !== 0) {
        const hint = chosen === "native" ? `\n${TLMGR_HINT}` : "";
        return errText(
          `pandoc/xelatex failed via ${chosen} engine (exit ${res.code}).${hint}\n\n` +
            `--- stderr ---\n${res.stderr}\n--- stdout ---\n${res.stdout}`,
        );
      }

      if (open_in !== "none") {
        await run("open", ["-a", open_in, outFile]);
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Rendered PDF: ${outFile} ` +
              `(preset: ${preset}, engine: ${chosen}, mcp-latex ${SERVER_VERSION})` +
              (open_in !== "none" ? `, opened in ${open_in}` : ""),
          },
        ],
      };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

function errText(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
