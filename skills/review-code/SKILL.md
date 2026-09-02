---
name: review-code
description: Run the shared reviewer roster (engine CLI, review-only mode) on any code, any time — uncommitted changes, a branch diff, or a PR. One read-only classified review round, findings report back; no fix loop, no ticket needed. Use when the user says "review this code", "spawn the review agents", "run the reviewer lanes", "review my diff/working tree/branch", or wants the work-slice reviewers on ad-hoc code.
---

# Review Code

Run the **same reviewer roster** the feature-dev loops (`/work-slice`, `/iterate-pr`) use — gut-check pre-pass, always-on + mechanically-triggered roster lanes, the reuse audit — on **any** code, standalone, through the plugin's **engine CLI in review-only mode**. One read-only round; the relevance validator classifies every finding before it reaches the report, so the human sees **blocking** (≥80 confidence, diff-caused), **advisory** (60–79, or confident-but-pre-existing), and **unverified** (<60) findings separately, each under a stable `CR-NNN` id. No implementer, no fix loop, no Playwright, no ticket: the human decides what to do with the findings.

## Repo contract — resolve this first

The engine CLI reads `docs/agents/repo-config.md` itself (`--config`, defaulting
to that path in the host repo root). The placeholders below stand for its values
where this skill acts directly. Missing file or empty key → the generic
defaults apply and you say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |

Which reviewers exist and when they trigger: `../work-slice/references/reviewer-roster.md`
(documentation; `engine/lib/roster.mjs` is the source of truth). The host's
`reviewers.*` / `areaPaths` config is an additive focus overlay the CLI applies
itself — tune the md, never fork lanes here.

## Step 1 — Resolve the review target

Input is optional: a base ref/branch, a PR number, specific files, or nothing.

- **Nothing given, dirty worktree** (`git status --porcelain` non-empty) → review the **uncommitted work**: `inspect = "git diff HEAD"`, changed/added/deleted = `git diff --name-only [--diff-filter=A|D] HEAD`, untracked = the `??` paths from `git status --porcelain` (source files only — skip build artifacts/screenshots).
- **Nothing given, clean worktree** → review the **branch vs its base**: base = `<BASE>`, no inspect override (the CLI defaults to `git diff <base>...HEAD`). Changed/added/deleted via `--name-only` / `--diff-filter` on that range.
- **Base ref given** ("review against X") → same as above with that base.
- **PR number given** → don't check anything out: `inspect = "gh pr diff <n>"`, changed = `gh pr diff <n> --name-only`, added = paths whose hunk starts from `/dev/null` (`new file mode` entries). Reviewers see only the diff, not a checkout — say so in the contract, and note that file-level verification is degraded.
- **Specific files given** → `inspect = "git diff HEAD -- <paths>"`; files with no diff go in the untracked list so reviewers read them in full.

If there is nothing to review (clean tree AND no commits past base), stop and tell the user.

Also capture:

- `insertions` — inserted-line count from `git diff --shortstat` on the same range (0 when unknown).
- `declaredAreas` (optional, from `frontend|backend|database|i18n|security|performance`) when the change touches an area its paths don't reveal — e.g. an auth-relevant change in a neutral path → declare `security`.
- `userFacing` — biases **true**; false only for clearly internal-only changes.

## Step 2 — Run the review round (engine CLI)

The round is driven by the plugin's **engine CLI**. **Loop control is
deterministic CLI output, never prose discipline:** run each command from the
host repo root, read the JSON it prints, and do what its `action` / `next`
field says. Run state lives in the host repo's gitignored `.context/<run-id>/`.

Resolve `<ENGINE>` once — it lives in the **plugin install root**, not the host repo:

```bash
engine="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/engine/cli.mjs}"
[ -n "$engine" ] && [ -f "$engine" ] || engine="$(realpath "<this-skill-dir>/../..")/engine/cli.mjs"  # symlinked install
[ -f "$engine" ] || engine="$(ls -d "$HOME"/.claude/plugins/cache/*/magnus/*/engine/cli.mjs 2>/dev/null | sort -V | tail -1)"
```

**Run id:** `review-$(date +%Y%m%d-%H%M%S)` — each invocation is a fresh run.
(Resuming an interrupted run instead: find the newest `.context/review-*`
dir and ask `status` where it stopped.)

**Write the contract.** `mkdir -p .context/<run-id>` and write
`.context/<run-id>/contract.md`: what the change is / what to judge it against
(acceptance criteria, a ticket description, "pre-commit check" — whatever
context you have; say when you have none), the untracked files to read in full
(they are invisible to the diff), and for a PR-diff-only target the caveat that
the local checkout does not contain the change.

**Drive the CLI:**

```bash
node "$engine" init --slice <run-id> --base <base-or-HEAD> --review-only \
  [--inspect '<inspect cmd from Step 1>']        # omit for a plain branch-vs-base review
node "$engine" plan --slice <run-id> --changed-files <csv> --added-files <csv> --deleted-files <csv> \
  --insertions <n> --user-facing <bool> [--declared-areas <csv>]
# → the round's task manifest: prePass (gut-check), reviewers[]
node "$engine" collect --slice <run-id>
# → validator task when findings survived; run it, then
node "$engine" decide --slice <run-id> --verdicts <verdicts.json>
# → action=report (or hard-stop on a gut-check block)
node "$engine" report --slice <run-id>
```

`--review-only` makes the run single-round: `decide` classifies and stops —
no fix prompt is ever emitted.

**Running an emitted task.** Every task names an `agentFile` (roster file —
its body is the agent's system prompt), a `promptFile`, an `outputFile` (the
JSON the agent must write), and a `model` + `effort` when the roster pins
them. Mechanism
is runtime-dependent; **subagents are an optional accelerator, the round is
sequential-first**: Claude spawns each reviewer as a subagent (its definition's
pins apply; read-only, so
run them **in parallel**); Codex runs background `codex exec` children with
the agent-file body prepended, the task's `model` alias mapped through
`routing.codexModelAliases` and passed with its `effort` as the child's
model/effort flags; with neither, run each reviewer yourself, one
at a time, adopting the roster persona fresh — and disclose the fallback once.

Ground rules:

- **Gut-check runs first.** A `"disposition": "block"` observation → run `collect` immediately; it hard-stops for the human before any reviewer spend.
- **Every emitted reviewer must report before `collect` settles.** `collect` lists `missing` and `invalid` reports: re-run each dead reviewer once, then run `collect` again; still dead → proceed, but the verdict is NOT clean — state the degraded coverage explicitly.
- **Reviewers and the validator are read-only** — the only side effect of this skill is the report. Reporters run on a leaner model; aliases only, never exact model ids.
- Never hand-edit `.context/<run-id>/ledger.json` or a findings file.

## Step 3 — Present the report

Print, from `report`'s output plus the findings files:

- **Verdict verbatim**: `clean`, or `N blocking finding(s) (CR-…)`. `clean` only counts when every emitted reviewer reported — a round with dead reviewers is not clean even with zero findings.
- Which reviewers ran, and any that died (from `collect`'s `missing`/`invalid`).
- **Blocking** (`report.blocking`): one block each — `CR-NNN [source] title (file:line)`, detail, suggested fix, confidence.
- **Advisory** (`report.advisoryNotes`): 60–79 confidence or confident-but-pre-existing — worth a glance, never "fix before ship".
- **Unverified** (`report.unverified`): listed so nothing dies silently; noise unless something rings true.
- **Notes**: the `notes` arrays from `.context/<run-id>/round-1/findings/*.json` — judgement-call points, grouped by reviewer.
- **Consolidations**: the `consolidations` arrays from the same files — generalizable-code candidates (the workflow skills would file these as tickets; here just list them).

Then **stop** — findings are the deliverable. Do not fix anything unless the user asks; if they do, fixing happens in the main session as a normal task (there is no fix loop in this skill).

## Boundaries

- **Read-only, always.** No edits, no commits, no branch changes, no checkouts, no tickets. The only side effect is the report (and the gitignored `.context/<run-id>/` state).
- One round, CLI-enforced (`--review-only`). No fix ⇄ review loop — that machinery belongs to `/work-slice` / `/iterate-pr`.
- No Playwright — user-story verification needs acceptance criteria and a runnable slice; out of scope here.
- **The CLI owns the round.** Reviewer selection, suppression, classification thresholds, and the verdict come from `<ENGINE>`'s JSON — never re-derive them, never hand-edit its state files, never skip a command because you "know" what it will say.
- The roster in `agents/` is the lane source; the host's `reviewers.*` config is an additive focus overlay the CLI applies. Tune `docs/agents/repo-config.md`, never fork lanes inline.
- The relevance validator classifies findings — it never adds its own; a dead validator means findings pass through unclassified (reported as blocking), never silently dropped.
- The reuse audit runs without a provenance table here (ad-hoc code has none) — it hunts lib duplicates and consolidation candidates only.
- No review CLI runs here (or anywhere in the suite) — bot reviews such as CodeRabbit happen on GitHub PRs only, via `/babysit-stack`.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow

## Workflow Boundaries

**This skill runs one read-only classified review round on ad-hoc code — findings are the whole deliverable.**

- **DOES**: resolve the target (uncommitted work, branch vs base, PR diff, named files), write the contract, drive the engine CLI in `--review-only` mode, present blocking / advisory / unverified findings under stable `CR-NNN` ids plus notes and consolidation candidates.
- **DOES NOT**: fix anything or loop (`/work-slice` / `/iterate-pr` own fix rounds), check out PR branches, run Playwright, file tickets (consolidations are listed only), edit any file.

## Red Flags — STOP

- About to edit code, commit, check anything out, or file a ticket — stop: the report (and gitignored `.context/<run-id>/`) is the only side effect.
- About to run a second round or act on a fix impulse — stop: `--review-only` is single-round; `decide` classifies and stops.
- About to call the round `clean` while a reviewer is dead — stop: re-run it once; still dead → degraded coverage, verdict NOT clean.
- Gut-check returned a `"disposition": "block"` — stop the reviewers and run `collect` immediately; it hard-stops for the human.
- About to hand-edit `.context/<run-id>/ledger.json` / a findings file, or re-derive the classification thresholds — stop: the CLI owns the round.
- About to run a review CLI (CodeRabbit or similar) as a lane — stop: bot reviews live on GitHub PRs, not in this round.

## Verification

Before reporting done:

- [ ] Verdict verbatim (`clean` or `N blocking finding(s) (CR-…)`) plus which reviewers ran and which died.
- [ ] Blocking, advisory, and unverified findings presented separately — unverified listed, never silently dropped.
- [ ] Untracked source files were named in the contract (invisible to the diff); a PR-diff-only target's degraded-verification caveat is stated.
- [ ] Notes and consolidations from `.context/<run-id>/round-1/findings/*.json` are in the report.
- [ ] The working tree is untouched — no edits, commits, or checkouts; the round stopped at the report.
