#!/usr/bin/env bash
# Install the mcp-latex MCP server + skill into a non-Claude host.
#
#   ./hosts/install.sh opencode [--global]              # default: ./.opencode in $PWD
#   ./hosts/install.sh hermes [--profile NAME] [--home PATH]
#
# The MCP config launches the server with `npx -y github:gbastkowski/mcp-latex`,
# so it needs no local checkout — npx fetches the committed bundle. Only the
# skill's manual-fallback path is localised (__MCP_LATEX_ROOT__ -> this repo).
# Re-runnable: existing skill/command files are overwritten, but hermes'
# config.yaml is only appended to when it has no `mcp_servers:` block yet; an
# existing mcp_servers block gets the latex snippet printed for manual merging.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:-}"
[ $# -gt 0 ] && shift

GLOBAL=false
PROFILE=""
HOME_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --global) GLOBAL=true ;;
    --profile) PROFILE="${2:?--profile needs a name}"; shift ;;
    --home) HOME_OVERRIDE="${2:?--home needs a path}"; shift ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
  shift
done

die() { printf 'error: %s\n' "$1" >&2; exit 1; }
subst() { sed "s|__MCP_LATEX_ROOT__|$ROOT|g" "$1"; }

hermes_home() {
  if [ -n "$HOME_OVERRIDE" ]; then
    printf '%s' "$HOME_OVERRIDE"
  elif [ -n "$PROFILE" ]; then
    if command -v hermes >/dev/null; then
      cfg="$(hermes --profile "$PROFILE" config path 2>/dev/null || true)"
      if [ -n "$cfg" ]; then
        dirname "$cfg"
        return
      fi
    fi
    printf '%s' "$HOME/.hermes/profiles/$PROFILE"
  elif [ -n "${HERMES_HOME:-}" ]; then
    printf '%s' "$HERMES_HOME"
  else
    printf '%s' "$HOME/.hermes"
  fi
}

command -v npx >/dev/null || die "npx not on PATH — install Node 18+"

case "$HOST" in
  opencode)
    if [ "$GLOBAL" = true ]; then
      dest="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
      cfg="$dest/opencode.json"
    else
      dest="$PWD/.opencode"
      cfg="$PWD/opencode.json"
    fi
    mkdir -p "$dest/commands" "$dest/skills/latex-pdf"
    subst "$ROOT/hosts/opencode/commands/render-pdf.md" > "$dest/commands/render-pdf.md"
    subst "$ROOT/hosts/opencode/skills/latex-pdf/SKILL.md" > "$dest/skills/latex-pdf/SKILL.md"
    if [ -e "$cfg" ]; then
      printf 'note: %s exists — merge the "mcp" block manually:\n\n' "$cfg" >&2
      subst "$ROOT/hosts/opencode/opencode.json" >&2
    else
      subst "$ROOT/hosts/opencode/opencode.json" > "$cfg"
      printf 'wrote %s\n' "$cfg"
    fi
    printf 'wrote %s/commands/render-pdf.md\nwrote %s/skills/latex-pdf/SKILL.md\n' "$dest" "$dest"
    ;;

  hermes)
    dest="$(hermes_home)"
    mkdir -p "$dest/skills/latex-pdf"
    subst "$ROOT/hosts/hermes/skills/latex-pdf/SKILL.md" > "$dest/skills/latex-pdf/SKILL.md"
    printf 'wrote %s/skills/latex-pdf/SKILL.md\n' "$dest"

    cfg="$dest/config.yaml"
    if [ ! -e "$cfg" ]; then
      # drop the two explanatory comment lines — they only make sense in the repo copy
      subst "$ROOT/hosts/hermes/config.yaml" | tail -n +3 > "$cfg"
      printf 'wrote %s\n' "$cfg"
    elif grep -qE '^[[:space:]]+latex:' "$cfg"; then
      printf 'note: %s already has a latex MCP entry — left untouched\n' "$cfg"
    elif grep -qE '^mcp_servers:' "$cfg"; then
      printf 'note: %s already has mcp_servers — add this under it:\n\n' "$cfg" >&2
      subst "$ROOT/hosts/hermes/config.yaml" | tail -n +4 >&2
    else
      subst "$ROOT/hosts/hermes/config.yaml" | tail -n +3 >> "$cfg"
      printf 'appended mcp_servers.latex to %s\n' "$cfg"
    fi
    printf 'reload in-session with /reload-mcp\n'
    ;;

  *)
    die "usage: $0 {opencode [--global]|hermes [--profile NAME] [--home PATH]}"
    ;;
esac
