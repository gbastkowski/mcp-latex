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
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// assets live next to package root: mcp/assets/, dist/ is a sibling.
const TEMPLATE_PATH = join(__dirname, "..", "assets", "header.tex.tmpl");

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
// are only used by the native engine.
const MAC_DEFAULT_MAIN = "Palatino";
const MAC_DEFAULT_MONO = "Menlo";

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

// In 'auto' mode a document with fewer than this many headings is treated as
// "simple": no table of contents and no section numbering.
const SIMPLE_DOC_MAX_HEADINGS = 3;

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
  papersize: string;
  fontsize: string;
  margin: string;
  mainFont: string;
  monoFont: string;
  toc: boolean;
  tocDepth: number;
  numberSections: boolean;
}): string[] {
  const a = [
    opts.input,
    "-o",
    opts.output,
    "--pdf-engine=xelatex",
    `--include-in-header=${opts.header}`,
    "-V",
    "documentclass=article",
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
  if (opts.mainFont) a.push("-V", `mainfont=${opts.mainFont}`);
  if (opts.monoFont) a.push("-V", `monofont=${opts.monoFont}`);
  if (opts.toc) a.push("--toc", `--toc-depth=${opts.tocDepth}`);
  if (opts.numberSections) a.push("--number-sections");
  return a;
}

const TLMGR_HINT =
  "Hint: BasicTeX is minimal — if a .sty is missing, run " +
  "`sudo tlmgr install <pkg>` (fancyhdr lastpage newunicodechar soul xcolor).";

const server = new McpServer({ name: "mcp-latex", version: "1.0.0" });

server.tool(
  "render_markdown_to_pdf",
  "Render a Markdown document to a nicely-styled PDF using pandoc + xelatex " +
    "(classic-but-tuned Palatino report: fancyhdr header/footer with 'Page N of M', " +
    "subtle dark-blue links, A4, TOC, numbered sections). Runs natively (macOS " +
    "fonts, can open in Skim) or in a Docker image (portable/reproducible).",
  {
    markdown_path: z
      .string()
      .optional()
      .describe("Path to the input Markdown file. Provide this OR `markdown`."),
    markdown: z
      .string()
      .optional()
      .describe("Inline Markdown source. Provide this OR `markdown_path`."),
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
          "'TeX Gyre Pagella' under the docker engine.",
      ),
    mono_font: z
      .string()
      .default(MAC_DEFAULT_MONO)
      .describe(
        "Monospace font. The macOS default 'Menlo' is auto-swapped to " +
          "'DejaVu Sans Mono' under the docker engine.",
      ),
    papersize: z.string().default("a4"),
    fontsize: z.string().default("11pt"),
    margin: z.string().default("2.5cm").describe("Page margin, e.g. '2.5cm'."),
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

    if (!markdown_path && markdown === undefined) {
      return errText("Provide either `markdown_path` or `markdown`.");
    }

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

    // Fonts: the native engine uses the requested macOS fonts. The Docker
    // image has no system fonts, so drop the macOS defaults there and let
    // xelatex fall back to Latin Modern. An explicit non-default font is still
    // passed through (the caller is then responsible for it existing).
    const mainFont =
      chosen === "docker" && main_font === MAC_DEFAULT_MAIN ? "" : main_font;
    const monoFont =
      chosen === "docker" && mono_font === MAC_DEFAULT_MONO ? "" : mono_font;

    const scratch = await mkdtemp(join(tmpdir(), "mcp-latex-"));
    try {
      // Resolve/prepare the input file and final output path (host side).
      let inputFile: string;
      let outFile: string;
      if (markdown_path) {
        inputFile = resolve(markdown_path);
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
        inputFile = join(scratch, "document.md");
        await writeFile(inputFile, markdown ?? "", "utf8");
        outFile = output_path ? resolve(output_path) : resolve("document.pdf");
      }

      // Build header.tex from the template.
      const tmpl = await readFile(TEMPLATE_PATH, "utf8");
      const header = tmpl
        .replace(/__TITLE__/g, texEscape(title))
        .replace(/__HEADER_RIGHT__/g, texEscape(header_right))
        .replace(/__LINK_COLOR__/g, link_color.replace(/^#/, ""));
      const headerFile = join(scratch, "header.tex");
      await writeFile(headerFile, header, "utf8");

      // Resolve the tri-state toc / number_sections. In 'auto', a document is
      // "simple" (no TOC, no numbering) when it has fewer than this many
      // headings — a short doc reads better plain.
      const source =
        markdown ?? (await readFile(inputFile, "utf8").catch(() => ""));
      const headingCount = countHeadings(source);
      const wantToc = resolveAuto(toc, headingCount);
      const wantNumbers = resolveAuto(number_sections, headingCount);

      let res: { code: number; stdout: string; stderr: string };

      if (chosen === "native") {
        const pandocArgs = buildPandocArgs({
          input: inputFile,
          output: outFile,
          header: headerFile,
          papersize,
          fontsize,
          margin,
          mainFont,
          monoFont,
          toc: wantToc,
          tocDepth: toc_depth,
          numberSections: wantNumbers,
        });
        res = await run("pandoc", pandocArgs, dirname(inputFile));
      } else {
        // Docker: stage input + header inside `scratch`, mount it at /data,
        // render to /data/out.pdf, copy the result to the host outFile.
        const stagedInput = join(scratch, "input.md");
        await copyFile(inputFile, stagedInput);
        const pandocArgs = buildPandocArgs({
          input: "/data/input.md",
          output: "/data/out.pdf",
          header: "/data/header.tex",
          papersize,
          fontsize,
          margin,
          mainFont,
          monoFont,
          toc: wantToc,
          tocDepth: toc_depth,
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
              `Rendered PDF: ${outFile} (engine: ${chosen})` +
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
