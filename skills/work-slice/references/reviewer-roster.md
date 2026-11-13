# Reviewer roster reference

Documentation only — **`engine/lib/roster.mjs` is the source of truth**; the
CLI's `plan` output tells you which reviewers run each round. Never select
reviewers from this file. On any mismatch, the CLI wins.

The roster is vendored from kramme-cc-workflow (MIT, `agents/sources.yaml`).
One agent file serves both runtimes: on Claude `agents/<id>.md` is a spawnable
subagent definition, registered as `magnus:<id>` (the task's `subagentType`);
on Codex the same file's body is the `codex exec` child's system prompt. Each
loop agent ends with a marked persona-proof section, so `collect` can tell its
report from one written by another plugin's reviewer. The host repo's `repoConfig.reviewers` / `areaPaths` are an
**additive focus overlay** on the roster prompts, never the lane source
(CONTRACT.md).

## Tiers

| Reviewer | Tier | Runs when |
| --- | --- | --- |
| `code-reviewer` | always | every round |
| `silent-failure-hunter` | always | every round |
| `deslop-reviewer` | always | every round |
| `cleanup-reviewer` | round 1 | full slice diff, one invocation over the lean, removal, refactor and simplify dimensions; later rounds while it owns an open finding, or when the fix range deletes files (hint `removal`) |
| `codebase-pattern-reviewer` | round 1, *diff reuse audit mode* | re-runs each fix round until a clean pass with an unchanged added-file set + provenance table (the CLI tracks the fingerprint); carries the magnus provenance audit + libMap duplicate hunt |
| `comment-analyzer` | round 1 | full slice diff — owns the rename-over-comment lane (a comment a better function/parameter/variable name would delete); re-triggers on a fix round that touched docs/markdown, or hint `comments` |
| `pr-test-analyzer` | conditional | test files touched, or any file added |
| `type-design-analyzer` | conditional | type/schema files touched, or hint `types` |
| `convention-drift-reviewer` | conditional, *convention review mode* | ≥10 changed files, or hint `conventions` |
| `overengineering-reviewer` | conditional, *necessity-review mode* | files added, or >150 inserted lines |
| `performance-oracle` | area | `performance`, `backend`, or `database` triggered |
| `security-reviewer` | area | `security` triggered — one invocation runs the injection, access-control, data-protection and logic lenses |
| `a11y-auditor` | area | `frontend` triggered |
| `copy-reviewer` | area | `frontend` triggered AND the change is user-facing |

Selection per round (deterministic in `selectReviewers()`): round 1 = always +
round-1 tier + every triggered conditional; fix rounds = always + owners of
open findings + conditionals re-triggered by the fix range's files + round-1
members with a re-run rule.

## Areas

Areas come from matching changed files against `repoConfig.areaPaths` (generic
patterns by default): `frontend`, `backend`, `database`, `i18n`, `security`,
`performance`. Two force-adds: `frontend` always pulls in `performance`
(which has no path triggers of its own), `backend` always pulls in `security`.
The implementer's `touchedAreas` declaration adds areas paths alone would miss.

## One-shots and off-loop agents

- **gut-check pre-pass** — round 1 only, runs BEFORE the roster (a `block`
  observation hard-stops the run before any reviewer spend). Self-contained
  prompt, no roster file.
- **`pr-relevance-validator`** — the validate stage, never a lane.
- `architecture-strategist`, `design-iterator`, `product-reviewer`,
  `ux-reviewer`, `visual-reviewer` — vendored for other skills' flows; never
  join this loop.

## Focus overlays

`OVERLAY_AREAS` maps each reviewer to the host `reviewers.<area>` overlays its
prompt picks up (intersected with the round's triggered areas). Generalists
(`code-reviewer`, `cleanup-reviewer`, `codebase-pattern-reviewer`, `convention-drift-reviewer`) take every triggered
area's overlay; specialists take only their own (e.g. `security-reviewer` takes
`security`, `copy-reviewer` takes `frontend` + `i18n`); some take none.

## Model roles

The registry in `engine/lib/models.mjs` supplies explicit role profiles for both
runtimes. Read `runtime.md` for resolution, overrides, task manifests and the
native/CLI launch contract. Roster Claude pins remain defaults; their Codex
aliases map through `routing.codexModelAliases`. Unknown aliases are errors.
