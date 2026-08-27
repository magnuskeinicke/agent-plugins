#!/usr/bin/env bash
set -euo pipefail

# Sync the shared blocks from .claude/skills/_shared/ into each feature-dev
# workflow script. Workflow scripts must be self-contained (the Workflow runtime
# cannot import files), so the shared code lives once in _shared/ and is copied
# verbatim between the >>>/<<< markers in each target.
#
# Usage:
#   .claude/skills/_shared/sync.sh           # sync targets from _shared
#   .claude/skills/_shared/sync.sh --check   # exit 1 if any target drifted

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SHARED="$REPO_DIR/.claude/skills/_shared"
MODE="${1:-sync}"

WORK_SLICE="$REPO_DIR/.claude/skills/work-slice/work-slice-loop.workflow.js"
REVIEW_CODE="$REPO_DIR/.claude/skills/review-code/review-code.workflow.js"
ITERATE_PR="$REPO_DIR/.claude/skills/iterate-pr/iterate-pr.workflow.js"
SOLVE_READY="$REPO_DIR/.claude/skills/solve-ready-tickets/solve-ready-loop.workflow.js"

# target|block-name|source — a target may carry several blocks
PAIRS=(
  "$WORK_SLICE|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$WORK_SLICE|reviewer-registry|$SHARED/reviewer-registry.js"
  "$WORK_SLICE|loop-schemas|$SHARED/loop-schemas.js"
  "$REVIEW_CODE|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$REVIEW_CODE|reviewer-registry|$SHARED/reviewer-registry.js"
  "$ITERATE_PR|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$ITERATE_PR|reviewer-registry|$SHARED/reviewer-registry.js"
  "$ITERATE_PR|loop-schemas|$SHARED/loop-schemas.js"
  "$SOLVE_READY|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$SOLVE_READY|reviewer-registry|$SHARED/reviewer-registry.js"
)

status=0

# repo-config-defaults.js is GENERATED from docs/agents/repo-config.md's
# ## Config JSON block before syncing, so the md is the single source of truth
# for the workflow fallbacks. node runs via mise when not on PATH (git hooks).
REPO_CONFIG_MD="$REPO_DIR/docs/agents/repo-config.md"
REPO_CONFIG_JS="$SHARED/repo-config-defaults.js"
run_node() {
  if command -v node >/dev/null 2>&1; then node "$@"; else mise exec -- node "$@"; fi
}
gen_tmp="$(mktemp)"
run_node "$SHARED/gen-repo-config-defaults.mjs" "$REPO_CONFIG_MD" "$gen_tmp"
if [ "$MODE" = "--check" ]; then
  if ! diff -q "$REPO_CONFIG_JS" "$gen_tmp" >/dev/null 2>&1; then
    echo "DRIFT: $REPO_CONFIG_JS is out of sync with $REPO_CONFIG_MD (run: .claude/skills/_shared/sync.sh)"
    status=1
  fi
  rm -f "$gen_tmp"
elif ! diff -q "$REPO_CONFIG_JS" "$gen_tmp" >/dev/null 2>&1; then
  mv "$gen_tmp" "$REPO_CONFIG_JS"
  echo "generated: $REPO_CONFIG_JS (from docs/agents/repo-config.md)"
else
  rm -f "$gen_tmp"
  echo "up-to-date: $REPO_CONFIG_JS"
fi
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
      echo "DRIFT: $target block shared:$name is out of sync with $src (run: .claude/skills/_shared/sync.sh)"
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
