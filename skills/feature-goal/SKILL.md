---
name: feature-goal
description: >
  Run the feature pipeline from grilling through PRD and sliced issues to a
  green draft PR stack and QA handoff. Grilling is the one human gate. A cloud
  relay uses one fresh Claude or Codex session per PR with explicit model
  roles; the caller dispatches, confirms the relay started and stops. Each PR is
  babysat through CI, review bots and threads before the next layer starts.
  Resumes saved stages, configuration and current-head evidence. Opt-in local
  mode uses one worktree with fresh workers. Use when the user says "run the
  feature pipeline", "take this ticket to a green stack", "resume the feature
  pipeline", or wants a grilled feature implemented end to end.
argument-hint: "[feature issue id | PRD issue id] [local]"
---

# Feature Goal

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `feature-goal`; supporting skills inherit the caller’s resolved role.

At entry, resolve bootstrap/checkpoint configuration under the shared runtime
contract **before** placeholders, tracker reads or stage detection. A pinned
config takes precedence over the checked-out branch for every setting and is
passed to all constituent skills; a missing named snapshot blocks the run.


The feature-pipeline orchestrator: a **re-entrant stage machine** built on the
existing suite — `grill-with-docs`, `to-prd`, `to-issues`, the work-slice
engine-CLI loop, the repo's PR skill, the stack tool, `babysit-stack`. Every
invocation re-detects where the pipeline stands from **durable markers**
(tracker comments, sub-issues, branches, PR state — never conversation memory
alone) and does the next thing.

**Two halves.** Planning (grill → PRD → slices) is interactive and happens
**here**, in this session — locally, or in a cloud workspace the grilling
session was handed off to. Development and everything after it happens in
**one Conductor cloud workspace — the pipeline workspace** — as a **relay of
fresh sessions**: the planning session starts session 1 and ends; session 1
works exactly one slice to a stacked draft PR, **babysits that PR to GOAL
MET** (CI, every configured review bot, every thread), starts session 2 and
ends; … the last PR session starts the babysit session (the stack-wide sweep)
and ends. Each layer is cut on a bot-reviewed, green PR — a finding in slice
N is fixed before slice N+1 exists, so it never ripples up the stack. **No
session ever does more than one PR**, so no agent accumulates the whole
stack's context, and the pipeline keeps running unattended once the user
walks away. The planning session plans, dispatches, confirms the first worker
is running, and **ends** — nothing local stays alive while the cloud works.
Recovery and queued tracker publication happen at the next invocation.

**One human gate, ever: the grilling session.** Everything downstream of it is
autonomous — no approval prompts, no "does this look right?", no HITL slices,
no confirmation before a PR. Decisions the pipeline needs are made **in the
grill** or, when one surfaces later, made by the agent and **recorded as an
assumption** on the ticket and the PR for the human to read at review time.
**Persistence is re-invocation** — when a run ends, its report says exactly
where the pipeline stands and that `/feature-goal <ISSUE>` resumes it.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block) once at entry and
keep the values to hand; every placeholder below is written in terms of them.
Missing file or empty key → use the fallback in the right-hand column and say so
once, in your first message.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) — the **feature ticket**, the human's | the tracker's own id form (`#123` for GitHub Issues) |
| `<PRD-ISSUE>` | derived — the sub-issue of `<ISSUE>` titled `PRD: …`; its description is the PRD, every slice hangs off it | none → stage GRILL / PRD creates it |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `$CONDUCTOR_DEFAULT_BRANCH` (the local Conductor repo's base branch), else `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | discover Dev in progress via the shared lifecycle |
| `<IN-REVIEW>` | `tracker.statuses.inReview` | discover Dev technical review via the shared lifecycle |
| `<DONE>` | `tracker.statuses.done` | discover Done via the shared lifecycle |
| `<NEXT>` | `labels.sliceNext` | no pointer label — stack order alone picks the next slice |
| `<SKIP>` | `labels.managerSkip` | skip the triage opt-out stamp |
| `<HITL>` | `labels.needsHuman` | read "needs a human decision" from the ticket body — informational here, never a gate |
| `<TYPE:>` | `labels.typePrefix` | skip the type label |
| `<BOT>` | `pr.botReviewer` | babysit skips the review-request bot phase |
| `<COMMENT-BOT>` | `pr.commentReviewer` | babysit skips the comment-summoned bot phase |
| `<MEDIA-BRANCH>` | `pr.mediaBranch` | `pr-media` — where the slices published their evidence media |
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>` — with `gh-stack` (the expected value) every PR is a layer of **one linear GitHub stack** |
| `<AGENT:>` | `routing.labelPrefix` | no agent routing — this runtime's agent works every slice |
| `<DISPATCH>` | `routing.dispatch` (`cloud` \| `local`) | `cloud` — one pipeline workspace, a fresh session per PR |
| `<CLOUD-MODEL>` | shared registry `model --role <role> --runtime <agent> --cloud` | explicit role model/effort; legacy `routing.cloudModels` remains supported |

**Ticket tree** (`../work-slice/references/qa-handoff.md`): the **feature
ticket** `<ISSUE>` is the human's — PM, designers and QA read it; the suite
writes claim/status fields and labels and, once the whole stack is babysat green,
one concise `## QA handoff` comment with its evidence embedded inline. `/to-prd` creates the **PRD ticket** `<PRD-ISSUE>` under it
(`PRD: <feature title>`, description = the PRD, dev-owned: implementation
deltas live there). `/to-issues` hangs every **slice** off the PRD ticket.
Given a `PRD:` ticket as the argument, `<ISSUE>` is its parent; given the
feature ticket, `<PRD-ISSUE>` is its `PRD:` sub-issue. Legacy pipelines
(before 2026-09-03) carried the PRD as a `# PRD` comment on the feature ticket
with slices directly beneath it — for those, treat the feature ticket as both
for PRD lookup, but never include that human parent in the generated-ticket Done sweep.

Also read the prose docs the config points at when they exist:
`tracker.docPath`, `labels.docPath`, and `docs/agents/README.md`.
Read [the shared issue lifecycle](../work-slice/references/issue-lifecycle.md).
First run the read-only wayfinder lookup (Stage GRILL / PRD): an ACTIVE map
listing the feature ends the run before any claim. Then resolve and claim the
human feature parent at entry, before GRILL/PRD or dispatch: preserve/resolve
its assignee, remove `labels.agentReady`, and set
`<IN-PROGRESS>`. On resume, reconcile the live stage first so a completed
handoff is not reset. Claim an existing PRD when using it; when `/to-prd`
creates the parent/PRD, apply their claims immediately before SLICE-SPLIT.
The per-PR session's own procedure (branching with `gh stack`, running
work-slice, linking the PR, passing the baton) is `references/pr-session.md`
— read it when this session **is** a PR session (see "Which session am I?").
Local mode (`<DISPATCH>` = `local`, the user says `local`, or neither the
Conductor MCP nor the `conductor` CLI is reachable) is documented in
`references/local-loop.md` — read it only when that mode is active.

## Persistence — run again to resume

One invocation advances the pipeline as far as it can, then ends with a report.
A run ends at exactly five kinds of boundary:

- **The grilling gate** — the user disengaged mid-grill or the grill surfaced a
  decision they must take away. Name what they must decide; they act, then
  re-invoke. This is the **only** point where the pipeline waits on the human
  for input.
- **Relay dispatched (outside sessions)** — the pipeline workspace is
  bootstrapped and a worker session is confirmed working. Report the deep links
  and stop; the relay runs unattended and the next invocation reconciles it
  (`references/cloud-relay.md`).
- **Baton passed (PR workers only)** — a PR worker created and recorded its
  successor. It emits the handoff marker and ends. Nothing waits on it.
- **Blocked** — nothing actionable remains but the goal isn't met: a PR
  session's babysit of its own PR, or the stack-wide babysit, ended NOT MET
  with only `needs-human` items (judgement-call threads, stuck CI, an
  exhausted fix cap — never an unavailable review bot), a slice's loop hard-stopped (gut-check block), a
  bootstrap failed, or a relay session died twice on the same slice. Report
  each blocker plainly as the stop reason; the human unblocks, then
  re-invokes.
- **Done** — current-head babysit GOAL MET, QA handoff and PR issue links verified,
  parent `<IN-REVIEW>`, and all workflow-generated descendants `<DONE>`.

Nothing else ends a run: not a PRD ready for approval, not a slice breakdown,
not a PR opened, not a bot review pending (babysit waits for those itself).

Every report ends with the resume line: the current stage, the blocking reason
if any, and the exact command (`/feature-goal <ISSUE>`) that continues it.

**Checkpoint.** Keep `.context/<ISSUE>/pipeline-state.md` (gitignored) — a
single overwritten `## Workflow State` block. In cloud mode it lives in the
**pipeline workspace**, where every relay session can read the one before it
wrote:

```markdown
## Workflow State
- Stage: GRILL/PRD | SLICE-SPLIT | SLICE-LOOP | BABYSIT | QA-HANDOFF | DONE
- Dispatch: cloud | local
- Feature ticket: PROJ-1200
- PRD ticket: (none | PROJ-1201)
- Claim owner: <initiating user / run or workspace>
- Generated tickets: <IDs + roles, reconciled with the full tracker tree>
- PR issue mapping: <PR → parent / PRD / slice IDs and URLs>
- Tracker lifecycle: <claims verified | finalization pending operations | finalized>
- Docs branch: <pushed planning-docs branch>
- Dispatcher session: <session id that last dispatched or reconciled>
- Pipeline workspace: (none | <workspace deep link> / <workspace id>)
- Tracker writes: (sandbox | planning — <reason, e.g. GitHub App token: 403 on issue writes>)
- Slice cursor: PROJ-1234 (03 of 05) | (none)
- Relay: (none | <session id> → <NN>-<slice-id> | babysit, started <ISO time>)
- Resumed: (none | PROJ-1234 ×1, …)
- Assumptions recorded: (none | PROJ-1234: <one line>, …)
- PR babysit verdicts: (none | 01 PROJ-1230: GOAL MET, 02 PROJ-1234: NOT MET — <reason>, …)
- Stack babysit verdict: (none | GOAL MET | NOT MET — <reason>)
```

Rewrite it at every stage boundary, after every claim, PR, and baton pass, and
after every babysit read-out. It is a cache, not the truth: **stage detection
below always wins**.

## Stage detection — run this at every (re)entry

Detect the stage from observable state, never from conversation memory alone.
With the feature ticket id `<ISSUE>` (from the argument or the conversation —
a `PRD:` id resolves to its parent; if there is no feature ticket yet, that's
stage 0/1):

Resolve the highest completed stage, with these rules in order. Slice discovery
uses the owned workflow inventory from `issue-lifecycle.md`, never every child
unfiltered; human-created children are outside this pipeline.

1. No feature ticket or no PRD sub-issue → GRILL / PRD.
2. PRD exists, no slice sub-issues → SLICE-SPLIT.
3. Any slice lacks an open/merged PR, or an open PR has unfinished engine,
   browser, babysit or capture stages → SLICE-LOOP. Resume that owned PR before
   claiming another slice, even when GOAL MET was recorded before a capture
   crash. A merged PR is done. Read queued dispatch markers and checkpoints
   when `Tracker writes: planning`; live PR state is the tie-breaker.
4. All slices complete but stack-wide verdict does not cover every current head
   → BABYSIT. A later fix/restack invalidates earlier head-bound verdicts.
5. Current-head stack verdict is GOAL MET but media, the QA walk, the QA handoff, PR issue
   links or final tracker statuses are missing or stale → QA-HANDOFF.
   Recover missing/stale Step 8 media on each owning branch
   before publication; honor a recorded not-applicable reason for that head.
6. Current-head stack verdict, media (or recorded not-applicable reasons), PR
   issue mappings, published QA handoff, parent `<IN-REVIEW>` and every owned
   generated descendant `<DONE>` verified → DONE. An old comment alone is not proof.

### Which session am I? (cloud mode, stages SLICE-LOOP / BABYSIT)

The checkpoint records `Dispatcher session` and `Relay`. Determine your current
workspace and session identity from Conductor before checking another session's
status. `Dispatcher session` records who last dispatched; it does not assign
the current session's role.

If `Relay` names your current session, **you are that worker**. At BABYSIT,
run `/babysit-stack <PRD-ISSUE>` here and continue to QA-HANDOFF. Your own
`working` status is expected; it is never a reason to report a progressing
babysitter and stop, reconcile yourself, or create a replacement for yourself.

Use workspace identity when the relay checkpoint has not caught up with session
creation; do not infer that a recorded worker is someone else merely because
you could not obtain your session ID:

- **In the pipeline workspace** — a Conductor cloud sandbox
  (`/conductor/bin/conductor` exists) whose workspace id (`conductor workspace
  get --json`) matches the checkpoint's `Pipeline workspace`, or the
  `## Cloud dispatch` markers on the slices, or no pipeline workspace is
  recorded anywhere yet (then this one becomes it — the grilling session was
  handed off here). → You are a **relay session**: SLICE-LOOP makes you a
  **PR session** (`references/pr-session.md`), BABYSIT makes you the
  **babysit session** (stage BABYSIT below).
- **Anywhere else** (a local worktree, a different cloud workspace) → you are
  a **planning / dispatching session**: you never work a slice or babysit in
  cloud mode. You start, reconcile or read the relay (SLICE-LOOP "From outside
  the pipeline workspace" below) in **one step**, then end the run.

## Stage GRILL / PRD — the one human gate

The grilling session is the one input this skill will not manufacture:

- **Wayfinder handoff** (read-only; runs before the entry claim). Look for a
  `wayfinder:map` issue that is related to `<ISSUE>`, is a sub-issue of
  `<ISSUE>`'s parent, or sits in `<ISSUE>`'s project, and that covers it: a CLEAR map's `## Handoff` table
  lists `<ISSUE>`; an ACTIVE map counts when it is related to `<ISSUE>`.
  Under an ACTIVE map, stop
  without claiming the parent: name the open tickets that must resolve first
  (`/wayfinder <map>`). Under a CLEAR map, its decisions are settled human
  input: read the resolution comments of the decisions the row inherits; if
  the handoff names a docs branch, `git fetch origin`, check it exists with
  `git ls-remote --exit-code origin refs/heads/<docs-branch>` and
  `git merge origin/<docs-branch>` (absent → say so and continue); then run
  `/grill-with-docs` as a **delta grill** — only the pipeline branches below
  that the map left open. Never re-ask a mapped decision unless the code now
  contradicts it. The PRD cites the inherited decisions.
- If the current conversation already contains a completed grilling session
  (decision tree traversed, decisions crystallised) → continue to `/to-prd`.
- If not → **run `/grill-with-docs` now, in this conversation**, seeded with
  `<ISSUE>`, and conduct the grilling with the user for real. Because nothing
  downstream will ask again, the grill must settle **everything the pipeline
  will otherwise have to assume**: the test seams (`/to-prd` would normally
  confirm these), the cross-layer decisions the skeleton slice inherits, the
  slice granularity and stack order (`/to-issues` would normally quiz on
  these), and any design/UX call a slice would otherwise flag HITL. Say so at
  the start of the grill and walk those branches explicitly before closing.
- The invocation stops here only if the user disengages mid-grill or the
  grill surfaces a decision they must take away. Never fabricate a PRD from a
  bare tracker issue title — the grilling transcript + the tracker issue are
  the PRD inputs.

**Then `/to-prd` in pipeline mode.** `/to-prd` and `/to-issues` are
standalone-capable skills with their own user checks and "run the next
command" handoffs. Run as a stage of this skill, they operate in **pipeline
mode**: no seam confirmation, no approval prompt, no next-command pointer —
each decides from the grill transcript, records anything it had to assume
(`## Assumptions` in the PRD / slice body), and returns control here. `/to-prd`
creates the PRD ticket as a sub-issue of the feature ticket (or, with no seed
ticket, the feature ticket first, then the PRD ticket) — the feature ticket's
description and comments are never written. Record `<PRD-ISSUE>` in the
checkpoint. So: PRD ticket posted → **commit the planning docs (see below) and
run SLICE-SPLIT now**.

## Stage SLICE-SPLIT

Run **`/to-issues <PRD-ISSUE>`**, pipeline mode: it builds the code-layer
map, gathers the Figma design context (PRD Design section + the feature
ticket's links), splits into walking skeleton + behaviour deltas (≤1 novel
decision each, small reviewable PRs), creates the slices as sub-issues **of the
PRD ticket** stacked via `blockedBy`, stamps `<NEXT>` on the skeleton — and
**skips its user quiz**: it self-reviews the breakdown against its own
checklist and publishes. It stamps **no `<HITL>`** — a decision it cannot
settle from the PRD becomes an `## Assumptions` entry in that slice's body.

**The stack is linear, in stack order.** `gh stack` stacks are strictly linear
(one parent, one child per branch), and the deliverable is **one GitHub
stack**, so every slice's PR is based on the PR before it in the published
stack order (`/to-issues`' `NN` numbering) — `blockedBy` fan-out from the
code-layer map stays informative (it tells the reviewer which deltas are
independent) but never turns into parallel branches off the skeleton. The
relay works the slices one at a time in that order.

**Persist planning docs before leaving this stage — blocking, not optional.**
Grilling, `/to-prd`, and `/to-issues` write real files in this worktree:
`CONTEXT.md`, `docs/adr/**`, and `docs/agents/repo-config.md` (`goldenPaths`
write-backs). Run `git status --porcelain`, commit every one of them on the
current branch now (one commit whose subject follows the repo's commit rule —
`node "$engine" commit-rule --issue <ISSUE> --type docs --subject "planning docs"`
prints it) **and
push**: `git push -u origin <branch>`. The pushed branch is the relay's docs
reference, named in the checkpoint and in every slice's `## Cloud dispatch`
comment; the stack branches are cut from `<BASE>`, never from it. The tracker
(PRD + slice tickets) stays the contract the sessions build from. Repeat at
any stage exit that leaves new doc changes behind.

Then **fall through to SLICE-LOOP in this invocation** — starting the relay is
this skill's job, not a command to hand back to the user.

## Stage SLICE-LOOP — one pipeline workspace, a fresh session per PR

Resolve the venue once per pipeline and record it in the checkpoint:
**`cloud`** (default) is the relay below; **`local`** is
`references/local-loop.md`. Cloud needs a way to create sessions: the
Conductor MCP (`create_workspace` — always with `branch` = the snapshot's
`base`, see `references/cloud-relay.md`; `create_session`, `get_session_status`,
`list_messages`) from a local session, or the `conductor` CLI
(`/conductor/bin/conductor`, authenticated as you) inside a cloud sandbox —
`conductor session create --workspace <id> --agent <agent> [--model --effort]
--name <name> --message "<prompt>" --json`, `conductor session status <id>`,
`conductor session message <id>`. Neither reachable → say so once and fall
back to local. The mode choice never forks work: a slice carrying a
`## Cloud dispatch` comment stays cloud-owned even after a fallback — resume
its relay, never re-implement it here.

Slice state comes from durable markers, never memory: **merged PR** = done ·
**open PR + `babysit: GOAL MET`** on its `## Cloud dispatch` comment = reviewed,
the next layer may be cut on it · **open PR without that line** (or `NOT
MET`) = babysit owed to that PR first · **`## Cloud dispatch` comment** on
the ticket with no PR = a relay session claimed it (its session id is in the
comment) · none of those = not yet worked.

### From outside the pipeline workspace (planning / dispatching session)

Follow [cloud bootstrap and dispatch](references/cloud-relay.md): transfer
an immutable planning config, install every required runtime, start or adopt
the relay, confirm the worker session reaches working — then **stop**. One PR
per worker; workers start their own successors, so no caller stays behind to
watch them. A later invocation takes exactly one reconcile step (recover a
silent death, adopt a handoff, flush queued writes, read a terminal verdict).

### Tracker writes from the sandbox

Use the queue and flush protocol in [cloud-relay.md](references/cloud-relay.md).
Queued writes are durable in the workspace: the invocation that finds them
applies them and verifies the final QA handoff before DONE. Runtime tool access
is checked during bootstrap; a denied tracker write is never silently dropped.

### Inside the pipeline workspace (PR session)

Follow `references/pr-session.md` exactly: claim **one** slice — an open PR
still owed its babysit if there is one, else the earliest in stack order
without an open or merged PR — stamp its `## Cloud dispatch` marker with this
session's id, cut its branch with `gh stack` on top of the predecessor's, run
work-slice Steps 3–8 (fresh implementer and reviewers per its own spawn
ladder), i.e. open the draft PR, `gh stack link` it, then **babysit that PR
to its verdict** with `/babysit-stack <PR>` — CI green, `<BOT>` rounds,
`<COMMENT-BOT>` rounds, threads resolved, all on GitHub — and, on GOAL MET,
capture + publish this PR's visual evidence (Step 8). Stamp the verdict on
the `## Cloud dispatch` comment. **GOAL MET** → verify from durable markers,
then **start the next session** (`/feature-goal <ISSUE>`, same workspace,
next slice's agent) — or the babysit session when this was the last slice —
and **end**. **NOT MET** → Blocked: report the blockers, end **without**
starting a successor; the human acts on the PR and re-invokes, and the next
PR session resumes this slice's babysit before anything else. One PR per
session, always; the next PR is the next session's, and it is only ever cut
on a reviewed, green predecessor.

## Stage BABYSIT — a fresh session in the pipeline workspace

The stack's branches and babysit's cross-run state (`.context/babysit-…`) live
in the pipeline workspace, so it is the babysit home. Every PR was already
babysat to GOAL MET by its own PR session, so this leg is the **stack-wide
sweep**: it re-walks the whole stack bottom → top, catches anything that moved
since (a restack, a late bot round, a thread reopened by a human) and yields
the one verdict QA-HANDOFF keys on — usually short. The babysit session is
the last relay leg: the final PR session starts it with the `babysitter` model
role and explicit handoff in `references/cloud-relay.md` (a session outside the
workspace that finds stage BABYSIT with no babysit session recorded starts it
the same way). Inside the pipeline
workspace at stage BABYSIT: run **`/babysit-stack <PRD-ISSUE>`** (the PRD
ticket — its sub-issues are the slices) here, now, in this session — it is
fresh, and this is its one job. Local mode runs `/babysit-stack <PRD-ISSUE>`
in this worktree instead (reference).

Babysit is a babysitting mode, not a pass: per PR, bottom → top, it gets CI
green, runs `<BOT>` rounds until satisfied, then `<COMMENT-BOT>` rounds until
satisfied, resolves every thread, restacks after fixes (`gh stack sync
--remote origin` — the local stack tracking is in this workspace), and
**waits for each bot round itself** with bounded polls. Its fixers are fresh
agents per its own rules. It returns with a terminal verdict:

- **GOAL MET** → go to stage QA-HANDOFF below (in this session), then
  report the stack (PRs, verdict table, the assumptions recorded along the
  way — those stay in the report and on the PRs, never on the feature
  ticket), set
  the checkpoint stage to DONE, and stop.
- **NOT MET** → by construction nothing actionable is left: only
  `needs-human` threads, stuck CI, or a capped fix signature remain. That
  is **Blocked**: record the verdict, report the blockers verbatim as the
  stop reason, end with the resume line. The human resolves them (or
  answers on the PR), then re-invokes; the next invocation starts a fresh
  babysit session in the same home — its state file carries the caps.

From outside the pipeline workspace, take one reconcile step on the babysit
session under `references/cloud-relay.md` and end: a working session is left
alone with its deep link reported; an unexplained idle session gets one recovery
in the same workspace. Explicit NOT MET is a blocker; GOAL MET still requires
current-head evidence, correct PR issue links, the published QA handoff and
verified final tracker statuses.

## Stage QA-HANDOFF — the feature ticket's one comment for QA

The feature ticket `<ISSUE>` belongs to humans — PM, designers, and now
**QA**, who has no code access. Besides claim/status fields and labels, the suite writes one comment on it —
a `## QA handoff` comment per `../work-slice/references/qa-handoff.md` — and
nothing else, ever: no PRD, no assumptions, verification tables, provenance,
dispatch markers or progress notes (those live on the PRD ticket, the slice
tickets and the PR bodies). It is written **only now**, after GOAL MET — a
handoff written earlier goes stale on the next bot round. Never post the
handoff on the PRD ticket. Compose it in the session that
read GOAL MET:

1. **Criteria.** The feature ticket's own `- [ ]` criteria verbatim when user-facing;
   otherwise one user-facing criterion per PRD User Story the stack delivered
   (rewrite technical wording into what the user experiences).
2. **Evidence — current verified head.** Compare each PR's media manifest `sourceHead` with its live head after the stack-wide babysit. For every missing required manifest or mismatch, check out that PR's owning branch and run work-slice Step 8 after its fresh GOAL MET verdict, then update its existing body block. Reuse matching media; the QA handoff embeds these same files. Fetch the stack's media from `<MEDIA-BRANCH>`:
   `git fetch origin <MEDIA-BRANCH>`, then for every stack PR read
   `git show origin/<MEDIA-BRANCH>:pr/<n>/media.json` and extract the files
   named there (`git show … > <file>`) — `criteria` in each scene says which
   ACs it covers. Group criteria under the scene that proves them: one video
   *or* one still per group, never both of the same thing, as few as prove the
   feature (1–3 in total). **Embed inline, never attach:** upload the file
   (Linear: `prepare_attachment_upload` → PUT) and put the returned **asset
   URL** straight into the comment markdown — **never**
   `create_attachment_from_upload`, which files it as a downloadable resource
   instead of showing it. Video as inlineable `.mp4`, else fall back to a
   still, never a download link. Never a GitHub raw URL on the tracker. A
   criterion no scene covers says so in one short line.
3. **Steps + expected result** — the test plan — in the ticket's language, user terms only —
   navigation by what the screen shows, roles by what QA sees in the test
   environment, no routes, no code, no PR jargon. Only what a designer or PM
   can do and see in the product's own screens; criteria a non-technical person
   cannot test are left out without comment — the automated tests prove them
   and no human is involved. Nothing testable that way → the one-sentence
   *No QA needed* form (`qa-handoff.md` → *Who tests it*), which skips 5.
4. **Not working yet** for anything a slice shipped as a failed criterion
   (its `## QA evidence` on the slice ticket names it), in user terms.
5. **Walk the plan yourself** before anyone reads it (`qa-handoff.md` → *Walk
   it yourself*): check out the **top branch of the stack** (clean tree, head =
   the pushed head the stack-wide babysit verified), start the app per
   `../work-slice/references/run-app.md`, and perform every step literally in
   a throwaway Playwright spec — one `test.step` per plan step, locators only
   from the words the plan quotes, no routes or code-derived selectors after
   sign-in, every Expected asserted on screen. It records no media (the
   handoff embeds the PR captures from 2). A step that cannot be done as
   written → fix the plan and walk that walk-through again; an Expected the
   screen does not show → a real regression: Blocked, report it, post
   nothing. Record `.context/<ISSUE>/evidence/qa-walk.json` with the walked
   `sourceHead` of the top branch, then delete the spec. The app cannot run
   in this workspace → do not post a plan with steps: end Blocked at
   QA-HANDOFF naming the reason.
6. **Cold read**: one fresh cold reader playing a designer reads the walked
   draft; rewrite or drop everything it flags (`qa-handoff.md` → *Read it
   back*). A rewrite that changes what QA does or should see is walked again.
7. The stack's PR links on one line at the bottom, then post the comment —
   **idempotent by edit**: find an existing `## QA handoff` and update it **by
   id**, never a second comment and never a "v2 supersedes the above". Keep the
   whole thing under ~150 words of prose: no tables, no test counts, no capture
   method, no sha's. Under `Tracker writes: planning` the babysit session **stages** it
   (`.context/<ISSUE>/tracker-writes-pending/`) together with item 8's final
   status payloads, then ends at QA-HANDOFF, not DONE; the next invocation flushes the queue,
   posts it, then completes the tracker finalization below. A staged handoff
   is published only while its `qa-walk.json` `sourceHead` still matches the
   top of the stack; otherwise walk again first.
8. **Finalize the tracker** per `issue-lifecycle.md`: verify every PR references
   the human parent and its own generated slice (plus PRD), move all owned
   generated descendants to `<DONE>` including the PRD, then move the feature
   parent to `<IN-REVIEW>`. Read every effect back. Checkpoint DONE only after
   these effects and the handoff are verified; queued/failed writes remain
   QA-HANDOFF (`tracker-pending`), even when all PRs are green.

Local mode does the same in this worktree. A worker that died before media
publication resumes Step 8; missing evidence is not silently waived. If capture
is unavailable for a concrete reason, record that reason against the current
head and use the reference's one-line form. Otherwise finish capture before QA.

## Boundaries

- Everything the constituent skills forbid stays forbidden: **never merge,
  approve, or mark a PR ready; never mark the human parent done; never run compliance.**
  Terminal state = green, bot-satisfied, thread-resolved **draft** PRs —
  promoting and merging stay the human's calls.
- **The grill is the only human gate.** It is launched but never simulated:
  this skill runs `/grill-with-docs` inline and lets the human answer, never
  invents the answers or writes a PRD without one (absent an explicit user
  instruction to derive it from stated context). After the grill, no prompt,
  approval, quiz or confirmation is ever put to the human; an undecided point
  becomes a recorded assumption, never a stop.
- **`<HITL>` is informational, not a gate.** Pipeline-mode `/to-issues` never
  stamps it; a label found anyway (hand-stamped, or a stack sliced
  standalone) means "make and record the assumption", never "wait".
- **One PR per session.** A relay session claims one slice, takes it to a
  linked draft PR, babysits **that PR** to its verdict, starts the next
  session and ends. It never picks up the next slice "while it's here",
  never babysits another PR, and never waits for the session it started.
  The planning session never works a slice; the babysit session never works
  a slice. A nudge-free design: a dead session is replaced by a fresh one,
  never continued.
- **One pipeline workspace per stack.** All stack branches live in it, so
  `gh stack` has local tracking, babysit has one home, and every session sees
  the checkpoints of the sessions before it. Workspaces come only from the
  Conductor MCP / CLI or the hand-off — never faked with `git worktree add`.
  A slice's `## Cloud dispatch` comment is authoritative over any local
  checkpoint.
- **Development leaves the planning session.** Outside the pipeline workspace
  this skill only plans, starts / resumes / checks relay sessions and reads
  verdicts — it never implements, fixes, reviews or babysits code in cloud
  mode.
- **Every layer is cut on a reviewed PR.** A slice's branch is created only
  when its predecessor's PR reads `babysit: GOAL MET` — CI green, every
  configured review bot satisfied, every thread resolved. Bot findings are
  fixed in the PR that caused them, never inherited by the layer above. A
  NOT MET PR is Blocked, not a base.
- **Stacking is `gh stack`, one linear stack, in stack order.** Branches are
  cut with `gh stack init` / `gh stack add` on top of the predecessor, the PR
  is opened by the repo's PR skill, then `gh stack link` by PR number adopts
  it. Never `gh stack submit` (auto-titled PRs), never `gh stack link --open`
  (un-drafts), never a parallel branch off the skeleton. No `pr.stackTool` →
  plain branches, every PR targets `<BASE>`, nothing is linked.
- **Routing is honoured:** a `<AGENT:><name>` slice gets a session running
  that agent (Conductor sessions in one workspace may run different agents).
  Dispatched work is verified from durable markers (marker comment, remote
  branch, PR state), never a session status alone.
- Label writes stay additive (Linear's `save_issue.labels` replaces the whole
  set); `<NEXT>` has exactly one carrier; never stamp `labels.agentReady`.
- Re-entry safe: every invocation re-runs stage detection; never redo a stage
  whose artifacts exist (PRD ticket, slice sub-issues, dispatch markers, open PRs)
  — repair forward. Durable markers always win over the checkpoint file.
- **Persistence is re-invocation, never a stop-hook.** A run ends only at the
  grilling gate, relay dispatched, baton passed, Blocked, or DONE — always with
  the resume line. Never spin-poll sessions inside one invocation: from outside
  the pipeline workspace the only polling allowed is the bounded three-minute
  start confirmation (and the same bound on bootstrap), after which the run ends
  whatever the cloud is doing.

## Workflow Boundaries

**This skill orchestrates the feature pipeline as a re-entrant stage machine with the grill as its only human gate — planning here, then a relay of one-PR sessions in one cloud workspace (each babysitting its own PR to GOAL MET before the next is cut), then a stack-wide babysit session — sequencing the constituent skills, never re-implementing them.**

- **DOES**: run the grill inline (the one gate) and make it cover every downstream decision; run `/to-prd` (PRD ticket under the feature ticket) and `/to-issues` (slices under the PRD ticket) in pipeline mode (no user checks, no next-command handoffs) and commit + push the planning docs they write; create or adopt the pipeline workspace (bootstrap plugin + gh-stack) and start PR session 1; as a PR session, claim one slice, cut its `gh stack` branch, run work-slice Steps 3–8 (link the PR, babysit it to GOAL MET, capture + publish its evidence, stamp the verdict on its dispatch comment), start the next session, end; as the babysit session, run the stack-wide `/babysit-stack` to its verdict, draft the QA test plan, walk it literally on the top of the stack, post the QA handoff and finalize tracker statuses; from outside, start / reconcile the relay in one step and stop; keep `.context/<ISSUE>/pipeline-state.md`; end every run with the resume line.
- **DOES NOT**: answer the grill for the human, ask the human anything after the grill, write anything but claim/status fields, labels and the one `## QA handoff` on the feature ticket, treat `<HITL>` as a stop, work more than one PR in a worker session, implement / fix / review / babysit code outside the pipeline workspace (cloud mode), own review-loop internals (the engine CLI does) or CI/bot/thread mechanics (`/babysit-stack` does), merge/approve/mark ready/mark the human parent done, or relocate the venue-neutral standalone commands (`/work-issue` and `/daily-ticket-manager` run wherever the user starts them; `/solve-ready-tickets` does its own fan-out and is none of this skill's business).

## Red Flags — STOP

- About to reuse media whose `sourceHead` differs from the PR head — stop: run Step 8 on the owning branch after current-head GOAL MET and replace the stale block before QA-HANDOFF.
- About to post (or stage) the feature ticket's QA handoff with steps nobody here has walked — stop: walk the plan literally on the top of the stack first (QA-HANDOFF item 5); the app cannot run here → Blocked with the reason, not an unwalked plan.
- About to start the next session while this PR's babysit is not GOAL MET (bot round pending, thread open, verdict NOT MET) — stop: babysit waits for the bots itself; NOT MET is Blocked, not a baton pass.
- About to cut a slice's branch on a predecessor whose `## Cloud dispatch` lacks `babysit: GOAL MET` — stop: resume that slice's Step 7 first.
- About to implement from the planning caller — stop: a PR worker owns implementation; the caller dispatches, reconciles and flushes tracker writes.
- About to poll, watch or sit on a running cloud session from outside the pipeline workspace — stop: confirm it is working, report the deep link, end the run. The relay starts its own successors; a local process waiting on it is the failure this design exists to prevent.
- About to send `/feature-goal` into a **fresh** cloud workspace whose plugin was never installed — stop: the sandbox has no plugin and skills load only at session start; bootstrap session (or inline install in the handed-off workspace) first.
- About to paste slice instructions inline into a cloud session because bootstrap failed — stop: a failed bootstrap is Blocked (deep link + reason), not a workaround invitation.

## Verification

Before reporting done:

- [ ] Parent claim was applied at entry (or immediately after creation):
  assignee/run owner recorded, `<IN-PROGRESS>`, `labels.agentReady` removed.
- [ ] Every PR body links the human parent and its own generated slice/PRD;
  full recursive inventory verified, all owned generated descendants `<DONE>`,
  parent `<IN-REVIEW>`, and no tracker write pending. Re-entry repaired only
  missing effects and did not reset completed claims or close human children.
- [ ] `.context/<ISSUE>/pipeline-state.md` rewritten to the current stage, dispatch mode, feature + PRD ticket ids, docs branch, pipeline workspace, slice cursor, relay session, resumes, assumptions, per-PR babysit verdicts, and the stack babysit verdict.
- [ ] The reported stage matches live markers (`PRD:` sub-issue of the feature ticket, slice sub-issues of the PRD ticket, `## Cloud dispatch` comments, `gh pr list --state all`) — not conversation memory or the checkpoint alone.
- [ ] After the grill, the human was asked nothing: `/to-prd` and `/to-issues` ran in pipeline mode; every assumption made downstream is recorded on its ticket/PR and listed in the report.
- [ ] Planning docs (`CONTEXT.md`, `docs/adr/**`, `docs/agents/**`) were committed **and pushed** before the relay started; `git status --porcelain` shows none left over; the docs branch is in the checkpoint and every dispatch comment.
- [ ] Cloud mode: the run ended as soon as the relay was confirmed working — no invocation waited on, polled or babysat a cloud session from outside beyond the bounded start confirmation. The checkpoint records `Tracker writes: sandbox | planning` from the bootstrap probe; under `planning`, every denied tracker write is a staged file that an outside invocation flushed (no marker silently dropped). Exactly one pipeline workspace for the stack, created with `branch` = the snapshot's `base` (or handed off); every worked slice's ticket carries exactly one `## Cloud dispatch` comment (workspace deep link, the session that worked it, docs branch); this session worked at most one PR and, if it did, started exactly one successor session before ending.
- [ ] Every completed slice has a draft PR verified from durable markers (remote branch, `gh pr view`: draft, base = predecessor's branch), `gh stack view --json` shows the chain bottom → top, and `<NEXT>` has exactly one carrier or the report names why none does (stack complete).
- [ ] Every PR a session opened was babysat to a terminal verdict in that same session before any successor was started; `babysit: GOAL MET` is stamped on its slice's `## Cloud dispatch` comment (local: slice checkpoint `COMPLETE`); no slice branch was cut on a predecessor short of that.
- [ ] The stack-wide babysit ran as its own fresh session in the pipeline workspace; its verdict was read from the transcript plus live PR state, never assumed.
- [ ] The run did not end by handing the user `/to-prd`, `/to-issues`, `/work-slice`, or `/babysit-stack`: the only next command a report ever names is `/feature-goal <ISSUE>`.
- [ ] The report ends with the resume line: stage, blocking reason if any, and `/feature-goal <ISSUE>`.
- [ ] Stage DONE claimed only when the `/babysit-stack` verdict reads GOAL MET **and** the feature ticket carries its one `## QA handoff` comment — steps only for what a designer or PM can test in the product's screens (or the one-sentence *No QA needed* form), **every step walked by us as written on the top of the stack at its current head** (`qa-walk.json`), cold-read as a designer, one visual artifact per criteria group fetched from `<MEDIA-BRANCH>` (captured by each PR session after its own GOAL MET, recaptured through Step 8 when the head changed), no dev material — and no other suite comment on it; the PRD and its deltas sit on the PRD ticket.

Every cloud worker exit emits the terminal relay marker from
`references/cloud-relay.md`. QA-HANDOFF with queued publication emits
`tracker-pending`; it is not DONE until an invocation verifies publication.
