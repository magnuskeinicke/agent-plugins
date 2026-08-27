---
name: iterate-pr
description: Run bounded review ⇄ fix rounds on an EXISTING pull request — fan out the shared reviewer lanes on the PR diff, fix every blocking finding test-first, commit and push back to the PR branch. Standalone: no PRD, no slice tickets, no stack bookkeeping. Use when the user says "iterate on PR <n>", "run review rounds on this PR", "polish PR <n>", "review and fix this PR", or wants the work-slice review-fix loop applied to a PR outside the big pipeline.
argument-hint: "[PR number | issue id | nothing = current branch's PR]"
---

# Iterate PR

Take an **existing PR** and run the same bounded **review ⇄ fix loop** the feature-dev workflows use — baseline + diff-matched web/server lanes + reuse + scope-fidelity reviewers + the review-CLI wrapper in round 1 only (Sonnet), findings gated by a relevance validator and tracked in a finding ledger, fixes test-first (Opus) — without any of the pipeline around it. No PRD, no slice claim, no Playwright. The loop converges (or hits its cap), the fixes are pushed to the PR branch, and — under `/goal` — a `/babysit-stack` finish stage drives the PR the rest of the way to "in order" (CI green, threads resolved).

Division of labour with the siblings:

- **`/review-code`** — one read-only round, report only. Use it when nothing should be changed.
- **`/iterate-pr`** (this) — review ⇄ fix rounds with **our** reviewers on a PR, then (under `/goal`) babysit that PR to done.
- **`/babysit-stack`** — CI, the review bot, and **existing review threads**. This skill's own loop never touches threads — it delegates all of that to babysit passes in Step 5.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). Pass it to the
workflow verbatim as `repoConfig`; the placeholders below stand for its values
in the prose. Missing file or empty key → the workflow's generic defaults apply
and you say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BOT>` | `pr.botReviewer` | no bot review round to request or wait on |
| `<CLI-REVIEWER>` | `pr.cliReviewer` | that reviewer lane is skipped |
| `<STACK>` | `pr.stackTool` | plain branches; nothing to restack |

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
diffStat:     git diff --shortstat origin/<base>...HEAD   # gates the scope-fidelity lane
```

If the diff is empty, stop — nothing to iterate.

Also capture, for the workflow args:

- `head`: `git rev-parse HEAD` — seeds the focused re-review delta.
- `testsGreen`: from `gh pr checks <n>` — `true` only when the head's checks
  are green; failing or still-pending checks → `false`, which spends round 1
  on a fix pass instead of reviewers (an existing commit is no evidence its
  tests pass).

## Step 2 — Gather context

- PR title + body (trim the stack tool's navigation section, if any).
- If the title carries an `<ISSUE>` id → fetch that issue from `<TRACKER>` and include its **acceptance criteria** (and `## Test plan` if present) — that's what reviewers judge "missed AC" against. Set `hasAcceptanceCriteria: true` only when real AC actually made it into the context (title/body alone doesn't count — it gates the scope-fidelity lane, which must judge necessity against a frozen AC, never the diff).
- `commitPrefix` = the issue id when present, else `PR-<n>`.
- Optionally set `declaredAreas` (from `frontend|backend|database|i18n|security|performance`) when the change touches an area its paths don't reveal.
- Optionally take a round cap from the user ("one round", "up to 5 rounds") → `maxRounds` (default 3, hard max 5).

## Setting the goal — before the loop starts

Same pattern as `/feature-goal`: `/goal` is the built-in stop-blocker the **user types** (a skill cannot set it). This skill has no approval gates, so the goal can cover the whole run. If no goal is active, print the template and ask the user to set it before Step 3 (carry on identically if they decline or are away — the skill just won't auto-resume):

```
/goal PR <n> in order: review loop converged or stalled ledger posted, fixes
pushed, CI green, all review threads resolved — /babysit-stack verdict on
PR <n> reads GOAL MET (needs-human blockers count as not met)
```

**Re-entry (every /goal iteration) is stage detection, not memory:** the review workflow already ran and finished with its fixes pushed (branch not ahead of `origin/<headRefName>`, summary in the transcript or a `## Review ledger` comment posted) → skip to Step 5's babysit pass. Otherwise resume at the step whose artifact is missing. Never re-run the review workflow after it converged or stalled — one workflow invocation per /iterate-pr run; everything after is babysit passes.

## Step 3 — Run the loop (Workflow)

This step runs as a **single `Workflow` call** — invoking it here is the sanctioned opt-in. **Do not review or fix in the main session** — the workflow owns the loop.

`scriptPath` must be an **absolute** path into this plugin's install root — the
script ships with the plugin, not with the host repo, so a repo-relative path
resolves to nothing. Resolve it first: use `$CLAUDE_PLUGIN_ROOT/skills/iterate-pr/iterate-pr.workflow.js`
when that variable is set, otherwise
`ls -d "$HOME"/.claude/plugins/cache/*/magnus/*/skills/iterate-pr/iterate-pr.workflow.js | sort -V | tail -1`.
Below, `<PLUGIN_ROOT>` stands for the resolved root — substitute the real path.

```
Workflow({
  scriptPath: "<PLUGIN_ROOT>/skills/iterate-pr/iterate-pr.workflow.js",
  args: {
    prNumber,       // e.g. 2580
    baseBranch,     // "origin/<baseRefName>" from Step 1
    head,           // PR head sha (Step 1) — seeds the focused re-review delta
    testsGreen,     // from `gh pr checks` (Step 1) — false = round 1 is a fix pass
    context,        // PR title/body + linked-ticket AC/test plan (Step 2)
    changedFiles,   // Step 1 — with addedFiles, gates the reuse reviewer
    addedFiles,     // Step 1
    diffStat,       // Step 1 — gates the scope-fidelity lane on round 1
    hasAcceptanceCriteria, // Step 2 — true only when context carries the ticket's AC; gates the scope-fidelity lane
    declaredAreas,  // optional area hints
    maxRounds,      // optional, default 3 (hard max 5)
    commitPrefix,   // the issue id or "PR-<n>" — commit-message prefix
    repoConfig      // the JSON block from docs/agents/repo-config.md, if present
  }
})
```

The workflow: a **gut-check pre-pass** opens the first reviewer round (once per run, before the lanes — the `gut-check` skill's rubric-free first read; `route`d observations enter the ledger like any reviewer finding, a `block` — work outside the PR's stated scope — hard-stops for the human) → reviewers in parallel per round (baseline always; at most 2 lanes; reuse when the diff adds or modifies files; scope-fidelity when `hasAcceptanceCriteria` is set AND the diff adds new files or >~150 inserted lines; the `<CLI-REVIEWER>` wrapper joins the first reviewer round only — once per run, never on fix rounds; skipped entirely when `pr.cliReviewer` is empty) → findings enter a **ledger** (stable `CR-NNN` ids, fingerprint = lane + file + root cause, statuses `open|addressed|deferred|disputed|dropped`; disputed/deferred re-raises auto-suppressed) → a **relevance validator** classifies each finding before any fix (≥80 confidence + diff-caused = fixable; 60–79 or pre-existing = advisory note/consolidation, never fixed here; <60 = dropped as UNVERIFIED) → zero open blocking findings with every lane reporting = **converged**; otherwise one Opus fix pass (test-first, commit, never push; `addressed` records the fix commit hash) → re-review focused on the fix delta. The loop stops on the first of: converged / two consecutive rounds without material progress (debt score drop ≥1, a blocking finding dying, or a gate clearing) / per-finding deferral after 2 failed fix attempts / the hard cap — a safety boundary, not a target. Disputed findings get a **closeout adjudication** by an independent Opus agent on evidence only (upheld = reopened into the stalled verdict, deadlock = reported for the human). Same tests/commit gates and dead-reviewer rule as work-slice. Verify `args` reached the script (a returned "(unknown PR)" means they didn't — bake literals and re-run).

## Codex fallback — no `Workflow` tool

Codex has no `Workflow` tool. Run the loop by hand with the same contract: the
gut-check pre-pass, then the selected reviewers one at a time, then the
relevance validator, then one fix pass over the eligible findings — repeating
until a stop condition fires (converged / two rounds without material progress /
a fingerprint deferred after 2 fix attempts / the round cap). Keep the ledger
yourself as a scratch table of `CR-NNN` id, fingerprint, status. Every rule in
Step 3 holds; only the parallelism is lost.

## Step 4 — Push and report

If the workflow landed fix commits (`fixCommitsLanded`):

1. `git push` the branch (plain push — commits were appended, no history rewrite).
2. **Stack awareness:** if other open PRs base on this branch (`gh pr list --state open --json number,baseRefName` filtered on `headRefName`), tell the user the upstack branches need restacking — the mechanics live in `babysit-stack` ("Branch switching & restacking"); don't restack other worktrees' branches unasked.
3. If the loop **stalled** (or died reviewers blocked convergence), post the leftovers on the PR: `gh pr comment <n> --body` with the verdict line verbatim (`stalled — shipped with N open findings (CR-…)`), a `## Review ledger` section from the returned `ledgerText` (open/deferred/disputed entries with their `CR-NNN` ids, dispute evidence, and adjudication rulings), plus any `[advisory:…]` / `[disputed:…]` notes.

Then print, from the returned summary:

- The **verdict verbatim**: `converged` in N rounds, or `stalled — shipped with N open findings (CR-…)` — plus why it stopped (no material progress vs hard cap).
- Reviewers per round; flag dead reviewers; findings the relevance gate demoted (advisory) or dropped (unverified).
- What the fix passes changed (diff stat) and the pushed head.
- Judgement-call notes + disputed findings with their adjudication rulings (a deadlock is the human's to settle on the PR).
- Consolidation candidates (offer to file them on `<TRACKER>` with the chore type label + the triage opt-out label from `labels`, per `tracker.docPath` — file only if the user says yes; this skill has no slice machinery that auto-files them).

If round 1 was already clean, say so and push nothing.

## Step 5 — Drive the PR to "in order" (babysit passes)

The review loop only proves **our** reviewers are satisfied. "Everything in order" additionally means CI green and every review thread resolved — that machinery already exists, so delegate: run **`/babysit-stack <PR number>`** (it accepts explicit PR numbers; pass the whole stack's numbers when this PR has stacked siblings that need restacking after the push). Each pass ends with a `VERDICT: GOAL MET | NOT MET` block — handle it exactly like `/feature-goal`'s BABYSIT stage:

- **NOT MET, actionable items remain** → under /goal the session keeps going: run another pass (respecting babysit's per-item caps).
- **NOT MET, only pending CI / an awaited `<BOT>` review** → say so and attempt to stop; the /goal hook bounces it and the next iteration re-checks — babysit's bounded `--watch` paces this instead of hot-looping.
- **NOT MET, only `needs-human` blockers** (including this skill's own stalled-verdict ledger posted in Step 4) → report them clearly and attempt to stop with that as the reason; the human unblocks or `/goal clear`s.
- **GOAL MET** → done. Report the final state and stop.

**Bot-review judgement call:** babysit-stack requests `<BOT>` once per PR. On a PR that already had its bot round (check `gh api repos/{owner}/{repo}/pulls/<n>/reviews` for the bot's login — `copilot-pull-request-reviewer[bot]` for Copilot), babysit's own once-per-PR gate already prevents a re-request — never work around it.

No goal set → Step 5 is still worth **one** pass (so the report ends on live CI/thread state), but don't loop it by hand — tell the user to set the goal or re-invoke.

## Boundaries

- **Never merge, approve, mark ready, or close** — a draft stays a draft; state changes are the human's.
- The review loop never touches existing review threads (reply/resolve) — thread work happens only inside the Step 5 `/babysit-stack` passes, under that skill's rules and caps.
- One `Workflow` invocation per run — including across /goal re-entries. The loop terminates on its stop conditions (converged / two rounds without material progress / per-finding deferral / the hard cap, default 3, max 5 — a safety boundary, not a target); a stalled verdict's ledger goes onto the PR as a comment, never into more rounds. Persistence after the loop is babysit passes, not more review rounds.
- `/goal` is user-typed, never self-set; the skill works identically without it. A `needs-human` blocker is reported as the stop reason, not worked around.
- Fixes stay inside the PR's existing scope; consolidations become proposals, not code.
- Model roles fixed, aliases only: reviewers + the relevance validator **Sonnet**, fixers + the closeout adjudicator **Opus** — never pin exact ids or effort.
- Reviewer definitions come from the host repo's `repoConfig.reviewers` (docs/agents/repo-config.md), merged over the plugin's generic lanes at runtime — tune there, never fork inline.
- No Playwright loop — that needs acceptance criteria + a runnable slice and belongs to `/work-slice` / `/work-issue`.
- Never check out a branch held by another worktree; never force-push.
- Works on other people's PRs too — but say so in the report and don't push to a fork you don't have rights on (stop and tell the user instead).

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
