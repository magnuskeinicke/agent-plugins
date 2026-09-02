---
name: babysit-stack
description: >
  Babysit a PR (or a PR stack) to "done" in one sitting: get CI green, then run
  the repo's review bots on GitHub in order — request the review bot (Copilot)
  and fix until it is satisfied, then summon the comment-triggered bot
  (CodeRabbit, `@coderabbitai review`) and fix until it is satisfied — resolve
  every review thread, restack after fixes, and report a machine-checkable
  verdict (GOAL MET / NOT MET). Waits for each bot round itself with bounded
  polls; ends only at GOAL MET or when everything left needs a human. Use when I
  say "babysit the stack", "babysit this PR", "watch the PRs", "resolve the
  review comments", "get the stack green", "run copilot then coderabbit", or as
  the finish stage of /feature-goal, /work-slice and /work-issue.
argument-hint: "[parent issue id | PR numbers…]"
---

# Babysit Stack

Take open draft PRs and drive them to the terminal state: **every PR CI-green,
every configured review bot satisfied, every review thread resolved (or
replied-to and explicitly flagged for the human)**. This is the finish stage
of every PR-producing skill in the suite.

**Babysitting mode: one invocation runs until terminal or blocked.** It loops
over the PRs bottom → top, waits for each external event (a CI run, a bot's
review) with a *bounded* poll, acts on what arrived, and goes again. It ends
only when the verdict is GOAL MET, or when nothing actionable remains — every
open item is `needs-human`, capped out, or stuck. Every action is idempotent
and cross-round state lives on disk, so re-running after any interruption is
always safe and resumes where it stopped.

Bot reviews happen **on GitHub only** — reviews are requested/summoned on the
PR and read back from the PR. No review CLI is run anywhere in the suite.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block) at entry; the
placeholders below stand for its values. Missing file or empty key → use the
fallback and say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<BOT>` | `pr.botReviewer` — the review-request bot (Copilot) | **skip Phase B** — record `n/a` |
| `<COMMENT-BOT>` | `pr.commentReviewer` — `{login, command}` of the comment-summoned bot (CodeRabbit: `coderabbitai[bot]`, `@coderabbitai review`) | **skip Phase C** — record `n/a` |
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>`, nothing to restack |
| `<GATE>` | `gates.all` | the fixer discovers the repo's lint/test/build commands and names which it used |

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
- Classify per slice: **merged** PR → done — report it `merged`, skip all
  phases for it, it never blocks the verdict. **Closed (unmerged)** PR and no
  open one → `missing` (the slice needs re-work). Only **open** PRs get the
  phase ladder.
- Order/verify the chain from the PRs themselves — each PR's `baseRefName` is
  the branch below it; the bottom PR is the one based on `<BASE>`.
  `gh stack view --json` only works with **local** tracking; a stack created
  with `gh stack link` has none and errors with `not part of a stack` — treat
  that as "no local tracking" and use the base chain.

Slices with **no PR at all** (or only a closed, unmerged one) are reported as
`missing` — that alone makes the verdict NOT MET; don't implement them here,
that's `/feature-goal` / `/work-slice`'s job.

**State file:** `.context/babysit-<parent>.json` — per PR: CI attempt counters
+ failure signatures + first-seen-pending timestamps; per bot: `rounds`,
`lastTriggerAt`, `satisfied`, `stuck`; per thread: attempt counters; plus
**one record per fix attempt** (`outcome`, `summary`, `whyItFailed`) — the next
attempt's fixer is a fresh agent and only knows what was tried because this
file says so. Missing file = first run. Before writing it, make sure
`.context/` is listed in `.git/info/exclude` (append the line if not) so no
blanket staging by another agent sweeps it into a commit.

## The phase ladder — per PR, bottom → top

Finish a PR completely before moving to the one above it: a fix pushed to a
lower branch restacks everything above, so working top-down wastes rounds.

```
Phase A  CI green            (fix loop, signature caps)
Phase B  <BOT> satisfied     (review-request rounds until satisfied)
Phase C  <COMMENT-BOT> satisfied  (comment-summoned rounds until satisfied)
Phase D  zero unresolved threads  (human / other-bot threads)
```

A later phase never starts while an earlier one is red: bots review green
code only, and every fix push inside Phase B/C sends the PR back through
Phase A (bounded CI watch) before the next bot round is triggered.

### Waiting — bounded, never busy

Every wait is **one bounded command**, polling every 60 s, at most 20 minutes:

```bash
timeout 1200 bash -c 'until <condition>; do sleep 60; done'   # exit 124 = still waiting
```

(Runtime blocks foreground `sleep`? Use its monitor/wait tool with the same
bound.) A wait that expires is not a failure — re-check state; if nothing at
all changed (no run started, no review posted), wait **once more**. Two empty
waits in a row (≈40 min) on the same event = **stuck** → flag `needs-human`
with what never arrived (usual causes: bot not enabled for the repo/org,
runner outage, lost webhook) and stop waiting on it. Never poll faster than
60 s, never loop without a timeout.

## Fix agents — one fresh spawn per attempt

Every code fix — a CI failure (Phase A), a review thread (Phases B–D) — runs in
a **freshly spawned agent, one per attempt**. You orchestrate: diagnose far
enough to write the brief, prepare the branch, spawn the fixer, then stage /
commit / push / reply from what it reports. **You never edit code yourself**,
and attempt 2 of the same failure is a **new** agent, never the previous one
re-prompted — that is what makes the caps mean anything.

Mechanism is the writer-spawn ladder from the work-slice review loop, and fixes
are writer work (**strongest model**): **Claude** → a subagent per attempt;
**Codex** → a `codex exec` child per attempt, model from
`routing.codexModelAliases`' `opus` alias; **neither** → run it inline from the
brief alone, as a fresh persona, and disclose the degraded isolation once.

**The brief** (`.context/babysit-<parent>/<pr>-<slot>-<n>.md`, `<slot>` = check
name or thread id, `<n>` = attempt) contains only:

- the PR number + slice id, and the branch — **already checked out by you**;
- **CI:** the failing check, the failing step's real log excerpt from
  `gh run view <run-id> --log-failed`, and the failure signature;
- **thread:** `path:line`, the reviewer's comment body verbatim, the thread id,
  and which bot/human raised it;
- `<GATE>` and the repo contract pointers (`docs/agents/repo-config.md`,
  `tracker.docPath`);
- **every prior attempt on this signature/thread** — `summary` + `whyItFailed`
  from the state file. The fresh agent must not re-try what already failed;
- the discipline rules verbatim: test-first, minimal, no scope creep; a failing
  gate is real until proven otherwise and is **never silenced**; dispute only
  with evidence; and **no `git` writes at all** — no commit, push, checkout,
  stash, rebase or `.git` edits. Git is yours.

**The result** — the fixer writes JSON to
`.context/babysit-<parent>/<pr>-<slot>-<n>.json`:

```json
{"outcome": "fixed | dispute | blocked",
 "summary": "<one line — becomes the commit message / thread reply>",
 "editedFiles": [], "testEvidence": "<commands + final summary lines>",
 "evidence": "<file:line, test output, spec text — dispute only>",
 "whyItFailed": "<blocked only: what was tried, what still fails>"}
```

- `fixed` → stage **exactly** `editedFiles` by name, commit, push, reply/resolve.
- `dispute` → no code change; `evidence` is the thread reply or the log-backed
  "not this PR" CI claim. Hand-waving is not evidence.
- `blocked` → the attempt is burnt: record `summary` + `whyItFailed`; at the
  cap, flag `needs-human` with it.
- Missing or invalid result file → re-spawn **once**; still nothing →
  `needs-human`. Never a silent skip.

`editedFiles` is the authoritative staging list. If `git status` disagrees with
it (files edited but unreported, or reported but untouched), **don't commit**:
flag that PR `needs-human` and say which files diverged.

## Phase A — CI green

Read check state as JSON and classify by `bucket` — never eyeball the table:

```bash
gh pr checks <n> --json name,state,bucket,link,workflow
```

- **All `pass`/`skipping`** → Phase A done.
- **`cancel`** → never turns green on its own. Re-run once (`gh run rerun
  <run-id>`); still cancelled or now failing → treat as `fail`.
- **`pending`** → wait: `timeout 1200 gh pr checks <n> --watch --interval 30
  --fail-fast` (expiry = still pending, not a failure), then re-read; the
  stuck rule above applies (`gh run list --branch <headRefName>` shows nothing
  running for a check pending >30 min → `needs-human`).
- **`fail`** → diagnose from the logs, never the check name:
  ```bash
  gh run list --branch <headRefName> --limit 5 --json databaseId,name,status,conclusion
  gh run view <run-id> --log-failed
  ```
  **Flaky-retry rule:** a suspected-flaky check gets one `gh run rerun
  <run-id> --failed`; a second identical failure is real until the logs name a
  concrete infrastructure cause. "Unrelated to this PR" needs log evidence
  (blame the failing assertion, check `<BASE>`'s CI history). Then check out
  **that PR's branch** (rules below), hand the failure to a **fresh fix agent**,
  stage its `editedFiles`, commit, push, and wait for CI again. Known trap: CI
  can go green on a stale remote build cache — trust the logs.

**Gate discipline:** a failing gate is a real problem until proven otherwise —
fix it, never silence it. `--no-verify`, `eslint-disable` / `# noqa` /
`@ts-ignore`, skipping or deleting the failing test, and lowering a threshold
are not fixes. Warranted disablement (confirmed false positive, test asserting
behaviour the PR intentionally changes) is a `needs-human` decision — reply
with the rationale and leave it.

**Caps:** the state file tracks per-check attempts **and the failure
signature** (failing step + first real error line). The same signature still
failing after **3 fix attempts** → you are guessing, not reading — flag
`needs-human` with the log line and leave it. A different signature on the
same check is a new failure (fresh cap); note the churn.

## Phase B / Phase C — bot rounds until satisfied

Both bot phases run the **same round protocol**; only the trigger differs.
Phase B runs first (`<BOT>`, the review-request bot); Phase C starts only once
Phase B is satisfied (or `n/a`). Skip a phase entirely when its bot is
unconfigured — record `n/a`.

**Trigger** (record `lastTriggerAt` = now, `rounds += 1` in the state file):

- `<BOT>` (Copilot's login is `copilot-pull-request-reviewer[bot]`):
  ```bash
  gh api -X POST repos/{owner}/{repo}/pulls/<n>/requested_reviewers \
    -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
  ```
  Re-requesting after a fix push is exactly how the bot re-reviews. If the API
  rejects the request (bot review not enabled), record `stuck` once, flag
  `needs-human`, and skip the phase — don't retry every round.
- `<COMMENT-BOT>`: `gh pr comment <n> --body '<command>'` (CodeRabbit:
  `@coderabbitai review`). Same command after every fix push.

**Wait** for the review to land — a review by the bot's login submitted after
`lastTriggerAt`:

```bash
gh api repos/{owner}/{repo}/pulls/<n>/reviews \
  --jq '[.[] | select(.user.login=="<login>" and .submitted_at > "<lastTriggerAt>")] | length'
```

Bounded wait (above); stuck rule applies (`needs-human`: "<login> never
delivered round N").

**Address** every unresolved thread on the PR (Phase D's classification and
mechanics — fix / dispute-with-evidence / outdated / needs-human), the bot's
new threads first. Every fix is a fresh fixer; each fix is committed and pushed
as its own commit; after the pushes, run Phase A again (bounded CI watch) so
the next round reviews green code.

**Decide:**

- **Fix commits were pushed this round** → the bot has not seen the fixed code:
  **trigger the next round** (Phase A green first).
- **No code changed** — the round delivered zero new threads, or every thread it
  raised was closed with evidence / as outdated → the bot is **satisfied**:
  record `satisfied: true`, move on. (A review state of `APPROVED`, or a
  CodeRabbit summary reporting zero actionable comments, is the same thing.)
- Threads left `needs-human` don't block the bot's *satisfied* flag (it said
  its piece) — they block the final verdict in Phase D.

**Round cap: 5 rounds per bot per PR.** Round 6 wanted → the bot and the fixer
are chasing each other; flag `needs-human` with the still-open threads and stop
that phase. Caps are a safety boundary, not a target — most PRs settle in 1–2.

## Phase D — review threads

Fetch unresolved threads (`gh api`'s `{owner}`/`{repo}` placeholders only
expand in **REST paths**; in GraphQL pass them as variables — `-F
owner=':owner'` resolves, `-f owner='{owner}'` sends the literal braces):

```bash
gh api graphql -F owner=':owner' -F repo=':repo' -F pr=<n> -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
    reviewThreads(first:100){ nodes{
      id isResolved isOutdated path line
      comments(first:20){ nodes{ databaseId author{login} body createdAt } }
    }}}}}' --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved|not))'
```

For each unresolved thread — same discipline as the review loop: fix or
dispute with evidence, never silently drop:

1. **Valid, actionable** (the default; when torn, fix) → check out the PR's
   branch, hand the thread to a **fresh fix agent**, commit its `editedFiles`,
   push, then reply citing the commit
   (`gh api -X POST repos/{owner}/{repo}/pulls/<n>/comments/<databaseId>/replies -f body='Fixed in <sha>: <one line>'`)
   and resolve:
   ```bash
   gh api graphql -f id='<threadId>' -f query='
   mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
   ```
2. **Factually wrong / not applicable** → reply with concrete evidence
   (file:line, test output, spec text), then resolve. Real evidence only.
3. **Outdated** (`isOutdated` and the code it pointed at is gone) → one-line
   reply why it no longer applies, resolve.
4. **Genuine judgement call / scope decision the human owns** → reply with the
   analysis and options, **leave it unresolved**, flag `needs-human`.

**Thread cap:** a thread that bounces (re-opened or re-objected after a fix)
gets **2 fix attempts**, then `needs-human`.

**Post-hoc bot rule:** a check belonging to a service that comments only after
it completes (coverage, error trackers, hosted analysis) still `pending` →
wait for it (Phase A's watch) before resolving threads, or you'll redo them.

## Branch switching & restacking

Fix commits must land on the *owning* PR's branch:

- `git worktree list` first — never check out a branch held by another
  worktree; flag that PR's fixes `needs-human` (or work there only if the user
  said so).
- In this worktree: `git checkout <branch>` (or `gh stack checkout <branch>`),
  then snapshot `git status --porcelain` as the **pre-existing dirty state** —
  nothing already modified or untracked there may ride into a fix commit.
- Stage **only the fixer's `editedFiles`, by name** — never `git add -A` /
  `git add .`:
  ```bash
  git add <file1> <file2> ...
  git commit -m "<ISSUE> <what>"
  ```
  Afterwards compare `git status --porcelain` with the snapshot; pre-existing
  entries stay uncommitted (say so once if any).
- After committing to a **lower** branch, restack everything above it before
  the next phase: `gh stack view --json` succeeds → `gh stack rebase
  --upstack` + `gh stack push --remote origin`; "not part of a stack" →
  rebase each higher branch by hand (`git rebase --onto <fixed-branch>
  <old-tip> <higher-branch>` + `git push --force-with-lease`), bottom → top.
  A non-mechanical conflict → abort (`gh stack rebase --abort` / `git rebase
  --abort`) and flag `needs-human`.
- End on the top branch.

## Verdict (every run ends with this)

```md
# Babysit — <parent issue id>
| PR | Slice | CI | <BOT> | <COMMENT-BOT> | Unresolved threads | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| #123 | <slice-1 id> | green | satisfied (2 rounds) | satisfied (1 round) | 0 | — |
| #124 | <slice-2 id> | green | satisfied (1 round) | stuck | 1 needs-human | coderabbit never delivered round 2 |

Actions this run: <commits pushed, threads resolved, rounds triggered, restacks>
Blockers (needs-human): <list, or none>

VERDICT: GOAL MET | NOT MET — <the one-line reason: n needs-human threads / missing PRs / stuck bot / capped CI signature>
```

**GOAL MET** requires ALL of, for every non-merged slice: an open PR, CI
green, `<BOT>` **satisfied** (`n/a` when unconfigured), `<COMMENT-BOT>`
**satisfied** (`n/a` when unconfigured), and **zero unresolved threads — no
exceptions**. `needs-human` threads therefore always mean NOT MET, named as the
reason so the human knows the loop waits on them. Merged slices count as done.
A run ends NOT MET **only** when nothing actionable is left — it never ends
merely because something is pending; pending is waited on.

## Boundaries

- **Never merge, approve, or mark a PR ready.** Drafts stay drafts; promoting
  and merging are the human's calls.
- **Runs until terminal or blocked** — but every wait is bounded (20 min per
  poll, two empty polls = stuck) and every loop has a cap; no unbounded watch,
  no polling under 60 s.
- Bot reviews are **GitHub-only**: requested via the reviewers API or summoned
  by PR comment, read back from PR reviews/threads. Never run a review CLI.
- Bots run **in order** — `<BOT>` to satisfied, then `<COMMENT-BOT>` — and
  only on CI-green code. Caps: 5 rounds per bot per PR, 3 fix attempts per CI
  failure signature, 2 per bouncing thread; then `needs-human`, never grind.
- **Every fix is a freshly spawned agent, one per attempt** — you orchestrate
  and own git; you never edit code yourself and never re-prompt a spent fixer.
  Briefs and results travel as files under `.context/babysit-<parent>/`.
- Never silence a gate to go green; warranted disablement is `needs-human`.
- Stage fix commits by explicit file name only — `git add -A`/`git add .` are
  banned here.
- Never resolve a thread you didn't address; never resolve a `needs-human`
  thread — that's the human's click.
- Never touch branches held by other worktrees.
- After pushing a fix, refresh that PR body's `## Verification` block for the
  new head from the fix agent's reported gate runs
  (`../work-slice/references/pr-evidence.md` — replace between the
  `magnus:verification` markers, one edit folded into the push moment; a PR
  without the markers gets the block added once). A table that claims results
  for a head the fix moved past is a false claim.
- Report faithfully: stuck is stuck (with what never arrived), failed is failed
  (with the log line), a skipped phase says `n/a`.

## Workflow Boundaries

**This skill babysits open PRs to a machine-checkable terminal verdict in one sitting.**

- **DOES**: discover + order the stack bottom → top, per PR walk Phase A (CI) → B (`<BOT>` rounds) → C (`<COMMENT-BOT>` rounds) → D (threads), trigger and wait for each bot round with bounded polls, spawn a **fresh fix agent per attempt** on the owning branch, commit/push its reported files, reply + resolve threads, restack after lower-branch fixes, print the verdict block.
- **DOES NOT**: edit code itself or re-use a spent fix agent, merge/approve/mark ready, implement `missing` slices (`/feature-goal` / `/work-slice`), run any review CLI, resolve `needs-human` threads, end with work still actionable.

## Red Flags — STOP

- About to run a review CLI, or to judge the code yourself instead of the bots — stop: bot reviews happen on GitHub; trigger, wait, read back.
- About to trigger Phase C while Phase B is unsatisfied, or any bot round on red CI — stop: phases are sequential; green first.
- About to trigger round 6 for a bot on one PR — stop: 5 is the cap; `needs-human` with the open threads.
- About to poll without a timeout, faster than 60 s, or a third time on an event that never moved — stop: two empty bounded polls = stuck → `needs-human`.
- About to edit code yourself, or re-prompt the previous attempt's fix agent — stop: spawn a fresh fixer with the prior attempts in its brief.
- `git status` disagrees with the fixer's `editedFiles` — stop: don't commit; flag `needs-human`.
- About to `git add -A` / `git add .` — stop: stage the fixer's `editedFiles` by name.
- About to silence a gate — stop: fix it or flag `needs-human` with the rationale.
- Same CI failure signature about to get a 4th attempt, or a bouncing thread a 3rd — stop: capped; `needs-human`.
- About to check out a branch held by another worktree — stop: flag `needs-human`.
- About to end the run with an actionable item left (a fixable thread, a deliverable bot round, a re-runnable check) — stop: babysitting mode finishes or blocks, it does not pause.
- About to classify checks from the human-readable table — stop: `gh pr checks --json`, key on `bucket`.

## Verification

Before reporting done:

- [ ] The verdict block is printed: per-PR table (CI / `<BOT>` / `<COMMENT-BOT>` / unresolved threads / Notes), actions, blockers, one-line VERDICT reason.
- [ ] GOAL MET only if every non-merged slice has an open PR, CI green, both configured bots `satisfied` (`n/a` when unconfigured), and zero unresolved threads.
- [ ] NOT MET only with nothing actionable left — every open item is `needs-human`, capped, or stuck, and the reason names it.
- [ ] Bot rounds ran in order (B before C), each on green CI, each waited for with bounded polls; round counts per bot are in the table.
- [ ] Every thread resolved this run has a reply (commit sha, evidence, or outdated-note); `needs-human` threads are left unresolved and named.
- [ ] `.context/babysit-<parent>.json` is updated (CI counters/signatures, per-bot rounds/satisfied/stuck, thread counters) and `.context/` is in `.git/info/exclude`.
- [ ] Every fix came from a freshly spawned agent with brief + result on disk under `.context/babysit-<parent>/`; fix commits contain exactly its `editedFiles`.
- [ ] After any lower-branch fix, everything above was restacked and pushed; the worktree ends on the top branch.
