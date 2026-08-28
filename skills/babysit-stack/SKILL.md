---
name: babysit-stack
description: >
  Drive a PR stack to "done": ensure the repo's review bot is requested on every
  stack PR, watch CI, fix failures, address + resolve every review thread, and
  report a machine-checkable verdict (GOAL MET / NOT MET). One idempotent pass
  per invocation — the loop comes from outside (a calling skill's next pass,
  /loop, a scheduler, or re-running it by hand). Use when I say "babysit the stack", "watch
  the PRs", "resolve the review comments", "get the stack green", "add copilot
  and watch", or as the finish stage of /feature-goal.
argument-hint: "[parent issue id | PR numbers…]"
---

# Babysit Stack

Take an open stack of draft PRs and drive it to the terminal state: **every PR
CI-green, the review bot requested, every review thread resolved (or replied-to
and explicitly flagged for the human)**. This is the finish stage of the
feature pipeline — after `/to-issues` split the PRD and each slice reached its
draft PR.

**One pass per invocation.** Each run inspects the live state, does every
currently-possible action once, and ends with a verdict block. It never spins
waiting for CI or the review bot beyond a bounded watch — external loops (a
calling skill's next pass, `/loop`, a scheduler, or the user) re-invoke it.
Every action is idempotent, so re-running is always safe.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block) at entry; the
placeholders below stand for its values. Missing file or empty key → use the
fallback and say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<BOT>` | `pr.botReviewer` | **skip Step 1 entirely** — no bot to request or wait on |
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>`, nothing to restack |

Also read `tracker.docPath` when it exists. Stack mechanics (rebase/push after
fixing a lower branch) follow the `<STACK>` skill — invoke it before running any
stack command.

## Step 0 — Discover the stack

Input is a parent PRD ticket id (preferred) or explicit PR numbers.

- **Parent issue id** → list its sub-issues (stack order = the `/to-issues`
  numbering, follow `blockedBy`), then find each slice's PR — search **all**
  states so a merged slice reads as done, not missing:
  `gh pr list --state all --search "<ISSUE>" --json number,headRefName,baseRefName,isDraft,state,url`.
- **PR numbers** → fetch each the same way.
- Classify per slice: **merged** PR → the slice is done — report it `merged`,
  skip bot-review/CI/thread work for it, and it never blocks the verdict. **Closed
  (unmerged)** PR and no open one → treat as `missing` (the slice needs
  re-work). Only **open** PRs get the Step 1–3 treatment.
- Order/verify the chain from the PRs themselves — each PR's `baseRefName` is
  the branch below it, so the bottom PR is the one based on `<BASE>`.
  `gh stack view --json` only works when this worktree has **local** tracking;
  a stack created with `gh stack link` has none, and errors with
  `not part of a stack`. That is not a problem — treat it as "no local
  tracking" and fall back to the base chain.

Order the PRs **bottom → top** (base chain). Slices with **no PR at all** (or
only a closed, unmerged one) are reported as `missing` — that alone makes the
verdict NOT MET (the slice loop isn't finished); don't implement them here,
that's `/feature-goal` / `/work-slice`'s job.

Keep cross-pass state in `.context/babysit-<parent>.json` (per-check attempt
counters + failure signatures + first-seen-pending timestamps, per-thread
attempt counters, `botRequested` flags — see caps below). Missing file = first
pass. Before writing it, make sure `.context/` is listed in `.git/info/exclude`
(append the line if not) — the file must never show up untracked, so no blanket
staging by any other agent sharing the worktree can sweep it into a commit.

## Step 1 — Bot review requested (once per PR)

**Skip this step entirely when `pr.botReviewer` is empty** — record `n/a` in the
verdict table and move on.

For each PR, check whether `<BOT>` already reviewed or is requested:

```bash
gh pr view <n> --json reviewRequests --jq '.reviewRequests[].login'
gh api repos/{owner}/{repo}/pulls/<n>/reviews --jq '.[].user.login'
```

If `<BOT>`'s login appears in neither, request it. For `Copilot` that login is
`copilot-pull-request-reviewer[bot]`:

```bash
gh api -X POST repos/{owner}/{repo}/pulls/<n>/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

Verify by re-fetching `reviewRequests`. If the API rejects it (bot code review
not enabled for the repo/org), record it once in the state file and report it as
a blocker — don't retry every pass.

**Exactly one bot round per PR — never re-request.** Once `<BOT>` has been
requested on a PR, it is done: do not request it again after pushing fixes, and
do not request it on a re-run. The stack already went through up to 5 rounds of
our own reviewers per slice inside the work-slice workflow; the bot is a single
outside pass over that, not an iterative loop. Re-requesting would re-open
threads the pass just resolved and the goal would never converge. Record
`botRequested: true` per PR in the state file on the first request and gate
every later pass on it.

## Step 2 — CI per PR (bottom → top)

Read check state as JSON and classify by the `bucket` field — never eyeball the
human-readable table:

```bash
gh pr checks <n> --json name,state,bucket,link,workflow
```

`bucket` is one of `pass` / `fail` / `pending` / `skipping` / `cancel`:

- **All `pass`/`skipping`** → done for this PR.
- **`cancel`** → never turns green on its own (superseded push, runner kill).
  Re-run once (`gh run rerun <run-id>`); still cancelled or now failing → treat
  as `fail` below.
- **`pending`** → not a failure. If *everything else* in the pass is already
  done and CI is the only thing outstanding, do one bounded wait on the
  bottom-most pending PR — `timeout 1800 gh pr checks <n> --watch --interval 30
  --fail-fast` (`--watch` alone has no time bound; `--interval 30` keeps API
  churn down; timeout expiry = still `pending`, not a failure) — then re-read.
  Otherwise just record `pending` and move on; the next pass picks it up. Never
  busy-loop.
  **Stuck-check rule:** the state file records when a check was first seen
  `pending`; one still `pending` >30 min later with no run in progress
  (`gh run list --branch <headRefName>` shows nothing running for it) is likely
  stuck — runner outage, lost webhook, an external service that never reported
  back. Name it, flag it `needs-human`, stop waiting on it.
- **`fail`** → diagnose from the logs, never from the check name alone:
  ```bash
  gh run list --branch <headRefName> --limit 5 --json databaseId,name,status,conclusion
  gh run view <run-id> --log-failed
  ```
  Read the actual failing step's output (a repo CI-monitor skill, where one
  exists, may also surface self-healing fixes). **Flaky-retry rule:** a
  suspected-flaky check gets one retry (`gh run rerun <run-id> --failed`); a
  second identical failure is real until the logs name a concrete
  infrastructure cause. "Unrelated to this PR" needs log evidence (blame the
  failing assertion, check `<BASE>`'s CI history), not assumption. Then fix it
  **on that PR's branch** test-first, commit, push (see branch-switching rules
  below). Known trap: CI can go green on a stale remote build cache — trust
  the logs, not vibes.

**Gate discipline:** a failing gate signals a real problem until proven
otherwise — fix the gate, never silence it. `--no-verify`, `eslint-disable` /
`# noqa` / `@ts-ignore`, skipping or deleting the failing test, and lowering a
threshold (coverage, complexity, bundle size) are not fixes. When disablement
looks genuinely warranted (confirmed false positive, test asserting behavior
the PR intentionally changes), that is a `needs-human` decision — reply with
the rationale and leave it; never commit the disablement yourself.

**Fix caps / same-failure escalation:** the state file tracks per-check attempt
counts **and the failure signature** (failing step + first real error line).
The same signature still failing after **3 fix attempts across passes** → you
are guessing, not reading — stop, flag it `needs-human` in the verdict with the
log line, and leave it. A different signature on the same check is a new
failure (fresh cap), but note the churn. Never grind past the cap.

## Step 3 — Review threads per PR

**Bot-wait rule first:** post-hoc review-commenting bots are services that post
PR comments only *after* their check completes — error trackers, coverage
reporters, AI review bots, hosted linter/code-analysis services (e.g. Sentry,
Codecov, Cursor Bugbot, Seer). Key on the category — does this check belong to
a service that comments after completion? — not on any specific bot name. If
such a check is still `pending` on a PR (per the Step 2 JSON), skip this step
for that PR this pass and record `bot-wait` in its verdict Notes: resolving
threads before those comments land means duplicate work next pass. (The
stuck-check rule still applies — a bot check stuck >30 min stops gating thread
work and goes `needs-human`.) Same reason `<BOT>` requested-but-not-delivered
keeps the verdict NOT MET in Step 1.

Fetch unresolved threads:

`gh api`'s `{owner}`/`{repo}` placeholders only expand in **REST paths** — in
GraphQL they must be passed as variables, and `-F name=':owner'` is the form
that resolves them (`-f owner='{owner}'` sends the literal braces and fails with
`Could not resolve to a Repository with the name '{owner}/{repo}'`):

```bash
gh api graphql -F owner=':owner' -F repo=':repo' -F pr=<n> -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
    reviewThreads(first:100){ nodes{
      id isResolved isOutdated path line
      comments(first:20){ nodes{ databaseId author{login} body } }
    }}}}}' --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved|not))'
```

For each unresolved thread, classify and act — same discipline as the
work-slice review loop (fix or dispute with evidence, never silently drop):

1. **Valid, actionable** (the default; when torn, fix) → fix it test-first on
   the PR's branch, commit, then reply citing the commit
   (`gh api -X POST repos/{owner}/{repo}/pulls/<n>/comments/<databaseId>/replies -f body='Fixed in <sha>: <one line>'`)
   and resolve the thread:
   ```bash
   gh api graphql -f id='<threadId>' -f query='
   mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
   ```
2. **Factually wrong / not applicable** → reply with concrete evidence
   (file:line, test output, spec text), then resolve. Only with real evidence —
   a hand-wave reply is not a resolution.
3. **Outdated** (`isOutdated` and the code it pointed at is gone/rewritten) →
   reply one line noting why it no longer applies, resolve.
4. **Genuine judgement call / scope decision the human owns** → reply with the
   analysis and the options, **leave it unresolved**, flag it `needs-human` in
   the verdict. These intentionally hold the goal open until the human weighs
   in.

**Thread caps:** a thread that bounces (reviewer re-opens or re-objects after a
fix) gets **2 fix attempts**, then it's `needs-human`. Track in the state file.

## Branch switching & restacking

Fix commits must land on the *owning* PR's branch:

- Check `git worktree list` first — never check out a branch held by another
  worktree; if one is, flag that PR's fixes `needs-human` (or do them in that
  worktree only if the user said so).
- In this worktree: commit/stash nothing-lost, `git checkout <branch>` (or
  `gh stack checkout <branch>`), then snapshot `git status --porcelain` as the
  **pre-existing dirty state** — anything already modified or untracked there
  was not produced by this fix and must never ride into a fix commit.
- Fix, then stage **only the files the fix actually edited, by name** — never
  `git add -A` or `git add .`, which would sweep pre-existing uncommitted work
  (including untracked `.env`-style files) into a pushed commit:
  ```bash
  git add <file1> <file2> ...
  git commit -m "<ISSUE> <what>"
  ```
  After committing, compare `git status --porcelain` against the snapshot:
  pre-existing entries stay uncommitted; if any exist, say so once in the pass
  report.
- After committing to a **lower** branch, restack everything above it before
  pushing. The stack may be **link-only** (created with `gh stack link`, no local
  tracking) — `gh stack view --json` tells you which: if it succeeds, use
  `gh stack rebase --upstack` then `gh stack push --remote origin`; if it errors
  with "not part of a stack", either materialise tracking with
  `gh stack checkout <stack-number>` first, or rebase each higher branch by hand
  (`git rebase --onto <fixed-branch> <old-tip> <higher-branch>` +
  `git push --force-with-lease`), bottom → top. A conflict during restack →
  resolve if mechanical, else abort (`gh stack rebase --abort` / `git rebase
  --abort`) and flag `needs-human`.
- Return to the top branch at the end of the pass.

## Verdict (every pass ends with this)

```md
# Babysit pass — <parent issue id>
| PR | Slice | <BOT> | CI | Unresolved threads | Notes |
| --- | --- | --- | --- | --- | --- |
| #123 | <slice-1 id> | reviewed | green | 0 | — |
| #124 | <slice-2 id> | requested | pending | 2 (1 fixed this pass, 1 needs-human) | … |

Actions this pass: <commits pushed, threads resolved, reviews requested>
Blockers (needs-human): <list, or none>

VERDICT: GOAL MET | NOT MET — <the one-line reason: pending CI / n unresolved threads / missing PRs / needs-human items>
```

**GOAL MET** requires ALL of, for every non-merged slice: an open PR, CI green,
`<BOT>` requested **and its review delivered** (requested-but-not-yet-returned
is `pending`, not done; `n/a` when no bot is configured), and **zero unresolved threads — no exceptions**.
Unresolved `needs-human` threads therefore always mean NOT MET, with
`needs-human` named as the reason so the human knows the loop is waiting on
them (they are reported honestly, never resolved by this skill). Merged slices
count as done and impose no requirements. The calling skill's next pass (or
the user) reads this verdict verbatim.

## Boundaries

- **Never merge, approve, or mark a PR ready.** Drafts stay drafts; promoting
  and merging are the human's calls. (Merging later = `gh stack merge --yes`,
  but not this skill's job.)
- One pass per invocation — no unbounded waiting; the only in-pass wait is the
  single bounded `--watch` when CI is the sole remaining item.
- Fixes are test-first and minimal — address the finding, no scope creep. Same
  dispute rule as the review loop: disagree only with evidence.
- Respect the caps (3 fix attempts per CI failure signature, 2 per bouncing
  thread, **1 bot review request per PR, ever**), then `needs-human` — never
  grind.
- Never silence a gate to go green — no `--no-verify`, suppression comments,
  skipped/deleted tests, or lowered thresholds; warranted disablement is a
  `needs-human` decision.
- Stage fix commits by explicit file name only — `git add -A`/`git add .` are
  banned in this skill.
- Never resolve a thread you didn't address (fix, evidence, or outdated-note).
  Never resolve a `needs-human` thread — that's the human's click.
- Never touch branches held by other worktrees.
- Report faithfully: pending is pending, failed is failed (with the log line),
  a skipped item says why.
