#!/usr/bin/env bash
set -euo pipefail

# Sync the shared blocks into each feature-dev workflow script. Workflow scripts
# must be self-contained (the Workflow runtime cannot import files), so the
# shared code lives once here and is copied verbatim between the >>>/<<< markers
# in each target.
#
# Two of the three sources are ENGINE (they live in this plugin); one is HOST
# knowledge (it lives in the consuming repo, because it names that repo's domain
# skills and paths):
#
#   plugin  shared/loop-schemas.js
#   plugin  shared/repo-config-defaults.js   GENERATED from the host's
#                                            docs/agents/repo-config.md
#   host    .claude/skills/_shared/reviewer-registry.js
#
# Usage:
#   shared/sync.sh --host <repo>            # sync targets
#   shared/sync.sh --host <repo> --check    # exit 1 if any target drifted
#
# --host defaults to $HOST_REPO, else the current directory. Run this against
# the plugin WORKING COPY, never against an installed plugin cache dir —
# `claude plugin install` output is managed and would be overwritten.

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARED="$PLUGIN_DIR/shared"
HOST_REPO="${HOST_REPO:-$PWD}"
MODE="sync"

while [ $# -gt 0 ]; do
  case "$1" in
    --host)
      HOST_REPO="${2:?--host needs a path}"
      shift 2
      ;;
    --check)
      MODE="--check"
      shift
      ;;
    *)
      echo "usage: sync.sh [--host <repo>] [--check]" >&2
      exit 1
      ;;
  esac
done

HOST_REPO="$(cd "$HOST_REPO" && pwd)"
REPO_CONFIG_MD="$HOST_REPO/docs/agents/repo-config.md"
REVIEWER_REGISTRY="$HOST_REPO/.claude/skills/_shared/reviewer-registry.js"
test -f "$REPO_CONFIG_MD" || { echo "missing host file $REPO_CONFIG_MD"; exit 1; }
test -f "$REVIEWER_REGISTRY" || { echo "missing host file $REVIEWER_REGISTRY"; exit 1; }

WORK_SLICE="$PLUGIN_DIR/skills/work-slice/work-slice-loop.workflow.js"
REVIEW_CODE="$PLUGIN_DIR/skills/review-code/review-code.workflow.js"
ITERATE_PR="$PLUGIN_DIR/skills/iterate-pr/iterate-pr.workflow.js"
SOLVE_READY="$PLUGIN_DIR/skills/solve-ready-tickets/solve-ready-loop.workflow.js"

# target|block-name|source — a target may carry several blocks
PAIRS=(
  "$WORK_SLICE|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$WORK_SLICE|reviewer-registry|$REVIEWER_REGISTRY"
  "$WORK_SLICE|loop-schemas|$SHARED/loop-schemas.js"
  "$REVIEW_CODE|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$REVIEW_CODE|reviewer-registry|$REVIEWER_REGISTRY"
  "$ITERATE_PR|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$ITERATE_PR|reviewer-registry|$REVIEWER_REGISTRY"
  "$ITERATE_PR|loop-schemas|$SHARED/loop-schemas.js"
  "$SOLVE_READY|repo-config-defaults|$SHARED/repo-config-defaults.js"
  "$SOLVE_READY|reviewer-registry|$REVIEWER_REGISTRY"
)

status=0

# repo-config-defaults.js is GENERATED from the host repo's
# docs/agents/repo-config.md `## Config` block before syncing, so the md is the
# single source of truth for the workflow fallbacks. node runs via mise when not
# on PATH (git hooks).
REPO_CONFIG_JS="$SHARED/repo-config-defaults.js"
run_node() {
  if command -v node >/dev/null 2>&1; then node "$@"; else mise exec -- node "$@"; fi
}
gen_tmp="$(mktemp)"
run_node "$SHARED/gen-repo-config-defaults.mjs" "$REPO_CONFIG_MD" "$gen_tmp"
if [ "$MODE" = "--check" ]; then
  if ! diff -q "$REPO_CONFIG_JS" "$gen_tmp" >/dev/null 2>&1; then
    echo "DRIFT: $REPO_CONFIG_JS is out of sync with $REPO_CONFIG_MD (run: shared/sync.sh --host $HOST_REPO)"
    status=1
  fi
  rm -f "$gen_tmp"
elif ! diff -q "$REPO_CONFIG_JS" "$gen_tmp" >/dev/null 2>&1; then
  mv "$gen_tmp" "$REPO_CONFIG_JS"
  echo "generated: $REPO_CONFIG_JS (from $REPO_CONFIG_MD)"
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
      echo "DRIFT: $target block shared:$name is out of sync with $src (run: shared/sync.sh --host $HOST_REPO)"
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
