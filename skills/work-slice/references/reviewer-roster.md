# Reviewer roster reference

Documentation only — **`engine/lib/roster.mjs` is the source of truth**; the
CLI's `plan` output tells you which reviewers run each round. Never select
reviewers from this file. On any mismatch, the CLI wins.

The roster is vendored from kramme-cc-workflow (MIT, `agents/sources.yaml`).
One agent file serves both runtimes: on Claude `agents/<id>.md` is a spawnable
subagent definition; on Codex the same file's body is the `codex exec` child's
system prompt. The host repo's `repoConfig.reviewers` / `areaPaths` are an
**additive focus overlay** on the roster prompts, never the lane source
(CONTRACT.md).

## Tiers

| Reviewer | Tier | Runs when |
| --- | --- | --- |
| `code-reviewer` | always | every round |
| `silent-failure-hunter` | always | every round |
| `deslop-reviewer` | always | every round |
| `lean-reviewer` | round 1 | full slice diff; later rounds only while it owns an open finding |
| `code-simplifier` | round 1 | same re-run rule |
| `codebase-pattern-reviewer` | round 1, *diff reuse audit mode* | re-runs each fix round until a clean pass with an unchanged added-file set + provenance table (the CLI tracks the fingerprint); carries the magnus provenance audit + libMap duplicate hunt |
| `pr-test-analyzer` | conditional | test files touched, or any file added |
| `comment-analyzer` | conditional | docs/markdown touched, or hint `comments` |
| `type-design-analyzer` | conditional | type/schema files touched, or hint `types` |
| `removal-planner` | conditional | files deleted, or hint `removal` |
| `convention-drift-reviewer` | conditional, *convention review mode* | ≥10 changed files, or hint `conventions` |
| `overengineering-reviewer` | conditional, *necessity-review mode* | files added, or >150 inserted lines |
| `performance-oracle` | area | `performance`, `backend`, or `database` triggered |
| `injection-reviewer` | area (security bundle) | `security` triggered — the four security reviewers always launch together |
| `auth-reviewer` | area (security bundle) | `security` triggered |
| `data-reviewer` | area (security bundle) | `security` triggered |
| `logic-reviewer` | area (security bundle) | `security` triggered |
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
(`code-reviewer`, `lean-reviewer`, `code-simplifier`,
`codebase-pattern-reviewer`, `convention-drift-reviewer`) take every triggered
area's overlay; specialists take only their own (e.g. the security bundle takes
`security`, `copy-reviewer` takes `frontend` + `i18n`); some take none.

## Model roles

Role-based, aliases only — never pin exact model ids or effort levels:

- **Writers get the strongest model**: the implement pass, every fix pass
  (code-review and Playwright), and the closeout adjudicator (it overrules
  both sides, so it gets the strongest judgement).
- **Reporters run leaner**: every roster reviewer, the gut-check pre-pass, the
  relevance validator, and the read-only Playwright
  verifier (browser transcripts are token-heavy).

A roster file may name its own `model:` in frontmatter; the CLI surfaces it in
`plan` output — honor it when present.
