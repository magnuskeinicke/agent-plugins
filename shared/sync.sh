#!/usr/bin/env bash
set -euo pipefail

# Sync the shared blocks into each feature-dev workflow script. Workflow scripts
# must be self-contained (the Workflow runtime cannot import files), so the
# shared code lives once here and is copied verbatim between the >>>/<<< markers
# in each target.
#
# Every source is PLUGIN-owned and host-agnostic:
#
#   shared/repo-config-defaults.js   generic fallbacks for every repoConfig key
#   shared/reviewer-engine.js        review machinery (lanes, ledger, validator)
#   shared/loop-schemas.js           structured-output schemas for the loops
#
# Host-repo knowledge is NEVER baked in — it arrives at runtime as `repoConfig`
# in the workflow args, read by the skill from the host's
# docs/agents/repo-config.md. See CONTRACT.md.
#
# Usage:
#   shared/sync.sh            # sync targets
#   shared/sync.sh --check    # exit 1 if any target drifted
#
# Run this against the plugin WORKING COPY, never against an installed plugin
# cache dir — `claude plugin install` output is managed and would be overwritten.

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARED="$PLUGIN_DIR/shared"
MODE="sync"

while [ $# -gt 0 ]; do
  case "$1" in
    --check)
      MODE="--check"
      shift
      ;;
    *)
      echo "usage: sync.sh [--check]" >&2
      exit 1
      ;;
  esac
done

WORK_SLICE="$PLUGIN_DIR/skills/work-slice/work-slice-loop.workflow.js"
REVIEW_CODE="$PLUGIN_DIR/skills/review-code/review-code.workflow.js"
ITERATE_PR="$PLUGIN_DIR/skills/iterate-pr/iterate-pr.workflow.js"
SOLVE_READY="$PLUGIN_DIR/skills/solve-ready-tickets/solve-ready-loop.workflow.js"

# target|block-name|source — a target may carry several blocks. Order matters:
# repo-config-defaults must land above reviewer-engine in every target.
PAIRS=(
  "$WORK_SLICE|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$WORK_SLICE|reviewer-engine|$SHARED/reviewer-engine.js"
  "$WORK_SLICE|loop-schemas|$SHARED/loop-schemas.js"
  "$REVIEW_CODE|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$REVIEW_CODE|reviewer-engine|$SHARED/reviewer-engine.js"
  "$ITERATE_PR|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$ITERATE_PR|reviewer-engine|$SHARED/reviewer-engine.js"
  "$ITERATE_PR|loop-schemas|$SHARED/loop-schemas.js"
  "$SOLVE_READY|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$SOLVE_READY|reviewer-engine|$SHARED/reviewer-engine.js"
)

status=0

for pair in "${PAIRS[@]}"; do
  IFS='|' read -r target name src <<<"$pair"
  BEGIN="// >>> shared:$name"
  END="// <<< shared:$name"

  test -f "$src" || { echo "missing $src"; exit 1; }
  # readable + non-empty: awk's `getline` treats a read error like EOF, which
  # would silently strip the whole block from the target
  test -r "$src" || { echo "unreadable $src"; exit 1; }
  test -s "$src" || { echo "empty $src"; exit 1; }
  test -f "$target" || { echo "missing target $target"; exit 1; }
  grep -qF "$BEGIN" "$target" || { echo "missing '$BEGIN' marker in $target"; exit 1; }
  grep -qF "$END" "$target" || { echo "missing '$END' marker in $target"; exit 1; }

  tmp="$(mktemp)"
  awk -v src="$src" -v begin="$BEGIN" -v end="$END" '
    index($0, begin) == 1 {
      print
      while ((getline line < src) > 0) print line
      close(src)
      skipping = 1
      next
    }
    index($0, end) == 1 { skipping = 0 }
    skipping { next }
    { print }
  ' "$target" >"$tmp"

  if [ "$MODE" = "--check" ]; then
    if ! diff -q "$target" "$tmp" >/dev/null; then
      echo "DRIFT: $target block shared:$name is out of sync with $src (run: shared/sync.sh)"
      status=1
    fi
    rm -f "$tmp"
  else
    if ! diff -q "$target" "$tmp" >/dev/null; then
      mv "$tmp" "$target"
      echo "synced: $target (shared:$name)"
    else
      rm -f "$tmp"
      echo "up-to-date: $target (shared:$name)"
    fi
  fi
done

exit $status
