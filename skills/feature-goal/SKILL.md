---
name: feature-goal
description: >
  Run the whole feature pipeline end-to-end as a re-entrant stage machine with
  exactly ONE human gate — the grilling session. Planning happens here with the
  user: grill → PRD (/to-prd) → sliced PR stack (/to-issues). Everything after
  that leaves the machine: every slice is implemented by a FRESH agent in its
  own Conductor CLOUD workspace (work-slice engine-CLI loop → stacked draft
  PR), then the stack is babysat in the cloud too (CI, Copilot rounds, then
  CodeRabbit rounds on GitHub, thread resolution) until GOAL MET. Nothing after
  the grill asks the user anything. Opt-in `local` runs the slice loop in this
  worktree with a fresh subagent per slice. Every invocation re-detects where
  the pipeline stands from durable markers and advances it — run it again to
  resume. Use when I say "run the feature pipeline", "take this ticket to a
  green stack", "resume the feature pipeline", "/feature-goal", or after a
  grilling session when I want the feature driven all the way to reviewed,
  green, stacked PRs.
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
**here**, in this session. Development and everything after it (the slice
loop, the review loop, the PRs, babysitting) happens **in the cloud** — one
Conductor cloud workspace per slice, a fresh agent per PR, babysit in the
skeleton's workspace — so it keeps running unattended once the user walks
away. This session only dispatches, monitors and reports.

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
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>` |
| `<AGENT:>` | `routing.labelPrefix` | no agent routing — this runtime's agent works every slice |
| `<DISPATCH>` | `routing.dispatch` (`cloud` \| `local`) | `cloud` — one Conductor cloud workspace per slice |
| `<CLOUD-MODEL>` | `routing.cloudModels` — `{model, effort}` per workspace agent | claude → `opus-5-1m`/`xhigh`, codex → `gpt-5.6-sol`/`xhigh`; agent key `{}` → omit both, Conductor's default |

Also read the prose docs the config points at when they exist:
`tracker.docPath`, `labels.docPath`, and `docs/agents/README.md`.
Local mode (`<DISPATCH>` = `local`, the user says `local`, or the Conductor MCP
is unreachable) is documented in `references/local-loop.md` — read it only
when that mode is active.

## Persistence — run again to resume

One invocation advances the pipeline as far as it can, then ends with a report.
A run ends at exactly four kinds of boundary:

- **The grilling gate** — the user disengaged mid-grill or the grill surfaced a
  decision they must take away. Name what they must decide; they act, then
  re-invoke. This is the **only** point where the pipeline waits on the human
  for input.
- **Waiting on the cloud** — dispatched slices still working in their
  workspaces, or the babysit session still running. Report the dispatch table
  and end; a re-invocation re-checks. Never spin-poll sessions inside one
  invocation — for unattended pacing the user wraps the re-invocation in
  whatever cadence the runtime offers (`/loop 15m "/feature-goal <ISSUE>"`, a
  scheduler, or re-running by hand).
- **Blocked** — nothing actionable remains but the goal isn't met: babysit
  ended NOT MET with only `needs-human` items (judgement-call threads, a stuck
  bot, an exhausted fix cap), a slice's loop hard-stopped (gut-check block), a
  bootstrap failed, or a nudged session died. Report each blocker plainly as
  the stop reason; the human unblocks, then re-invokes.
- **Done** — the babysit verdict reads GOAL MET.

Nothing else ends a run: not a PRD ready for approval, not a slice breakdown,
not a PR opened, not a bot review pending (babysit waits for those itself).

Every report ends with the resume line: the current stage, the blocking reason
if any, and the exact command (`/feature-goal <ISSUE>`) that continues it.

**Checkpoint.** Keep `.context/<ISSUE>/pipeline-state.md` in the host repo
(gitignored) — a single overwritten `## Workflow State` block:

```markdown
## Workflow State
- Stage: GRILL/PRD | SLICE-SPLIT | SLICE-LOOP | BABYSIT | QA-HANDOFF | DONE
- Dispatch: cloud | local
- Parent: PROJ-1200
- Docs branch: <pushed planning-docs branch>
- Slice cursor: PROJ-1234 (03 of 05) | (none)
- Nudged: (none | PROJ-1234 ×1, …)
- Babysit session: (none | <workspace deep link> / <session id>)
- Assumptions recorded: (none | PROJ-1234: <one line>, …)
- Last babysit verdict: (none | GOAL MET | NOT MET — <reason>)
```

Rewrite it at every stage boundary and after every dispatch, nudge and babysit
read-out. It is a cache, not the truth: **stage detection below always wins**.

## Stage detection — run this at every (re)entry

Detect the stage from observable state, never from conversation memory alone.
With the parent issue id `<ISSUE>` (from the argument or the conversation; if
there is no parent ticket yet, that's stage 0/1):

1. **No parent ticket / no `# PRD` comment on it** → stage GRILL / PRD.
2. **PRD comment exists, no sub-issues** → stage SLICE-SPLIT.
3. **Sub-issues exist, at least one slice with neither an open nor a merged
   PR** → stage SLICE-LOOP. Check PRs with `gh pr list --state all` — a
   **merged** PR means that slice is done; never re-detect it as needing the
   slice loop.
4. **Every slice has an open or merged PR** → stage BABYSIT (merged slices
   impose no babysit work).
5. **Last `/babysit-stack` verdict = GOAL MET, parent has no `## QA handoff`
   comment** → stage QA-HANDOFF.
6. **`## QA handoff` comment on the parent** → done; report and stop.

## Stage GRILL / PRD — the one human gate

The grilling session is the one input this skill will not manufacture:

- If the current conversation already contains a completed grilling session
  (decision tree traversed, decisions crystallised) → continue to `/to-prd`.
- If not → **run `/grill-with-docs` now, in this conversation**, seeded with
  `<ISSUE>`, and conduct the grilling with the user for real. Because nothing
  downstream will ask again, the grill must settle **everything the pipeline
  will otherwise have to assume**: the test seams (`/to-prd` would normally
  confirm these), the cross-layer decisions the skeleton slice inherits, the
  slice granularity and stack topology (`/to-issues` would normally quiz on
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

**Persist planning docs before leaving this stage — blocking, not optional.**
Grilling, `/to-prd`, and `/to-issues` write real files in this worktree:
`CONTEXT.md`, `docs/adr/**`, and `docs/agents/repo-config.md` (`goldenPaths`
write-backs). Run `git status --porcelain`, commit every one of them on the
current branch now (one commit, e.g. `docs: <ISSUE> planning docs`) **and
push**: `git push -u origin <branch>`. Cloud workspaces clone the remote and
branch from `<BASE>`, so they never see this worktree — the pushed branch is
their docs reference, named in every slice's `## Cloud dispatch` comment and
in the checkpoint. The tracker (PRD + slice tickets) stays the contract they
build from. Repeat at any stage exit that leaves new doc changes behind.

Then **fall through to SLICE-LOOP in this invocation** — dispatch is this
skill's job, not a command to hand back to the user.

## Stage SLICE-LOOP — every slice, a fresh agent in its own cloud workspace

Resolve the venue once per pipeline and record it in the checkpoint:
**`cloud`** (default) is the loop below; **`local`** is
`references/local-loop.md`. Cloud requires the Conductor MCP
(`create_workspace`, `create_session`, `send_message`, `get_session_status`,
`list_messages`); MCP unreachable → say so once and fall back to local. The
mode choice never forks work: a slice carrying a `## Cloud dispatch` comment
stays cloud-owned even after a fallback — resume or nudge its session, never
re-implement it here.

Slice state comes from durable markers, never memory: **merged PR** = done ·
**open PR** = awaiting babysit · **`## Cloud dispatch` comment** on the ticket
= in flight · none of those = undispatched.

One invocation does three things, then ends at the usual boundaries:

1. **Dispatch every unblocked, undispatched slice.** Unblocked = the skeleton,
   or a slice whose predecessor (`blockedBy`) already has an open or merged PR
   — its branch is pushed, so the delta can stack on it. The depth-2 topology
   fans out: every file-disjoint delta becomes dispatchable the moment the
   skeleton's PR is up, and they run **in parallel**, each in its own
   workspace. A `<HITL>` label is **not a gate** — dispatch the slice; the
   work session makes and records the assumption. Per slice, in stack order:
   - **`create_workspace`** — one isolated cloud workspace + its first
     session on this repo's project, named `<NN>-<issue-id>`. Agent: the
     slice's `<AGENT:>` label when present (the label picks the workspace's
     agent — `routing.delegate` is never consulted in cloud mode), else this
     runtime's own agent. Pass the agent's `<CLOUD-MODEL>` as `model` +
     `effort` (omit both when its entry is `{}`); the same pair goes on
     **every** later `create_session` in the workspace.
   - **Bootstrap the sandbox (session 1).** A cloud sandbox is fresh: this
     plugin is NOT installed there, and skills load only at session start —
     so the first session installs, and a second session works. First prompt,
     verbatim:

     > Bootstrap this workspace: install the agent plugin for your own CLI,
     > verify, and reply with exactly `BOOTSTRAP OK` or
     > `BOOTSTRAP FAILED: <reason>` — change nothing else in the repo.
     > Claude Code: `claude plugin marketplace add magnuskeinicke/agent-plugins
     > && claude plugin install magnus@magnus-skills`, verify with
     > `claude plugin list`. Codex: `codex plugin marketplace add
     > https://github.com/magnuskeinicke/agent-plugins.git &&
     > codex plugin add magnus@magnus-skills`.

     Wait for the session to go idle — the **one bounded in-dispatch wait** (a
     few `get_session_status` checks over ~3 minutes; an install is seconds,
     not a slice), then read its last message:
     - `BOOTSTRAP OK` → **`create_session`** in the same workspace (same
       agent, `<CLOUD-MODEL>`), prompt exactly:

       > `/work-slice <slice-id>` — planning docs are on branch
       > `<docs-branch>`. Stop after Step 6 (checkpoint `HANDED_OFF`): do not
       > run Step 7, the orchestrator babysits the whole stack. A `<HITL>`
       > label or "needs a human decision" line is an assumption to make and
       > record under `## Assumptions`, never a stop.

       The fresh session loads the just-installed plugin and work-slice runs
       **verbatim** there — a cloud workspace IS the virgin per-slice Conductor
       workspace it expects (its Step 2 rename applies unchanged). A fresh
       workspace + fresh session per slice is what makes every PR's agent
       fresh: it has never seen another slice's reasoning.
     - `BOOTSTRAP FAILED` or still not idle → stamp the marker
       `bootstrap: failed|pending` and move on; step 2 (or the next
       invocation) picks it up. A failed bootstrap is a **Blocked** item
       (usual cause: the sandbox's GitHub token can't read the private plugin
       repo) — never a reason to paste slice instructions inline or to
       implement the slice here.
   - **Stamp the dispatch marker.** Post a `## Cloud dispatch` comment on the
     slice ticket: workspace deep link, bootstrap + work session ids,
     bootstrap status, docs branch, dispatched-by note. Idempotent — update
     an existing one, never add a second. This comment is the cross-machine
     double-dispatch guard: a slice carrying it is never dispatched again and
     never implemented inline.
2. **Check the in-flight slices.** For each dispatched slice with no PR yet:
   marker `bootstrap: pending|failed` → check the bootstrap session first
   (`BOOTSTRAP OK` now → `create_session` with the work prompt above and
   update the marker; `FAILED`, or idle without OK for a second invocation →
   Blocked, with deep link + reason). Otherwise `get_session_status` on the
   **work session** once: `working` → leave it alone. `idle` → re-read the
   durable markers (branch on the remote, `gh pr list`): PR up → it finished;
   still nothing → **nudge** once: `send_message` with the same work prompt
   (work-slice is re-entrant; the session resumes from its own checkpoint and
   the engine's `status`). Record the nudge in the checkpoint; a slice already
   nudged in a previous invocation with no new markers since → Blocked, with
   the deep link.
3. **End at a boundary.** Slices still in flight or blocked on a predecessor →
   *waiting on the cloud*: print the dispatch table (slice → workspace deep
   link → status) and end with the resume line. Every slice with an open or
   merged PR → fall through to BABYSIT.

## Stage BABYSIT — in the skeleton's cloud workspace

The slice branches live in cloud workspaces, and babysit's cross-run state must
live in one workspace's `.context/`, so the babysit home is the **skeleton
slice's cloud workspace**. Run it as a **fresh session** there — never in the
spent work session: `create_session` (same agent, `<CLOUD-MODEL>`), prompt
exactly `/babysit-stack <ISSUE>`; record the session in the checkpoint
(`Babysit session`). Local mode runs `/babysit-stack <ISSUE>` in this worktree
instead (reference).

Babysit is a babysitting mode, not a pass: per PR, bottom → top, it gets CI
green, runs `<BOT>` rounds until satisfied, then `<COMMENT-BOT>` rounds until
satisfied, resolves every thread, restacks after fixes, and **waits for each
bot round itself** with bounded polls. It returns only with a terminal verdict.

- **Session still `working`** → *waiting on the cloud*: end with the resume
  line; a re-invocation reads the verdict. Never spin-poll it.
- **Session `idle`** → read the verdict block from its transcript
  (`list_messages`, after-cursor) plus live PR state:
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
  - **Idle with no verdict block** (session died) → one fresh
    `create_session` with the same prompt (babysit is re-entrant); a second
    silent death is Blocked.

Never start a second babysit session on an unchanged NOT MET state — it waited
already; only a human changes what it would find.

## Stage QA-HANDOFF — the parent ticket's one comment for QA

The parent ticket has two readers: the user + AI (grill, `# PRD`) and then
**QA**, who has no code access. The suite writes exactly one thing for QA on
it — a `## QA handoff` comment per
`../work-slice/references/qa-handoff.md` — and nothing else: no assumptions,
verification tables, provenance or dispatch markers (those live on the slice
tickets and the PRs). Compose it here, in the orchestrating session, once
babysit reads GOAL MET:

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

Local mode does the same from this worktree. A cloud workspace that died
before publishing media leaves a criterion without evidence — write that
down in the handoff rather than substituting a Storybook or design image.

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
- **Development leaves this machine.** After SLICE-SPLIT this session only
  dispatches, monitors, nudges and reads verdicts — it never implements,
  fixes, reviews or babysits code itself in cloud mode. Cloud workspaces come
  only from the Conductor MCP — one per slice, never reused for another
  slice, never faked with `git worktree add`. A dispatched slice's
  `## Cloud dispatch` comment is authoritative over any local checkpoint.
- **A fresh agent per PR.** Each slice gets its own workspace and its own work
  session; babysit gets its own fresh session. Never continue a spent session
  for new work (a nudge resumes the *same* slice — that is the one exception).
  All caps respected (5 review rounds, 3 Playwright rounds, babysit's caps);
  caps exhausted → escalate on the PR, never grind.
- **Routing is honoured:** a `<AGENT:><name>` slice gets a workspace running
  that agent. Dispatched work is verified from durable markers (marker
  comment, remote branch, PR state), never a session status alone.
- Stacking is `<STACK>` + plain git inside the workspaces. With `gh-stack`:
  never `gh stack submit` (auto-titled PRs) and never `gh stack link --open`
  (un-drafts).
- Label writes stay additive (Linear's `save_issue.labels` replaces the whole
  set); `<NEXT>` has exactly one carrier; never stamp `labels.agentReady`.
- Re-entry safe: every invocation re-runs stage detection; never redo a stage
  whose artifacts exist (PRD comment, sub-issues, dispatch markers, open PRs)
  — repair forward. Durable markers always win over the checkpoint file.
- **Persistence is re-invocation, never a stop-hook.** A run ends only at the
  grilling gate, waiting on the cloud, Blocked, or DONE — always with the
  resume line. Never spin-poll sessions inside one invocation.

## Workflow Boundaries

**This skill orchestrates the feature pipeline as a re-entrant stage machine with the grill as its only human gate — planning here, development and babysitting in the cloud — sequencing the constituent skills, never re-implementing them.**

- **DOES**: run the grill inline (the one gate) and make it cover every downstream decision; run `/to-prd` and `/to-issues` in pipeline mode (no user checks, no next-command handoffs) and commit + push the planning docs they write; dispatch each slice to its own Conductor cloud workspace (bootstrap session, then a fresh work session running `/work-slice`), stamp `## Cloud dispatch` markers, monitor and nudge; start a fresh `/babysit-stack` session in the skeleton's workspace and read its verdict; keep `.context/<ISSUE>/pipeline-state.md`; end every run with the resume line.
- **DOES NOT**: answer the grill for the human, ask the human anything after the grill, treat `<HITL>` as a stop, implement / fix / review / babysit code in this session (cloud mode), own review-loop internals (the engine CLI does) or CI/bot/thread mechanics (`/babysit-stack` does), merge/approve/mark ready/mark issues done, reuse a spent session for new work, or relocate the venue-neutral standalone commands (`/work-issue`, `/solve-ready-tickets`, `/daily-ticket-manager` run wherever the user starts them).

## Red Flags — STOP

- About to fabricate a PRD from a bare ticket title with no grilling session in the conversation — stop: run `/grill-with-docs` inline and grill the user for real; end only if they disengage.
- About to ask the human to approve the PRD, the slice breakdown, the test seams, a PR, or "whether to continue" — stop: the grill was the gate; decide, record the assumption, proceed.
- About to stop on a `<HITL>` slice or a "needs a human decision" line — stop: dispatch it; the work session makes and records the assumption.
- About to end the invocation because `/to-prd` said "run `/to-issues`" or `/to-issues` said "run `/work-slice`" — stop: pipeline mode supersedes those; the only command a report ever hands the user is `/feature-goal <ISSUE>`.
- About to report `/work-slice` or `/babysit-stack` as the user's next step — stop: they run *inside* the cloud sessions; dispatch / start them instead.
- About to implement, fix, review or babysit a slice in this session while in cloud mode — stop: development left the machine; dispatch, monitor, nudge, read verdicts.
- About to dispatch with `CONTEXT.md`, `docs/adr/**`, or `docs/agents/**` uncommitted or unpushed — stop: commit and push; the workspaces never see this worktree.
- About to send `/work-slice` as a workspace's **first** session prompt — stop: the fresh sandbox has no plugin and skills load only at session start; bootstrap session first, then a fresh work session.
- About to paste slice instructions inline into a cloud session because bootstrap failed — stop: a failed bootstrap is Blocked (deep link + reason), not a workaround invitation.
- About to `create_workspace` for a slice that already has a dispatch marker or a live workspace, or to run babysit in the spent work session — stop: one workspace per slice, ever; babysit is a fresh session in the skeleton's workspace.
- About to dispatch a slice whose predecessor has no open/merged PR — stop: blocked slices wait for the branch they stack on.
- About to spin-poll `get_session_status`, or wait for a bot review yourself — stop: one check (plus at most one nudge) per slice per invocation; babysit waits for bots; end with the resume line.
- About to start another babysit session on an unchanged NOT MET state — stop: NOT MET is Blocked — report and end.
- About to redo a stage whose artifacts exist (PRD comment, sub-issues, dispatch markers, open PRs) — stop: repair forward from stage detection.
- About to run `gh stack submit` or `gh stack link --open` — stop: submit opens auto-titled PRs, `--open` un-drafts.

## Verification

Before reporting done:

- [ ] `.context/<ISSUE>/pipeline-state.md` rewritten to the current stage, dispatch mode, docs branch, slice cursor, nudges, babysit session, assumptions, and last babysit verdict.
- [ ] The reported stage matches live markers (`# PRD` comment, sub-issues, `## Cloud dispatch` comments, `gh pr list --state all`) — not conversation memory or the checkpoint alone.
- [ ] After the grill, the human was asked nothing: `/to-prd` and `/to-issues` ran in pipeline mode; every assumption made downstream is recorded on its ticket/PR and listed in the report.
- [ ] Planning docs (`CONTEXT.md`, `docs/adr/**`, `docs/agents/**`) were committed **and pushed** before the first dispatch; `git status --porcelain` shows none left over; the docs branch is in the checkpoint and every dispatch comment.
- [ ] Cloud mode: every dispatched slice's ticket carries exactly one `## Cloud dispatch` comment (deep link, both session ids, bootstrap status, docs branch); no slice has two workspaces; a local fallback was announced once.
- [ ] Every completed slice has a draft PR verified from durable markers (remote branch, `gh pr view`), and `<NEXT>` has exactly one carrier or the report names why none does (stack complete).
- [ ] Babysit ran as a fresh session in the skeleton's workspace; its verdict was read from the transcript plus live PR state, never assumed.
- [ ] The run did not end by handing the user `/to-prd`, `/to-issues`, `/work-slice`, or `/babysit-stack`: the only next command a report ever names is `/feature-goal <ISSUE>`.
- [ ] The report ends with the resume line: stage, blocking reason if any, and `/feature-goal <ISSUE>`.
- [ ] Stage DONE claimed only when the `/babysit-stack` verdict reads GOAL MET **and** the parent carries its one `## QA handoff` comment — user-terms criteria, one visual artifact per criteria group fetched from `<MEDIA-BRANCH>`, no dev material — and nothing else suite-authored beyond `# PRD`.
