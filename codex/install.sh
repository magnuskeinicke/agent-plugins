#!/usr/bin/env bash
# Codex adapter: symlink every skill in this repo into Codex's personal skill dir.
#
# Preferred path is the Codex plugin marketplace (namespaced, see README). Use this
# script when you want the skills without the plugin machinery — e.g. on a machine
# where the marketplace snapshot is stale, or for a quick local test.
#
# Usage: codex/install.sh [--uninstall] [--dry-run]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/skills"
DEST_DIR="${CODEX_SKILLS_DIR:-$HOME/.codex/skills}"

UNINSTALL=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi
}

[ -d "$SRC_DIR" ] || { echo "no skills/ dir at $SRC_DIR" >&2; exit 1; }
run mkdir -p "$DEST_DIR"

linked=0 skipped=0 removed=0
for skill_path in "$SRC_DIR"/*/; do
  [ -d "$skill_path" ] || continue
  name="$(basename "$skill_path")"
  dest="$DEST_DIR/$name"

  if [ "$UNINSTALL" = 1 ]; then
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "${skill_path%/}" ]; then
      run rm "$dest"; removed=$((removed + 1))
    elif [ -e "$dest" ]; then
      echo "skip $name — not a link to this repo"; skipped=$((skipped + 1))
    fi
    continue
  fi

  if [ -L "$dest" ]; then
    run ln -sfn "${skill_path%/}" "$dest"; linked=$((linked + 1))
  elif [ -e "$dest" ]; then
    # A real directory here is someone else's skill (e.g. a vendored copy) — never clobber it.
    echo "skip $name — $dest exists and is not a symlink"; skipped=$((skipped + 1))
  else
    run ln -s "${skill_path%/}" "$dest"; linked=$((linked + 1))
  fi
done

if [ "$UNINSTALL" = 1 ]; then
  echo "unlinked $removed, skipped $skipped → $DEST_DIR"
else
  echo "linked $linked, skipped $skipped → $DEST_DIR"
fi
echo "Start a new Codex thread to pick up changes."
