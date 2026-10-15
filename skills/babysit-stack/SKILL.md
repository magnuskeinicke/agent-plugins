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
  the finish stage of /feature-goal, /work-slice and /work-issue. Review bots
  are best-effort: a rate-limited or otherwise unavailable bot is skipped and
  disclosed, never a blocker.
argument-hint: "[PRD issue id | feature issue id | PR numbers…]"
---

# Babysit Stack

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `babysit-stack`; supporting skills inherit the caller’s resolved role.

At entry, resolve bootstrap/checkpoint configuration under the shared runtime
contract **before** placeholders, tracker reads or stage detection. A pinned
config takes precedence over the checked-out branch for every setting and is
passed to all constituent skills; a missing named snapshot blocks the run.


Take open draft PRs and drive them to the terminal state: **every PR CI-green,
every available review bot satisfied, every review thread resolved (or
replied-to and explicitly flagged for the human)**. A bot that is rate-limited
or otherwise unavailable is skipped and disclosed, never waited on
([Unavailable bots](#unavailable-bots--skip-never-block)). This is the finish stage
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
| `<BASE>` | `integrationBranch` | `$CONDUCTOR_DEFAULT_BRANCH` (the local Conductor repo's base branch), else `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<BOT>` | `pr.botReviewer` — the review-request bot (Copilot) | **skip Phase B** — record `n/a` |
| `<COMMENT-BOT>` | `pr.commentReviewer` — `{login, command}` of the comment-summoned bot (CodeRabbit: `coderabbitai[bot]`, `@coderabbitai review`) | **skip Phase C** — record `n/a` |
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>`, nothing to restack |
| `<GATE>` | `gates.all` | the fixer discovers the repo's lint/test/build commands and names which it used |
| `<COMMIT-RULE>` | `commit.format` / `commit.pattern` — resolved by the engine (`node "<plugin-root>/engine/cli.mjs" commit-rule`) | the `pr.titleRule` / `pr.scopes` shape, else `<type>: <subject>` |

Also read `tracker.docPath` when it exists. Stack mechanics (rebase/push after
fixing a lower branch) follow the `<STACK>` skill — invoke it before running any
stack command.

## Step 0 — Discover the stack

Input is the PRD ticket id (preferred — the `PRD: …` sub-issue whose children
are the slices), the feature ticket id, or explicit PR numbers.

- **Issue id** → if its sub-issues are a single `PRD:` ticket, you were given
  the feature ticket: descend to that PRD ticket. Then list the PRD ticket's
  sub-issues (stack order = the `/to-issues` numbering, follow `blockedBy`)
  and find each slice's PR — search **all**
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
`lastTriggerAt`, `triggerHead`, `satisfiedHead`, `unavailable`; each PR also records
`requiredBots` in phase order and `ciHead`; per thread: attempt counters; plus
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
code only, and every fix push sends the PR back through Phase A (bounded CI
watch). Review phases form an ordered chain: a fix in Phase B invalidates
Phases B and C, while a fix in Phase C preserves Phase B and restarts at Phase
C. A Phase D fix invalidates only the final configured bot and reruns it after
CI, so the final configured bot is always the last reviewer of the final head.
Throughout, "final configured bot" means the last configured bot **not marked
`unavailable`**; an unavailable bot's phase counts as done.

### Waiting — bounded, never busy

Every wait is **one bounded command**, polling every 60 s, at most 10 minutes:

```bash
timeout 600 bash -c 'until <condition>; do sleep 60; done'   # exit 124 = still waiting
```

(Runtime blocks foreground `sleep`? Use its monitor/wait tool with the same
bound.) A wait that expires is not a failure — re-check state; if nothing at
all changed (no run started, no review posted), wait **once more**. Two empty
waits in a row (≈20 min) on the same event = **stuck** and stop waiting on it.
A stuck **CI** event (runner outage, lost webhook) → flag `needs-human` with
what never arrived. A stuck **bot** round is not a blocker: mark the bot
`unavailable` (`no review delivered`) and move on — see below. Never poll
faster than 60 s, never loop without a timeout.

### Unavailable bots — skip, never block

AI review bots are best-effort. Run them whenever they are available, but a bot
that cannot review is **skipped, not waited on**: babysit never ends NOT MET
and never flags `needs-human` because a review bot was unavailable. Mark a bot
`unavailable` for the PR on concrete evidence only:

- **Rate limit / quota** — the trigger is answered by a rate-limit or
  usage-limit notice instead of a review (CodeRabbit: a comment headed `Rate
  limit exceeded` with `Please wait <N> minutes and <S> seconds before
  requesting another review`; Copilot: a review or comment saying it hit a
  quota/limit), in a bot comment, review or check run.
- **Error / paused** — the bot reports it could not review (`Review failed`,
  `encountered an error`, `wasn't able to review`, `Reviews paused`), or its
  check run concludes with such an error.
- **Rejected trigger** — the reviewers API refuses the request (bot not enabled
  for the repo, org or plan).
- **No-show** — two empty bounded waits on the same trigger (the stuck rule).

**Never wait for a rate limit to lift**, however short the reset it names: a
rate-limit, quota, error or rejection notice marks the bot `unavailable` at
once — no wait, no re-trigger.

Record `bots.<login>.unavailable = {reason, head, at, evidence}` (`evidence` =
the notice's comment/review id or the API error line), leave `satisfiedHead`
unset, and continue as if the phase were complete: Phase B unavailable →
Phase C; Phase C unavailable → Phase D. A rate-limit or error notice is **never
a satisfied round** — it reviewed nothing. Threads the bot raised in earlier
rounds, or in a late review that still arrives, are Phase D work like any
other. Do not re-trigger an `unavailable` bot again in this run; a later
invocation clears the mark and gives the bot one fresh trigger on the current
head (a no-show then marks it after **one** empty wait).

**Disclose it** — skipping is fine, hiding it is not: the bot's column in the
verdict table reads `unavailable (<reason>)`, the VERDICT line names the skipped
bot, and the PR body's `## Notes` gets one bullet `<bot> did not review the
final head: <reason>` (between the `magnus:notes` markers, folded into the next
push-time body edit, or one `gh pr edit` of its own when no push follows;
`../work-slice/references/pr-evidence.md`). Remove that bullet if a
later run gets the bot's current-head review.

## Fix agents — one fresh spawn per attempt

Every code fix — a CI failure (Phase A), a review thread (Phases B–D) — runs in
a **freshly spawned agent, one per attempt**. You orchestrate: diagnose far
enough to write the brief, prepare the branch, spawn the fixer, then stage /
commit / push / reply from what it reports. **You never edit code yourself**,
and attempt 2 of the same failure is a **new** agent, never the previous one
re-prompted — that is what makes the caps mean anything.

Use the shared runtime contract's `fixer` profile for a fresh native worker or
CLI task. Prepare the brief below, then emit a standalone task with `--role
fixer --schema babysit-fix`; run its manifest with the adapter for the current
runtime. The same schema supports native Claude workers. Return JSON to the
parent; the parent validates and saves it. No inline persona fallback.

**The brief** (`.context/babysit-<parent>/<pr>-<slot>-<n>.md`, `<slot>` = check
name or thread id, `<n>` = attempt) contains only:

- the PR number + slice id, and the branch — **already checked out by you**;
- **CI:** the failing check, the failing step's real log excerpt from
  `gh run view <run-id> --log-failed`, and the failure signature;
- **thread:** `path:line`, the reviewer's comment body verbatim, the thread id,
  and which bot/human raised it;
- `<GATE>` and the repo contract pointers (`docs/agents/repo-config.md`, or
  the pinned config when the run has one, and `tracker.docPath`);
- the `text` of `commit-rule` (below) — the fixer's `summary` becomes the
  `<subject>` slot of that shape: one line, no type or issue prefix;
- **every prior attempt on this signature/thread** — `summary` + `whyItFailed`
  from the state file. The fresh agent must not re-try what already failed;
- the discipline rules verbatim: test-first, minimal, no scope creep; a failing
  gate is real until proven otherwise and is **never silenced**; dispute only
  with evidence; and **no `git` writes at all** — no commit, push, checkout,
  stash, rebase or `.git` edits. Git is yours.

**The result** — the parent saves the fixer's returned JSON to
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

- **All `pass`/`skipping`** → re-read the PR head; only if unchanged throughout this check, record `ciHead` and mark Phase A done. Check run `head_sha` must match; no checks is a blocker unless the repo explicitly has no CI.
- **`cancel`** → never turns green on its own. Re-run once (`gh run rerun
  <run-id>`); still cancelled or now failing → treat as `fail`.
- **`pending`** → wait: `timeout 600 gh pr checks <n> --watch --interval 30
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
Phase B is satisfied (or `n/a` / `unavailable`). Skip a phase entirely when its
bot is unconfigured — record `n/a`.

**Trigger** (read the current PR head, record `triggerHead`, `lastTriggerAt` = now, `rounds += 1` in the state file):

- `<BOT>` (Copilot's login is `copilot-pull-request-reviewer[bot]`):
  ```bash
  gh api -X POST repos/{owner}/{repo}/pulls/<n>/requested_reviewers \
    -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
  ```
  Re-requesting after a fix push is exactly how the bot re-reviews. If the API
  rejects the request (bot review not enabled), mark the bot `unavailable` and
  skip the phase — don't retry every round.
- `<COMMENT-BOT>`: `gh pr comment <n> --body '<command>'` (CodeRabbit:
  `@coderabbitai review`). Same command after every fix push.

**Wait** for a result bound to this trigger's head. Read a complete snapshot:

```bash
node "<plugin-root>/engine/github.mjs" <n> > .context/babysit-<parent>/<n>-snapshot.json
```

This helper pages REST reviews/comments, GraphQL threads **and** each thread's
comments, and rejects a head change during the read. A review delivers the round
only when its author matches, `commit_id == triggerHead == snapshot.head`, and
`submitted_at >= lastTriggerAt`. An earlier round arriving late cannot satisfy
this one. For edited bot summary comments, inspect `updated_at` as well.

A comment-only completion (such as CodeRabbit reporting no actionable changes)
needs an explicit reviewed SHA in the bot output or its associated completed
check run, matching `triggerHead`. A timestamp or “Review finished” string alone
cannot prove which commit was reviewed. An ambiguous comment keeps the bounded
wait pending; request a review on the current head, then apply the usual stuck
cap if no attributable completion arrives. Once current-head completion is
proved, a no-action round is delivered and may be satisfied without a review
object. Never infer success from an empty page or an API error. While waiting,
also read the bot's comments, reviews and check runs after `lastTriggerAt` for
a rate-limit, quota or error notice — one ends the wait and goes to
[Unavailable bots](#unavailable-bots--skip-never-block).

**Address** every unresolved thread on the PR (Phase D's classification and
mechanics — fix / dispute-with-evidence / outdated / needs-human), the bot's
new threads first. Every fix is a fresh fixer; each fix is committed and pushed
as its own commit; after the pushes, run Phase A again (bounded CI watch) so
the next round reviews green code.

**Decide:**

- **Fix commits were pushed in Phase B** → the bot and every later bot have
  not seen the fixed code: invalidate Phases B and C, then **restart Phase A →
  B → C → D**. Keep attempt caps across head changes.
- **Fix commits were pushed in Phase C** → preserve Phase B as a completed
  milestone, invalidate Phase C, then **restart Phase A → C → D**. The
  final bot reviews every fix produced by its own rounds without sending the
  PR back to an earlier reviewer.
- **No code changed** — the round delivered zero new threads, or every thread it
  raised was closed with evidence / as outdated → the bot is **satisfied**:
  record `satisfiedHead: <current SHA>` with the supporting review/check ID, move on. (A review state of `APPROVED`, or a
  CodeRabbit summary reporting zero actionable comments, is the same thing.)
- Threads left `needs-human` don't block the bot's *satisfied* flag (it said
  its piece) — they block the final verdict in Phase D.
- **The bot could not review** (rate limit, quota, error, no-show) → mark it
  `unavailable` and move on to the next phase. That is never a reason for
  `needs-human` or NOT MET.

**Round cap: 5 rounds per bot per PR.** Round 6 wanted → the bot and the fixer
are chasing each other; flag `needs-human` with the still-open threads and stop
that phase. Caps are a safety boundary, not a target — most PRs settle in 1–2.

## Phase D — review threads

Use `unresolved` from a fresh `engine/github.mjs <n>` snapshot. Never use an
unpaged `first:100` query as proof that all threads were read. Resolve and reply
using the IDs in the snapshot; after mutations fetch it again.

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
4. **Out of scope** (a suggestion about code this PR did not change, or a
   refactor/generalisation beyond the PR's purpose, and not a bug the PR
   introduces) → one-line reply: `Outside this PR's scope; not pursued.`
   Then resolve. **Never file a ticket for it.** Babysit files no follow-up
   tickets (`../work-slice/references/followups.md`).
5. **Genuine judgement call / scope decision the human owns** → reply with the
   analysis and options, **leave it unresolved**, flag `needs-human`.

**Thread cap:** a thread that bounces (re-opened or re-objected after a fix)
gets **2 fix attempts**, then `needs-human`.

After a Phase D fix push, invalidate CI and the final configured bot only, then
restart at Phase A and rerun that final bot before returning to Phase D. If no
bot is configured, or every configured bot is `unavailable`, restart at Phase A
and return directly to Phase D.

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
  engine="<plugin-root>/engine/cli.mjs"   # add --config <pinned config> to both engine calls when the run has one
  before=$(git rev-parse HEAD)
  git add <file1> <file2> ...
  git commit -m "$(node "$engine" commit-rule --issue <slice-id> --type fix --scope <PR scope> \
    --subject "<fixer summary>" | jq -r .subject)"
  node "$engine" commit-check --range "$before..HEAD"   # must print ok: true before the push
  ```
  The subject follows `<COMMIT-RULE>`, never "issue id first" unless the rule
  says so. `commit-rule` prints an empty `subject` when the format is prose, not
  a template — write it by hand from `format`. `commit-check` exits non-zero on
  a mismatch: this commit is yours, so `git commit --amend -m "<conforming
  subject>"` and re-check before pushing. Afterwards compare `git status --porcelain` with the snapshot; pre-existing
  entries stay uncommitted (say so once if any).
- After committing to a **lower** branch, restack everything above it before
  the next phase: `gh stack view --json` succeeds → `gh stack rebase
  --upstack` + `gh stack push --remote origin`; "not part of a stack" →
  rebase each higher branch by hand (`git rebase --onto <fixed-branch>
  <old-tip> <higher-branch>` + `git push --force-with-lease`), bottom → top.
  A non-mechanical conflict → abort (`gh stack rebase --abort` / `git rebase
  --abort`) and flag `needs-human`.
- After a same-PR fix push, invalidate `ciHead` plus the current and later bot
  phases; a Phase D fix invalidates only the final configured bot. After a
  restack or any out-of-band head change, invalidate `ciHead` and every bot
  `satisfiedHead` for each changed PR because no reviewer phase owns that
  change. Restart each affected PR at the earliest invalidated phase after
  Phase A, bottom → top. Preserve attempt counters so a new SHA cannot reset
  caps. End on the top branch.

## Verdict (every run ends with this)

The verdict block below is the run's **terminal report** — printed to the
caller, written to the state file, and (under `/feature-goal`) stamped as the
`babysit:` line on the slice's `## Cloud dispatch` comment. It is **never
posted as a PR comment**: the suite does not comment on its own PRs
(`../work-slice/references/pr-evidence.md` — the PR body is its only voice
there, and babysit's only body write is the `## Verification` refresh). The
only PR comments babysit ever writes are `<COMMENT-BOT>`'s summon command and
the per-thread replies.

```md
# Babysit — <PRD issue id>
| PR | Slice | CI | <BOT> | <COMMENT-BOT> | Unresolved threads | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| #123 | <slice-1 id> | green | satisfied (2 rounds) | satisfied (1 round) | 0 | — |
| #124 | <slice-2 id> | green | satisfied (1 round) | unavailable (rate limit) | 1 needs-human | coderabbit rate-limited; skipped |

Actions this run: <commits pushed, threads resolved, rounds triggered, restacks>
Blockers (needs-human): <list, or none>

VERDICT: GOAL MET | NOT MET — <the one-line reason: n needs-human threads / missing PRs / stuck CI / capped CI signature>; skipped bots: <login (reason), or none>
```

Before the verdict, write a per-PR JSON view of its state with `requiredBots`
(in phase order),
`ciHead`, `bots.<login>.satisfiedHead` and `bots.<login>.unavailable`, then run:

```bash
node "<plugin-root>/engine/github.mjs" <n> <per-pr-state.json>
```

The helper re-reads all pages and compares recorded CI/bot evidence with the
ordered review chain. Reconstruct `requiredBots` from the pinned config in
Phase B → Phase C order; never leave the array empty to skip configured bots —
an unavailable bot stays in `requiredBots` and is skipped through its
`unavailable` record, which the helper reports back as `skippedBots`.
Every earlier available bot must have a `satisfiedHead`, and the final
available bot's `satisfiedHead` must equal the live head. This makes the final bot the terminal
reviewer: its current-head pass covers fixes made after earlier phases. Legacy
`satisfied: true` flags without a SHA require a fresh round. Its GOAL MET also
requires zero unresolved threads. Recheck every non-merged PR after the final
restack, not only the last PR visited.

**GOAL MET** requires ALL of, for every non-merged slice: an open PR, CI green
on the current head, every configured bot phase completed in order (an
`unavailable` bot's phase counts as completed), the final available bot
**satisfied on the current head**, and **zero unresolved threads — no
exceptions**. When both are available, `<BOT>` may retain its earlier
completed-phase SHA while `<COMMENT-BOT>` must match the current head; when
only one is available, that bot is final and must match; when none is, CI and
threads alone decide. A skipped bot never turns GOAL MET into NOT MET — it is
disclosed in the VERDICT line and the PR's `## Notes`. `needs-human` threads
therefore always mean NOT MET, named as the reason so the human knows the loop
waits on them. Merged slices count as done. A run ends NOT MET **only** when
nothing actionable is left — it never ends merely because something is
pending; pending is waited on.

## Boundaries

- **Never merge, approve, or mark a PR ready.** Drafts stay drafts; promoting
  and merging are the human's calls.
- **Runs until terminal or blocked** — but every wait is bounded (10 min per
  poll, two empty polls = stuck) and every loop has a cap; no unbounded watch,
  no polling under 60 s.
- **Review bots are best-effort.** A rate-limited, out-of-quota, erroring,
  not-enabled or no-show bot is marked `unavailable`, skipped and disclosed —
  never `needs-human`, never NOT MET on its own.
- Bot reviews are **GitHub-only**: requested via the reviewers API or summoned
  by PR comment, read back from PR reviews/threads. Never run a review CLI.
- Bots run **in order** — `<BOT>` to satisfied, then `<COMMENT-BOT>` as the
  terminal reviewer — and only on CI-green code. Later-phase fixes never send
  the PR back to an earlier reviewer; they rerun CI and the final configured
  bot. Caps: 5 rounds per bot per PR, 3 fix attempts per CI failure signature,
  2 per bouncing thread; then `needs-human`, never grind.
- **Every fix is a freshly spawned agent, one per attempt** — you orchestrate
  and own git; you never edit code yourself and never re-prompt a spent fixer.
  Briefs and results travel as files under `.context/babysit-<parent>/`.
- Never silence a gate to go green; warranted disablement is `needs-human`.
- Stage fix commits by explicit file name only — `git add -A`/`git add .` are
  banned here. Every fix commit's subject follows `<COMMIT-RULE>` and passes
  `commit-check` before it is pushed.
- Never resolve a thread you didn't address; never resolve a `needs-human`
  thread — that's the human's click.
- Never touch branches held by other worktrees.
- After pushing a fix, refresh that PR body's `## Verification` block for the
  new head from the fix agent's reported gate runs
  (`../work-slice/references/pr-evidence.md` — replace between the
  `magnus:verification` markers, one edit folded into the push moment; a PR
  without the markers gets the block added once). A table that claims results
  for a head the fix moved past is a false claim.
- **Never capture or publish visual evidence.** `## Verification` is the only
  body block babysit writes. `## Visual verification` is captured *after* this
  skill returns GOAL MET, by the caller (`/work-slice` Step 8, `/work-issue`
  Step 7a) — so a bot round can never strand a stale screenshot. If a PR
  already carries the block (a review round re-opened on a captured PR), leave
  it in place and name the affected scenes as stale in the report; the caller
  re-captures.
- Report faithfully: stuck is stuck (with what never arrived), failed is failed
  (with the log line), a skipped phase says `n/a`.

## Workflow Boundaries

**This skill babysits open PRs to a machine-checkable terminal verdict in one sitting.**

- **DOES**: discover + order the stack bottom → top, per PR walk Phase A (CI) → B (`<BOT>` rounds) → C (`<COMMENT-BOT>` rounds) → D (threads), trigger and wait for each bot round with bounded polls, spawn a **fresh fix agent per attempt** on the owning branch, commit/push its reported files, reply + resolve threads, restack after lower-branch fixes, print the verdict block.
- **DOES NOT**: edit code itself or re-use a spent fix agent, merge/approve/mark ready, implement `missing` slices (`/feature-goal` / `/work-slice`), run any review CLI, resolve `needs-human` threads, end with work still actionable.

## Red Flags — STOP

- About to run a review CLI, or to judge the code yourself instead of the bots — stop: bot reviews happen on GitHub; trigger, wait, read back.
- About to trigger Phase C while Phase B is unsatisfied (and not `unavailable`), or any bot round on red CI — stop: phases are sequential; green first.
- About to flag `needs-human`, end NOT MET, wait out a rate-limit reset, or keep waiting because a review bot is rate-limited, out of quota, erroring or not delivering — stop: mark it `unavailable`, disclose it, move on.
- About to count a rate-limit or error notice as a satisfied round — stop: it reviewed nothing; that bot is `unavailable`, not satisfied.
- About to trigger round 6 for a bot on one PR — stop: 5 is the cap; `needs-human` with the open threads.
- About to poll without a timeout, faster than 60 s, or a third time on an event that never moved — stop: two empty bounded polls = stuck → `needs-human` for CI, `unavailable` for a bot.
- About to edit code yourself, or re-prompt the previous attempt's fix agent — stop: spawn a fresh fixer with the prior attempts in its brief.
- `git status` disagrees with the fixer's `editedFiles` — stop: don't commit; flag `needs-human`.
- About to `git add -A` / `git add .` — stop: stage the fixer's `editedFiles` by name.
- About to silence a gate — stop: fix it or flag `needs-human` with the rationale.
- Same CI failure signature about to get a 4th attempt, or a bouncing thread a 3rd — stop: capped; `needs-human`.
- About to check out a branch held by another worktree — stop: flag `needs-human`.
- About to end the run with an actionable item left (a fixable thread, a deliverable bot round, a re-runnable check) — stop: babysitting mode finishes or blocks, it does not pause.
- About to classify checks from the human-readable table — stop: `gh pr checks --json`, key on `bucket`.
- About to `gh pr comment` the verdict block, a per-PR summary, or any "babysit report" onto the PR — stop: the verdict is the terminal report + state file (+ the dispatch-comment `babysit:` line under `/feature-goal`); PR comments are for the bot summon and thread replies only.
- About to record a bot as `unavailable` while a `Review finished` / zero-actionable comment from it sits after `lastTriggerAt` — stop: that is a delivered, satisfied round.

## Verification

Before reporting done:

- [ ] The verdict block is printed: per-PR table (CI / `<BOT>` / `<COMMENT-BOT>` / unresolved threads / Notes), actions, blockers, one-line VERDICT reason.
- [ ] GOAL MET only if every non-merged slice has an open PR, CI green, every
  configured bot phase completed in order (or skipped as `unavailable`), the
  final available bot satisfied on the current head, and zero unresolved
  threads.
- [ ] NOT MET only with nothing actionable left — every open item is `needs-human`, capped, or stuck CI, and the reason names it. An unavailable bot is never the reason.
- [ ] Every `unavailable` bot has its evidence in the state file, is named in the table and VERDICT line, and has its `## Notes` bullet on the PR.
- [ ] Bot rounds ran in order (B before C), each on green CI; a fix owned by C
  or D did not return to B, the final configured bot reviewed the current head,
  each wait was bounded, and round counts per bot are in the table.
- [ ] Every thread resolved this run has a reply (commit sha, evidence, or outdated-note); `needs-human` threads are left unresolved and named.
- [ ] `.context/babysit-<parent>.json` is updated (CI counters/signatures, per-bot rounds/satisfied/unavailable, thread counters) and `.context/` is in `.git/info/exclude`.
- [ ] Every fix came from a freshly spawned agent with brief + result on disk under `.context/babysit-<parent>/`; fix commits contain exactly its `editedFiles`.
- [ ] After any lower-branch fix, everything above was restacked and pushed; the worktree ends on the top branch.
