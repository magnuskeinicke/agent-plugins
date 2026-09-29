---
name: iterate-pr
description: >
  Run bounded review and fix rounds on an existing pull request using the
  shared reviewer engine, then babysit CI and GitHub review bots to a terminal
  verdict. Fresh workers use explicit Claude or Codex model profiles. Resumes
  interrupted rounds without restarting completed work. Use when the user says
  "iterate on PR", "polish this PR", or "review and fix this PR".
argument-hint: "[PR number | issue id | nothing = current branch's PR]"
---

# Iterate PR

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `iterate-pr`; supporting skills inherit the caller’s resolved role.

Take an **existing PR** and run the same bounded **review ⇄ fix loop** `/work-slice` uses — the plugin's **engine CLI** drives gut-check, the roster reviewers, the relevance validator, the finding ledger (stable `CR-NNN` ids), test-first fix passes, and the stop conditions — without any of the pipeline around it. No PRD, no slice claim, no Playwright during its review loop. The loop converges (or stalls), the fixes are pushed to the PR branch, and a `/babysit-stack` finish stage babysits the PR the rest of the way to "in order" — CI green, the GitHub review bots satisfied in order, threads resolved — waiting for each bot round itself. **Run the skill again to resume** after a Blocked stop.

Division of labour with the siblings:

- **`/review-code`** — one read-only round, report only. Use it when nothing should be changed.
- **`/iterate-pr`** (this) — review ⇄ fix rounds with **our** reviewers on a PR, then babysit that PR to done.
- **`/babysit-stack`** — CI, the GitHub review bots (`<BOT>` then `<COMMENT-BOT>`), and **existing review threads**. This skill's own loop never touches threads — it delegates all of that to babysit in Step 5.

## Repo contract — resolve this first

The engine CLI reads `docs/agents/repo-config.md` itself (`--config`, defaulting
to that path in the host repo root). The placeholders below stand for its values
where this skill acts directly. Missing file or empty key → the generic
defaults apply and you say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BOT>` | `pr.botReviewer` | babysit skips the review-request bot phase |
| `<COMMENT-BOT>` | `pr.commentReviewer` | babysit skips the comment-summoned bot phase |
| `<STACK>` | `pr.stackTool` | plain branches; nothing to restack |
| `<MEDIA-BRANCH>` | `pr.mediaBranch` | `pr-media` — only used when a stale scene must be re-rendered |
| `<COMMIT-RULE>` | `commit.format` / `commit.pattern` — resolved by the engine (`node "$engine" commit-rule`) | the `pr.titleRule` / `pr.scopes` shape, else `<type>: <subject>` |

Which reviewers exist and when they trigger: `../work-slice/references/reviewer-roster.md`
(documentation; `engine/lib/roster.mjs` is the source of truth).

## Step 1 — Resolve the PR and its branch

Input: a PR number, an issue id, or nothing.

- **Nothing** → the current branch's PR: `gh pr view --json number,headRefName,baseRefName,title,body,state,isDraft`.
- **Issue id** → `gh pr list --state open --search "<ISSUE>" --json number,headRefName,baseRefName,title,isDraft` (ambiguous → ask).
- **PR number** → `gh pr view <n> --json …` as above.

The PR must be **open**. Merged/closed → stop and tell the user.

**Get the branch checked out here:**

- Current branch == `headRefName` → done.
- Otherwise: the worktree must be clean (`git status --porcelain` empty — else stop and ask); check `git worktree list` — **never check out a branch held by another worktree** (stop and name the worktree instead); then `git fetch origin <headRefName> && git checkout <headRefName>` and make sure it's up to date with the remote (`git pull --ff-only`).

**Resolve the diff base:** `origin/<baseRefName>` — for a stacked PR that is the predecessor's branch, so the loop reviews only this PR's own diff. Run `git fetch origin <baseRefName>` first. Compute:

```bash
changedFiles: git diff --name-only origin/<base>...HEAD
addedFiles:   git diff --name-only --diff-filter=A origin/<base>...HEAD
deletedFiles: git diff --name-only --diff-filter=D origin/<base>...HEAD
insertions:   git diff --shortstat origin/<base>...HEAD   # the inserted-line count
```

If the diff is empty, stop — nothing to iterate.

Also capture:

- `head`: `git rev-parse HEAD` — seeds the focused re-review delta.
- `testsGreen`: from `gh pr checks <n>` — `true` only when the head's checks are green; failing or still-pending checks → `false`, which makes the CLI spend round 1 on a gate-fix pass instead of reviewers (an existing commit is no evidence its tests pass).

## Step 2 — Gather context

- PR title + body (trim the stack tool's navigation section, if any).
- If the title carries an `<ISSUE>` id → fetch that issue from `<TRACKER>` and include its **acceptance criteria** (and `## Test plan` if present) — that's what reviewers judge "missed AC" against.
- The PR title's **type** and **scope** (e.g. `feat`, `web`) and its `<ISSUE>` id when present — the engine builds its example commit subjects from them under `<COMMIT-RULE>`.
- Optionally note `declaredAreas` (from `frontend|backend|database|i18n|security|performance`) when the change touches an area its paths don't reveal.
- `userFacing` — biases **true**; false only for clearly internal-only changes.
- Optionally take a round cap from the user ("one round", "up to 5 rounds") → `--max-rounds` (1–5; omitted = the engine's own stop conditions govern, hard cap 5).

## Resume — run again to continue

There is no stop-hook: **persistence is re-invocation.** One invocation runs to GOAL MET or to a Blocked boundary (only `needs-human` items left), then ends with a report naming where the PR stands and that `/iterate-pr <n>` resumes it. Pending CI and bot rounds are waited on by babysit, never a reason to end.

**Re-entry is stage detection from durable markers, not memory:** `node <ENGINE> status --slice pr-<n>` names the loop's phase. Phase `done` with fixes pushed (branch not ahead of `origin/<headRefName>`) → skip to Step 5's babysit; phase `done` with unpushed commits → Step 4; any other phase → resume the loop at the pending step. Never re-`init` a finished run — one engine run per PR, ever; everything after `done` is babysit.

## Step 3 — Run the loop (engine CLI)

The loop machinery is the plugin's **engine CLI** — a dependency-free Node CLI. **Loop control is deterministic CLI output, never prose discipline:** run each command from the host repo root, read the JSON it prints, and do exactly what its `action` / `next` field says. Never re-derive reviewer selection, finding suppression, classification thresholds, or stop conditions yourself — the CLI owns them, and its run state lives in the host repo's gitignored `.context/pr-<n>/`. **Do not review or fix in the main session** — emitted tasks own that.

Resolve `<ENGINE>` once — it lives in the **plugin install root**, not the host repo:

Resolve `engine` from the loaded skill’s real path using the shared runtime contract. Do not search another runtime’s cache or pick a version by sorting paths.

**Write the run contract.** `mkdir -p .context/pr-<n>` and write `.context/pr-<n>/contract.md` — the text every prompt in the loop (reviewers, validator, fixer, adjudicator) receives: the PR number + title + body (trimmed), the linked ticket's acceptance criteria / test plan verbatim when Step 2 found them (say so when it didn't — reviewers then judge against the diff and conventions alone), and the push ban: **never `git push`** (the skill pushes once, in Step 4). The commit-subject rule is not written here: the engine renders `<COMMIT-RULE>` into every fix and gate-fix prompt.

**Start the loop:**

```bash
node "$engine" init --slice pr-<n> --base origin/<baseRefName> \
  --tests-green <bool> --committed true [--max-rounds <n>] \
  --commits-since <head> [--issue <ISSUE>] --commit-type <type> [--commit-scope <scope>]
```

`--commits-since <head>` scopes the engine's commit-subject checks to the commits this run adds — the PR's existing commits are not rewritten (this skill never force-pushes).

`resumed: true` means a prior run's state exists — run `status` and continue at the phase it names instead of restarting.

**Obey the CLI** (`status` re-prints the pending step any time):

```bash
node "$engine" plan --slice pr-<n> --changed-files <csv> --added-files <csv> --deleted-files <csv> \
  --insertions <n> --user-facing <bool> [--declared-areas <csv>] --head <head>
# → gate-fix (red CI: run ONE fix implementer with the emitted prompt, then apply-fix), or
# → the round's task manifest: prePass (round 1), reviewers[]
node "$engine" collect --slice pr-<n>
# → validator task when findings survived suppression; run it, then
node "$engine" decide --slice pr-<n> --verdicts <verdicts.json>
# action=fix        → run ONE fresh fix implementer with fix.promptFile → apply-fix --result <fix-result.json>
#                     (apply-fix refuses a fix range whose subjects break <COMMIT-RULE>: run the fix pass
#                      again with a fresh fixer — or reword a parent-owned commit — then re-run apply-fix)
#                     → plan again with the fix range's files (git diff --name-only <prevHead>..<newHead>, etc.)
# action=adjudicate → adjudicate → run ONE fresh agent with the emitted prompt (never the fix implementer)
#                     → apply-adjudication --rulings <rulings.json>
# action=incomplete → preserve the pending round; retry missing tasks once, then report a blocker.
# action=converged|stalled|hard-stop → report the terminal loop result:
node "$engine" report --slice pr-<n>
```

**Running an emitted task.** Use the shared runtime contract: every task has
resolved profiles for Claude and Codex, a schema and a persisted `taskFile`.
Claude native subagents remain supported; Codex native subagents may be used
when they expose the required controls. Otherwise run
`node "$engine" run --task <taskFile> --runtime <claude|codex>`.
Each worker returns JSON; the parent validates and saves it. Writers and the
adjudicator get a fresh worker per pass, never a resumed prior worker. If a
writer cannot commit, the parent verifies and commits only its `editedFiles`
as described in the runtime contract. No inline persona fallback: report
unavailable worker capability explicitly.

Ground rules, regardless of mechanism:

- **Gut-check runs first** (round 1). If its JSON contains any `"disposition": "block"` observation — work outside the PR's stated scope — skip the reviewers and run `collect` immediately: it hard-stops for the human before any reviewer spend.
- **Every emitted reviewer must report.** Retry missing/invalid results once, then report `incomplete` and preserve the round for resume. Never advance to PR creation with incomplete coverage.
- **Reviewers are read-only** — only fix agents edit code. Every writer pass is a **freshly spawned agent**: each gate-fix, each round's fix, and the adjudicator (never the fix implementer's context).
- Use the shared model registry: implementer/fixer/adjudicator roles for those passes, reviewer/verifier roles for reports. Apply the resolved model and effort explicitly.
- `--head` on the **first** `plan` only; `apply-fix` records each fix head itself. After each `apply-fix`, recompute the next `plan`'s file flags from the **fix range** (`<prevHead>..<newHead>`).
- Fix commits stay local — every fix prompt carries the push ban; Step 4 pushes once.
- Never hand-edit `.context/pr-<n>/ledger.json` or a findings file — findings enter through reviewer output files, decisions exit through the CLI.

The stop conditions live in the CLI (convergence, two-round stall, per-fingerprint deferral, the round cap — a safety boundary, not a target). A non-converged stop reports `stalled — shipped with N open findings (CR-…)`, never a silently exhausted cap. A `hard-stop` (gut-check block) goes straight to the user — no push.

## Step 4 — Push and report

If the loop landed fix commits (`git rev-list --count origin/<headRefName>..HEAD` > 0):

1. `node "$engine" commit-check --slice pr-<n> --range <head>..HEAD` (`<head>` = the Step 1 head) must print `ok: true` before the push — every subject this run added matches `<COMMIT-RULE>`. On `ok: false`, reword the listed local commits (`git commit --amend -m` for HEAD, else `git reset --soft <head>` and one conforming commit) and re-check. Then `git push` the branch (plain push — commits were appended, no history rewrite) and, in the same moment, refresh the body's `## Verification` block for the new head from the gate runs the fix passes reported (`testEvidence` → rows in `.context/pr-<n>/evidence/verification.jsonl`; mechanics in `../work-slice/references/pr-evidence.md`): replace the text between the `magnus:verification` markers, add the block once if the PR predates it, never a second copy, never a row for a command not run. Leave `## Visual verification` alone: it exists only on a PR already driven to GOAL MET once (captured then, per `../work-slice/references/pr-evidence.md`). If a fix here changed a captured surface, mark those scenes stale — the capture stage after this run's babysit re-renders them; never present an old image as current and never capture mid-loop.
2. **Stack awareness:** if other open PRs base on this branch (`gh pr list --state open --json number,baseRefName` filtered on `headRefName`), tell the user the upstack branches need restacking — the mechanics live in `babysit-stack` ("Branch switching & restacking"); don't restack other worktrees' branches unasked.
3. If the loop **stalled** (or dead reviewers blocked convergence), surface the leftovers in the PR **body**, never as a comment (`../work-slice/references/pr-evidence.md`): fold a `## Notes` block into the same body write that refreshes `## Verification` at push time — at most five one-line bullets naming the findings that shipped unfixed. The full ledger (`CR-NNN` entries, dispute evidence, adjudication rulings) stays in `.context/` and the terminal report; a human who wants it asks.

Then print, from `report`'s output plus the findings/fix files:

- The **verdict verbatim**: `converged` in N rounds, or `stalled — shipped with N open findings (CR-…)` — plus why it stopped (no material progress vs the cap).
- Reviewers per round; dead reviewers; findings the relevance gate demoted (`advisoryNotes`) or dropped (`unverified`).
- What the fix passes changed (diff stat) and the pushed head.
- Judgement-call notes and disputed findings with their adjudication rulings (a deadlock is the human's to settle on the PR).
- Consolidation candidates from `.context/pr-<n>/round-*/findings/*.json` (offer to file them on `<TRACKER>` with the chore type label + the triage opt-out label from `labels`, per `tracker.docPath` — file only if the user says yes; this skill has no slice machinery that auto-files them).

If round 1 was already clean, say so and push nothing.

## Step 5 — Babysit the PR to "in order"

The review loop only proves **our** reviewers are satisfied. "Everything in order" additionally means CI green, the GitHub review bots satisfied, and every review thread resolved — that machinery already exists, so delegate: run **`/babysit-stack <PR number>`** (it accepts explicit PR numbers; pass the whole stack's numbers when this PR has stacked siblings that need restacking after the push). It is a babysitting mode: CI green first, then `<BOT>` rounds (request → wait → fix → re-request) until satisfied, then `<COMMENT-BOT>` rounds (comment-summoned) until satisfied, threads resolved — each round waited for with bounded polls, each fix a fresh agent. It returns only with a terminal verdict:

- **GOAL MET** → compare existing media manifests with the live heads of every
  PR babysit changed or restacked. For stale media, check out each owning branch,
  run the shared capture stage after that PR's current-head verdict, republish,
  and replace its existing visual section and linked QA handoff. Reuse matching
  media. No captures happen inside the review/fix loop. Then report and stop.
- **NOT MET** → nothing actionable is left: `needs-human` threads (including this skill's own stalled-verdict ledger posted in Step 4), a stuck bot, or a capped fix signature. Report them verbatim as the stop reason and end; the human unblocks, then re-invokes — babysit resumes from its state file. Never re-run babysit back-to-back on the same NOT MET state.

A PR that already had bot rounds before this skill ran is fine — babysit's per-bot round counter lives in its state file and its 5-rounds-per-bot cap still applies; never work around it.

## Boundaries

- **Never merge, approve, mark ready, or close** — a draft stays a draft; state changes are the human's.
- The review loop never touches existing review threads (reply/resolve) — thread work happens only inside Step 5's `/babysit-stack`, under that skill's rules and caps. Bot reviews happen on GitHub only; never run a review CLI.
- **The CLI owns the loop.** Reviewer selection, suppression, the relevance gate's thresholds, gate injection, stall/cap stops, dispute adjudication flow, and the verdict all come from `<ENGINE>`'s JSON output — never re-derive them in prose, never hand-edit `.context/pr-<n>/ledger.json` or a findings file, and never skip a command because you "know" what it will say.
- **One engine run per PR — including across re-invocations.** A finished run (`status` phase `done`) is never re-`init`ed into more rounds; a stalled verdict's leftovers go into the PR body's `## Notes`, never a comment. Persistence after the loop is babysit, not more review rounds.
- **Every emitted task must complete with its resolved model and valid JSON.** Native workers and the shared CLI adapter use the same contract; incomplete coverage blocks advancement.
- **Persistence is re-invocation, never a stop-hook.** A run ends at GOAL MET or Blocked (`needs-human` only), with the resume report; pending CI / bot rounds are waited on by babysit, never a reason to end.
- Fixes stay inside the PR's existing scope; consolidations become proposals, not code. TDD discipline is carried in the fix prompts (red-green where behaviour changes).
- Use the shared model registry: implementer/fixer/adjudicator roles for those passes, reviewer/verifier roles for reports. Apply the resolved model and effort explicitly.
- The roster in `agents/` is the lane source; the host's `reviewers.*` config is an additive focus overlay the CLI applies. Tune `docs/agents/repo-config.md`, never fork lanes inline.
- No Playwright loop — that needs acceptance criteria + a runnable slice and belongs to `/work-slice` / `/work-issue`.
- Never check out a branch held by another worktree; never force-push.
- Works on other people's PRs too — but say so in the report and don't push to a fork you don't have rights on (stop and tell the user instead).

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow

## Workflow Boundaries

**This skill runs the bounded review ⇄ fix loop on one existing PR, then babysits that PR to "in order".**

- **DOES**: resolve + check out the PR branch, compute the diff vs `origin/<baseRefName>`, drive the engine CLI (`init → plan → collect → decide → apply-fix → adjudicate → report`), push fixes once, fold a stalled run's leftovers into the PR body's `## Notes`, run `/babysit-stack <n>` to its terminal verdict.
- **DOES NOT**: touch review threads (Step 5's babysit owns reply/resolve), run Playwright inside the review loop, open/merge/approve/ready/close PRs, re-`init` a finished engine run, restack other worktrees' branches unasked.

## Red Flags — STOP

- About to review or fix in the main session — stop: emitted tasks own that; you only run the CLI and the tasks it names.
- About to re-`init` a run whose `status` phase is `done` — stop: one engine run per PR, ever; everything after is babysit.
- About to reply to or resolve a review thread from this loop, or run a review CLI — stop: thread and bot work happens only inside Step 5's `/babysit-stack`, on GitHub.
- About to push mid-loop — stop: every fix prompt carries the push ban; fix commits stay local and Step 4 pushes once, plain (never force).
- About to check out a branch held by another worktree — stop and name the worktree.
- About to hand-edit `.context/pr-<n>/ledger.json` / a findings file, or skip a CLI command you "know" the output of — stop: the CLI owns the loop.
- About to push to a fork you lack rights on — stop and tell the user.
- About to end because CI or a bot review is pending, or to re-run babysit on an unchanged NOT MET state — stop: babysit waits; NOT MET is Blocked — report and end.

## Verification

Before reporting done:

- [ ] The verdict is reported verbatim: `converged` in N rounds or `stalled — shipped with N open findings (CR-…)` — plus dead reviewers and demoted/unverified findings.
- [ ] Fix commits (if any) are pushed exactly once and the branch is no longer ahead of `origin/<headRefName>`.
- [ ] A stalled or degraded-coverage run left its leftovers as ≤5 `## Notes` bullets in the PR **body** (no suite PR comment anywhere), with the full ledger in `.context/` and the terminal report.
- [ ] Upstack PRs basing on this branch are named as needing restack (mechanics deferred to babysit-stack, not done unasked).
- [ ] `/babysit-stack` ran to a terminal verdict — GOAL MET, or NOT MET with only `needs-human` items, named in the report.
- [ ] The PR is still open and still a draft if it was one — nothing merged, approved, readied, or closed.
