---
name: feature-goal
description: >
  Run the feature pipeline end-to-end as a re-entrant stage machine with
  exactly ONE human gate — the grilling session. Planning happens here with the
  user: grill → PRD (/to-prd) → sliced PR stack (/to-issues). Everything after
  that runs in ONE Conductor cloud workspace as a RELAY of fresh sessions: each
  PR gets its own session, which opens the stacked draft PR (gh-stack),
  babysits it to GOAL MET (CI, Copilot, CodeRabbit, threads) so the next layer
  is cut on a reviewed PR, starts the next session and ends. The last PR
  session starts the stack-wide babysit session ending in GOAL MET + QA
  handoff. Nothing after the grill asks the user anything. Opt-in `local` runs
  the loop in this worktree, a fresh subagent per slice. Every invocation
  re-detects the stage from durable markers — run it again to resume. Use when
  I say "run the feature pipeline", "take this ticket to a green stack",
  "resume the feature pipeline", "/feature-goal", or after a grill when I want
  the feature driven to green, stacked PRs.
argument-hint: "[parent issue id] [local]"
---

# Feature Goal

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
walks away. The planning session only plans, dispatches and reports.

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
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123` for GitHub Issues) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | leave the status untouched |
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
| `<CLOUD-MODEL>` | `routing.cloudModels` — `{model, effort}` per session agent | claude → `opus-5-1m`/`xhigh`, codex → `gpt-5.6-sol`/`xhigh`; agent key `{}` → omit both, Conductor's default |

Also read the prose docs the config points at when they exist:
`tracker.docPath`, `labels.docPath`, and `docs/agents/README.md`.
The per-PR session's own procedure (branching with `gh stack`, running
work-slice, linking the PR, passing the baton) is `references/pr-session.md`
— read it when this session **is** a PR session (see "Which session am I?").
Local mode (`<DISPATCH>` = `local`, the user says `local`, or neither the
Conductor MCP nor the `conductor` CLI is reachable) is documented in
`references/local-loop.md` — read it only when that mode is active.

## Persistence — run again to resume

One invocation advances the pipeline as far as it can, then ends with a report.
A run ends at exactly four kinds of boundary:

- **The grilling gate** — the user disengaged mid-grill or the grill surfaced a
  decision they must take away. Name what they must decide; they act, then
  re-invoke. This is the **only** point where the pipeline waits on the human
  for input.
- **Baton passed** — this session started the next session of the relay (the
  first PR session, the next PR session, or the babysit session). Report what
  was done and the session it started, and end. Never wait for, poll, or
  message the session you started — its work is the next invocation's.
- **Blocked** — nothing actionable remains but the goal isn't met: a PR
  session's babysit of its own PR, or the stack-wide babysit, ended NOT MET
  with only `needs-human` items (judgement-call threads, a stuck bot, an
  exhausted fix cap), a slice's loop hard-stopped (gut-check block), a
  bootstrap failed, or a relay session died twice on the same slice. Report
  each blocker plainly as the stop reason; the human unblocks, then
  re-invokes.
- **Done** — the babysit verdict reads GOAL MET and the QA handoff is posted.

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
- Parent: PROJ-1200
- Docs branch: <pushed planning-docs branch>
- Pipeline workspace: (none | <workspace deep link> / <workspace id>)
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
With the parent issue id `<ISSUE>` (from the argument or the conversation; if
there is no parent ticket yet, that's stage 0/1):

1. **No parent ticket / no `# PRD` comment on it** → stage GRILL / PRD.
2. **PRD comment exists, no sub-issues** → stage SLICE-SPLIT.
3. **Sub-issues exist, at least one slice with neither an open nor a merged
   PR** → stage SLICE-LOOP. Check PRs with `gh pr list --state all` — a
   **merged** PR means that slice is done; never re-detect it as needing the
   slice loop. Within SLICE-LOOP the first thing owed is any **open PR not
   yet babysat to GOAL MET** (its slice's `## Cloud dispatch` comment lacks
   `babysit: GOAL MET`; local: slice checkpoint not `COMPLETE`) — the PR
   session resumes that slice's Step 7 before claiming the next slice.
4. **Every slice has an open or merged PR** → stage BABYSIT (merged slices
   impose no babysit work). An open PR still short of `babysit: GOAL MET` is
   handled by the stack-wide babysit here, not by another PR session.
5. **Stack-wide `/babysit-stack` verdict = GOAL MET, parent has no
   `## QA handoff` comment** → stage QA-HANDOFF.
6. **`## QA handoff` comment on the parent** → done; report and stop.

### Which session am I? (cloud mode, stages SLICE-LOOP / BABYSIT)

The relay only works if each session knows its role. Decide it from where you
run, never from the conversation:

- **In the pipeline workspace** — a Conductor cloud sandbox
  (`/conductor/bin/conductor` exists) whose workspace id (`conductor workspace
  get --json`) matches the checkpoint's `Pipeline workspace`, or the
  `## Cloud dispatch` markers on the slices, or no pipeline workspace is
  recorded anywhere yet (then this one becomes it — the grilling session was
  handed off here). → You are a **relay session**: SLICE-LOOP makes you a
  **PR session** (`references/pr-session.md`), BABYSIT makes you the
  **babysit session** (stage BABYSIT below).
- **Anywhere else** (a local worktree, a different cloud workspace) → you are
  a **planning / monitoring session**: you never work a slice or babysit in
  cloud mode. You start, resume or check the relay (SLICE-LOOP "From outside
  the pipeline workspace" below) and end.

## Stage GRILL / PRD — the one human gate

The grilling session is the one input this skill will not manufacture:

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
(`## Assumptions` in the PRD comment / slice body), and returns control here.
So: PRD comment posted → **commit the planning docs (see below) and run
SLICE-SPLIT now**.

## Stage SLICE-SPLIT

Run **`/to-issues`** on the parent, pipeline mode: it builds the code-layer
map, gathers the Figma design context, splits into walking skeleton +
behaviour deltas (≤1 novel decision each, small reviewable PRs), creates the
sub-issues stacked via `blockedBy`, stamps `<NEXT>` on the skeleton — and
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
current branch now (one commit, e.g. `docs: <ISSUE> planning docs`) **and
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
Conductor MCP (`create_workspace`, `create_session`, `get_session_status`,
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

### From outside the pipeline workspace (planning / monitoring session)

You start or resume the relay and end. One invocation does exactly one of:

1. **No pipeline workspace yet** → create it and start the relay:
   - **Already in a cloud sandbox** (the grilling session was handed off to a
     cloud workspace): this workspace **is** the pipeline workspace. Make the
     plugin available to the sessions that follow — the sandbox is fresh and
     skills load only at session start: run the install for your own CLI
     (Claude Code: `claude plugin marketplace add magnuskeinicke/agent-plugins
     && claude plugin install magnus@magnus-skills`, verify with `claude plugin
     list`; Codex: `codex plugin marketplace add
     https://github.com/magnuskeinicke/agent-plugins.git && codex plugin add
     magnus@magnus-skills`) and install `gh-stack` (`gh extension install
     github/gh-stack`). Install failure → **Blocked** (usual cause: the
     sandbox's GitHub token can't read the private plugin repo).
   - **Local session**: **`create_workspace`** — one cloud workspace on this
     repo's project, named `<ISSUE> stack`, branch `<BASE>`, agent = the
     skeleton's `<AGENT:>` label when present else this runtime's agent,
     `<CLOUD-MODEL>` as `model` + `effort`. Its first session is the
     **bootstrap session** — prompt, verbatim:

     > Bootstrap this workspace: install the agent plugin for your own CLI and
     > the gh-stack extension, verify, and reply with exactly `BOOTSTRAP OK` or
     > `BOOTSTRAP FAILED: <reason>` — change nothing else in the repo.
     > Claude Code: `claude plugin marketplace add magnuskeinicke/agent-plugins
     > && claude plugin install magnus@magnus-skills`, verify with
     > `claude plugin list`. Codex: `codex plugin marketplace add
     > https://github.com/magnuskeinicke/agent-plugins.git &&
     > codex plugin add magnus@magnus-skills`. Both:
     > `gh extension install github/gh-stack`.

     Wait for it to go idle — the **one bounded in-dispatch wait** (a few
     status checks over ~3 minutes; an install is seconds, not a slice) and
     read its last message. `BOOTSTRAP FAILED`, or not idle → **Blocked**
     with the deep link + reason; never paste slice instructions inline or
     implement the slice here.
   - Then **start PR session 1** in the pipeline workspace: `create_session`
     / `conductor session create`, agent = the skeleton's `<AGENT:>` label
     else this runtime's agent, `<CLOUD-MODEL>`, name `01-<skeleton-id>`,
     prompt exactly **`/feature-goal <ISSUE>`** — the session re-detects the
     stage, finds itself in the pipeline workspace and becomes the PR session
     (`references/pr-session.md`). Record workspace + session in the
     checkpoint (`Pipeline workspace`, `Relay`). **Baton passed** — end.
2. **Pipeline workspace exists** → read the newest `## Cloud dispatch` marker
   (or the checkpoint's `Relay` line) and check that session **once**
   (`get_session_status` / `conductor session status`):
   - `working` → the relay is alive. Report the slice table (slice → status →
     PR) and end.
   - `idle`, and its slice now has a PR (or babysit's verdict is on record) →
     it finished but its successor never started (spawn failed, or a
     hand-run resume): **start the next relay session** yourself — same
     workspace, prompt `/feature-goal <ISSUE>`, agent from the next slice's
     `<AGENT:>` label — and end.
   - `idle`, no new markers since it started → it died mid-slice. Start one
     fresh session in the pipeline workspace with `/feature-goal <ISSUE>`
     (work-slice is re-entrant; the checkpoint under `.context/<slice-id>/`
     is in that workspace); note it under `Resumed`. A slice already resumed
     once with no new markers since → **Blocked**, with the deep link.

Never spin-poll a session, and never work a slice from outside the pipeline
workspace in cloud mode.

### Inside the pipeline workspace (PR session)

Follow `references/pr-session.md` exactly: claim **one** slice — an open PR
still owed its babysit if there is one, else the earliest in stack order
without an open or merged PR — stamp its `## Cloud dispatch` marker with this
session's id, cut its branch with `gh stack` on top of the predecessor's, run
work-slice Steps 3–7 (fresh implementer and reviewers per its own spawn
ladder), i.e. open the draft PR, `gh stack link` it, then **babysit that PR
to its verdict** with `/babysit-stack <PR>` — CI green, `<BOT>` rounds,
`<COMMENT-BOT>` rounds, threads resolved, all on GitHub. Stamp the verdict on
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
the last relay leg: the final PR session starts it with `/feature-goal
<ISSUE>` (a session outside the workspace that finds stage BABYSIT with no
babysit session recorded starts it the same way). Inside the pipeline
workspace at stage BABYSIT: run **`/babysit-stack <ISSUE>`** here, now, in
this session — it is fresh, and this is its one job. Local mode runs
`/babysit-stack <ISSUE>` in this worktree instead (reference).

Babysit is a babysitting mode, not a pass: per PR, bottom → top, it gets CI
green, runs `<BOT>` rounds until satisfied, then `<COMMENT-BOT>` rounds until
satisfied, resolves every thread, restacks after fixes (`gh stack sync
--remote origin` — the local stack tracking is in this workspace), and
**waits for each bot round itself** with bounded polls. Its fixers are fresh
agents per its own rules. It returns with a terminal verdict:

- **GOAL MET** → go to stage QA-HANDOFF below (in this session), then
  report the stack (PRs, verdict table, the assumptions recorded along the
  way — those stay in the report and on the PRs, never on the parent), set
  the checkpoint stage to DONE, and stop.
- **NOT MET** → by construction nothing actionable is left: only
  `needs-human` threads, a stuck bot, or a capped fix signature remain. That
  is **Blocked**: record the verdict, report the blockers verbatim as the
  stop reason, end with the resume line. The human resolves them (or
  answers on the PR), then re-invokes; the next invocation starts a fresh
  babysit session in the same home — its state file carries the caps.

From outside the pipeline workspace: babysit session `working` → report and
end; `idle` with a verdict in its transcript → act on it as above (QA handoff
can be composed from anywhere); `idle` with no verdict (died) → start one
fresh babysit session (babysit is re-entrant); a second silent death is
Blocked. Never start a second babysit session on an unchanged NOT MET state —
it waited already; only a human changes what it would find.

## Stage QA-HANDOFF — the parent ticket's one comment for QA

The parent ticket has two readers: the user + AI (grill, `# PRD`) and then
**QA**, who has no code access. The suite writes exactly one thing for QA on
it — a `## QA handoff` comment per
`../work-slice/references/qa-handoff.md` — and nothing else: no assumptions,
verification tables, provenance or dispatch markers (those live on the slice
tickets and the PRs). Compose it in the session that read GOAL MET:

1. **Criteria.** The parent's own `- [ ]` criteria verbatim when user-facing;
   otherwise one user-facing criterion per PRD User Story the stack delivered
   (rewrite technical wording into what the user experiences).
2. **Evidence.** Fetch the stack's media from `<MEDIA-BRANCH>`:
   `git fetch origin <MEDIA-BRANCH>`, then for every stack PR read
   `git show origin/<MEDIA-BRANCH>:pr/<n>/media.json` and extract the files
   named there (`git show … > <file>`) — `criteria` in each scene says which
   ACs it covers. Group criteria under the scene that proves them: one video
   *or* one still per group, never both of the same thing, as few as prove the
   feature. Upload with the tracker's attachment flow and embed. A criterion no
   scene covers says so in its evidence line. Never a GitHub raw URL on the
   tracker.
3. **Steps + expected result** in the ticket's language, user terms only —
   navigation by what the screen shows, roles by what QA sees in the test
   environment, no routes-first, no code, no PR jargon.
4. **Not working yet** for anything a slice shipped as a failed criterion
   (its `## QA evidence` on the slice ticket names it), in user terms.
5. One `Engineering reference:` line with the stack's PR links, then post the
   comment (idempotent — update an existing `## QA handoff`). Checkpoint stage
   DONE only after it is on the parent.

Local mode does the same from this worktree. A session that died before
publishing media leaves a criterion without evidence — write that down in the
handoff rather than substituting a Storybook or design image.

## Boundaries

- Everything the constituent skills forbid stays forbidden: **never merge,
  approve, or mark a PR ready; never mark issues done; never run compliance.**
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
  whose artifacts exist (PRD comment, sub-issues, dispatch markers, open PRs)
  — repair forward. Durable markers always win over the checkpoint file.
- **Persistence is re-invocation, never a stop-hook.** A run ends only at the
  grilling gate, baton passed, Blocked, or DONE — always with the resume
  line. Never spin-poll sessions inside one invocation.

## Workflow Boundaries

**This skill orchestrates the feature pipeline as a re-entrant stage machine with the grill as its only human gate — planning here, then a relay of one-PR sessions in one cloud workspace (each babysitting its own PR to GOAL MET before the next is cut), then a stack-wide babysit session — sequencing the constituent skills, never re-implementing them.**

- **DOES**: run the grill inline (the one gate) and make it cover every downstream decision; run `/to-prd` and `/to-issues` in pipeline mode (no user checks, no next-command handoffs) and commit + push the planning docs they write; create or adopt the pipeline workspace (bootstrap plugin + gh-stack) and start PR session 1; as a PR session, claim one slice, cut its `gh stack` branch, run work-slice Steps 3–7 (link the PR, babysit it to GOAL MET, stamp the verdict on its dispatch comment), start the next session, end; as the babysit session, run the stack-wide `/babysit-stack` to its verdict and post the QA handoff; from outside, check / resume the relay; keep `.context/<ISSUE>/pipeline-state.md`; end every run with the resume line.
- **DOES NOT**: answer the grill for the human, ask the human anything after the grill, treat `<HITL>` as a stop, work more than one PR in a session, wait for a session it started, implement / fix / review / babysit code outside the pipeline workspace (cloud mode), own review-loop internals (the engine CLI does) or CI/bot/thread mechanics (`/babysit-stack` does), merge/approve/mark ready/mark issues done, or relocate the venue-neutral standalone commands (`/work-issue`, `/solve-ready-tickets`, `/daily-ticket-manager` run wherever the user starts them).

## Red Flags — STOP

- About to fabricate a PRD from a bare ticket title with no grilling session in the conversation — stop: run `/grill-with-docs` inline and grill the user for real; end only if they disengage.
- About to ask the human to approve the PRD, the slice breakdown, the test seams, a PR, or "whether to continue" — stop: the grill was the gate; decide, record the assumption, proceed.
- About to stop on a `<HITL>` slice or a "needs a human decision" line — stop: work it; the PR session makes and records the assumption.
- About to end the invocation because `/to-prd` said "run `/to-issues`" or `/to-issues` said "run `/work-slice`" — stop: pipeline mode supersedes those; the only command a report ever hands the user is `/feature-goal <ISSUE>`.
- About to report `/work-slice` or `/babysit-stack` as the user's next step — stop: they run *inside* the relay sessions; start those instead.
- About to start the next slice in the session that just opened a PR — stop: one PR per session; start a fresh session with `/feature-goal <ISSUE>` and end.
- About to start the next session while this PR's babysit is not GOAL MET (bot round pending, thread open, verdict NOT MET) — stop: babysit waits for the bots itself; NOT MET is Blocked, not a baton pass.
- About to cut a slice's branch on a predecessor whose `## Cloud dispatch` lacks `babysit: GOAL MET` — stop: resume that slice's Step 7 first.
- About to keep the planning session (or a handed-off grilling session) alive as the worker for the whole stack — stop: bootstrap, start PR session 1, end.
- About to implement, fix, review or babysit a slice from outside the pipeline workspace in cloud mode — stop: development left this session; start / resume / check relay sessions, read verdicts.
- About to wait for, poll or message the session you just started — stop: baton passed; end with the resume line.
- About to send `/feature-goal` into a **fresh** cloud workspace whose plugin was never installed — stop: the sandbox has no plugin and skills load only at session start; bootstrap session (or inline install in the handed-off workspace) first.
- About to paste slice instructions inline into a cloud session because bootstrap failed — stop: a failed bootstrap is Blocked (deep link + reason), not a workaround invitation.
- About to `create_workspace` for a slice, or a second workspace for a stack that has one — stop: one pipeline workspace per stack; slices are sessions in it.
- About to branch a delta off the skeleton while a later-numbered slice already stacks there, or to work two slices in parallel — stop: one linear stack in stack order, one slice at a time.
- About to work a slice whose predecessor has no open/merged PR — stop: the stack is built bottom → top.
- About to run `gh stack submit`, `gh stack link --open`, or `gh stack link` by branch name — stop: submit opens auto-titled PRs, `--open` un-drafts, a branch name can duplicate the PR skill's PR.
- About to start another babysit session on an unchanged NOT MET state — stop: NOT MET is Blocked — report and end.
- About to redo a stage whose artifacts exist (PRD comment, sub-issues, dispatch markers, open PRs) — stop: repair forward from stage detection.
- About to dispatch with `CONTEXT.md`, `docs/adr/**`, or `docs/agents/**` uncommitted or unpushed — stop: commit and push; the docs branch is the relay's reference.

## Verification

Before reporting done:

- [ ] `.context/<ISSUE>/pipeline-state.md` rewritten to the current stage, dispatch mode, docs branch, pipeline workspace, slice cursor, relay session, resumes, assumptions, per-PR babysit verdicts, and the stack babysit verdict.
- [ ] The reported stage matches live markers (`# PRD` comment, sub-issues, `## Cloud dispatch` comments, `gh pr list --state all`) — not conversation memory or the checkpoint alone.
- [ ] After the grill, the human was asked nothing: `/to-prd` and `/to-issues` ran in pipeline mode; every assumption made downstream is recorded on its ticket/PR and listed in the report.
- [ ] Planning docs (`CONTEXT.md`, `docs/adr/**`, `docs/agents/**`) were committed **and pushed** before the relay started; `git status --porcelain` shows none left over; the docs branch is in the checkpoint and every dispatch comment.
- [ ] Cloud mode: exactly one pipeline workspace for the stack; every worked slice's ticket carries exactly one `## Cloud dispatch` comment (workspace deep link, the session that worked it, docs branch); this session worked at most one PR and, if it did, started exactly one successor session before ending.
- [ ] Every completed slice has a draft PR verified from durable markers (remote branch, `gh pr view`: draft, base = predecessor's branch), `gh stack view --json` shows the chain bottom → top, and `<NEXT>` has exactly one carrier or the report names why none does (stack complete).
- [ ] Every PR a session opened was babysat to a terminal verdict in that same session before any successor was started; `babysit: GOAL MET` is stamped on its slice's `## Cloud dispatch` comment (local: slice checkpoint `COMPLETE`); no slice branch was cut on a predecessor short of that.
- [ ] The stack-wide babysit ran as its own fresh session in the pipeline workspace; its verdict was read from the transcript plus live PR state, never assumed.
- [ ] The run did not end by handing the user `/to-prd`, `/to-issues`, `/work-slice`, or `/babysit-stack`: the only next command a report ever names is `/feature-goal <ISSUE>`.
- [ ] The report ends with the resume line: stage, blocking reason if any, and `/feature-goal <ISSUE>`.
- [ ] Stage DONE claimed only when the `/babysit-stack` verdict reads GOAL MET **and** the parent carries its one `## QA handoff` comment — user-terms criteria, one visual artifact per criteria group fetched from `<MEDIA-BRANCH>`, no dev material — and nothing else suite-authored beyond `# PRD`.
