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

// Docker image with pandoc + a working TeX stack.
const DOCKER_IMAGE = "pandoc/latex:latest";
// Fonts that exist in the Docker image, used when the caller left the
// macOS-only defaults in place. TeX Gyre Pagella ≈ Palatino.
const DOCKER_MAIN_FONT = "TeX Gyre Pagella";
const DOCKER_MONO_FONT = "DejaVu Sans Mono";
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
    `mainfont=${opts.mainFont}`,
    "-V",
    `monofont=${opts.monoFont}`,
    "-V",
    "colorlinks=true",
    "-V",
    "linkcolor=Blue",
    "-V",
    "urlcolor=Blue",
    "-V",
    "toccolor=black",
  ];
  if (opts.toc) a.push("--toc");
  if (opts.numberSections) a.push("--number-sections");
  return a;
}

const TLMGR_HINT =
  "Hint: BasicTeX is minimal — if a .sty is missing, run " +
  "`sudo tlmgr install <pkg>` (fancyhdr lastpage newunicodechar xcolor).";

const server = new McpServer({ name: "mcp-latex", version: "0.1.0" });

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
    toc: z.boolean().default(true).describe("Include a table of contents."),
    number_sections: z.boolean().default(true),
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
    use_host_fonts: z
      .boolean()
      .default(false)
      .describe(
        "Docker engine only: mount the macOS font directories read-only into " +
          "the container (via OSFONTDIR) so the exact system fonts " +
          "(Palatino, Menlo, ...) are used instead of the container's " +
          "TeX Gyre fallbacks. Ignored for the native engine.",
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
      number_sections,
      engine,
      open_in,
      use_host_fonts,
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

    // Fonts: under Docker, swap the macOS-only defaults for the container's
    // TeX Gyre fallbacks — UNLESS we're mounting the host fonts, in which case
    // the real Palatino/Menlo are available. Explicit caller fonts are always
    // honored.
    const swapFonts = chosen === "docker" && !use_host_fonts;
    const mainFont =
      swapFonts && main_font === MAC_DEFAULT_MAIN ? DOCKER_MAIN_FONT : main_font;
    const monoFont =
      swapFonts && mono_font === MAC_DEFAULT_MONO ? DOCKER_MONO_FONT : mono_font;

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
          toc,
          numberSections: number_sections,
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
          toc,
          numberSections: number_sections,
        });
        const dockerArgs = ["run", "--rm", "-v", `${scratch}:/data`];
        if (use_host_fonts) {
          // Mount the macOS font dirs read-only and point fontconfig (via
          // xelatex's OSFONTDIR) at them so the real system fonts resolve.
          const fontDirs: Array<[string, string]> = [
            ["/System/Library/Fonts", "/hostfonts/system"],
            ["/Library/Fonts", "/hostfonts/library"],
            [join(process.env.HOME ?? "", "Library/Fonts"), "/hostfonts/user"],
          ];
          const osfontdir: string[] = [];
          for (const [host, mount] of fontDirs) {
            if (host && (await exists(host))) {
              dockerArgs.push("-v", `${host}:${mount}:ro`);
              osfontdir.push(mount);
            }
          }
          dockerArgs.push("-e", `OSFONTDIR=${osfontdir.join(":")}`);
        }
        dockerArgs.push(DOCKER_IMAGE, ...pandocArgs);
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
