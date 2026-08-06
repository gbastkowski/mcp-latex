#!/usr/bin/env python3
"""Render every preset demo THROUGH THE MCP SERVER.

    python3 demos/render.py [--open] [preset ...]

Speaks JSON-RPC to mcp/dist/index.js rather than assembling its own pandoc
calls. That distinction matters: driving pandoc directly skips preset
composition, the per-type defaults and the heading shift, so the PDFs stop
reflecting what a real MCP client actually gets. Build the bundle first
(`cd mcp && npm run bundle`) — this uses dist/, not src/.

Each type gets source material shaped like the thing it is for. A technical
document says nothing about whether a masthead and a dateline work, and a
four-page report reveals nothing about chapter openings or a deep TOC.

Output lands in demos/out/, which is git-ignored. Paths are stable, so a PDF kept
open in a viewer reloads in place as templates are tuned.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SERVER = REPO / "mcp" / "dist" / "index.js"
SOURCES_DIR = REPO / "demos" / "sources"
OUT = REPO / "demos" / "out"

LAYOUTS = ["classic", "ista", "eisvogel"]
TYPES = ["report", "newspaper", "reference", "koma", "komabook"]

# The KOMA variants deliberately reuse their standard-class counterpart's source,
# so the comparison is like-for-like: same copy, different typography.
SOURCE_FOR_TYPE = {
    "report": "report.md",
    "newspaper": "newspaper.md",
    "reference": "reference.md",
    "koma": "report.md",
    "komabook": "reference.md",
}


def rpc_lines(presets: list[str]) -> list[str]:
    lines = [
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "demos", "version": "1"},
                },
            }
        ),
        json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
    ]
    for i, preset in enumerate(presets, start=2):
        doc_type = preset.split("-", 1)[1]
        lines.append(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": i,
                    "method": "tools/call",
                    "params": {
                        "name": "render_markdown_to_pdf",
                        "arguments": {
                            "input_path": str(SOURCES_DIR / SOURCE_FOR_TYPE[doc_type]),
                            "output_path": str(OUT / f"{preset}.pdf"),
                            "preset": preset,
                            # The preset name goes in `title` so each PDF stays
                            # identifiable with all fifteen open at once. It also
                            # feeds the running head; the newspaper masthead comes
                            # from the document's own YAML metadata, so it is
                            # unaffected.
                            "title": preset,
                            "header_right": preset,
                            "open_in": "none",
                        },
                    },
                }
            )
        )
    return lines


def pages(pdf: Path) -> str:
    try:
        info = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True
        ).stdout
    except FileNotFoundError:
        return "?"
    for line in info.splitlines():
        if line.startswith("Pages"):
            return line.split()[1]
    return "?"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("presets", nargs="*", help="presets to render (default: all)")
    ap.add_argument(
        "--open",
        action="store_true",
        help="open the rendered PDFs in Skim when finished (macOS)",
    )
    args = ap.parse_args()

    all_presets = [f"{l}-{t}" for l in LAYOUTS for t in TYPES]
    presets = args.presets or all_presets
    unknown = [p for p in presets if p not in all_presets]
    if unknown:
        print(f"unknown preset(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"valid: {', '.join(all_presets)}", file=sys.stderr)
        return 2

    if not SERVER.exists():
        print(
            f"missing {SERVER.relative_to(REPO)} — run: (cd mcp && npm install && npm run bundle)",
            file=sys.stderr,
        )
        return 2

    OUT.mkdir(parents=True, exist_ok=True)

    proc = subprocess.run(
        ["node", str(SERVER)],
        input="\n".join(rpc_lines(presets)) + "\n",
        capture_output=True,
        text=True,
        timeout=900,
    )

    results = {}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        content = msg.get("result", {}).get("content")
        if content and msg.get("id"):
            results[msg["id"]] = content[0]["text"]

    failed = 0
    for i, preset in enumerate(presets, start=2):
        text = results.get(i, "(no response)")
        if text.startswith("Rendered PDF:"):
            # The server echoes the preset it actually used. Check it: omitting the
            # argument makes it fall back to the default silently, which renders a
            # perfectly good PDF of the wrong preset and reports success.
            if f"preset: {preset}" not in text:
                failed += 1
                print(f"{preset:<20} WRONG PRESET  {' '.join(text.split())[:160]}")
                continue
            print(f"{preset:<20} OK  {pages(OUT / f'{preset}.pdf')}p")
        else:
            failed += 1
            print(f"{preset:<20} FAIL  {' '.join(text.split())[:160]}")

    if proc.stderr.strip():
        print("--- server stderr ---", file=sys.stderr)
        print(proc.stderr[-800:], file=sys.stderr)

    if args.open and not failed:
        subprocess.run(
            ["open", "-a", "Skim"] + [str(OUT / f"{p}.pdf") for p in presets],
            check=False,
        )

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
