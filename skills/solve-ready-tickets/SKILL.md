---
name: solve-ready-tickets
description: >
  Dispatch the repo's unclaimed `agent:ready` issues (or the configured
  labels.agentReady label) into one Conductor cloud workspace per eligible
  issue by default. Each workspace runs work-issue, which claims the issue,
  implements it, opens a draft PR, completes review and CI, and writes the QA
  handoff. The dispatcher checks eligibility, dispatches and stops; work-issue owns
  the development loop. Re-runs adopt existing workspaces. Use when I say "solve my ready
  tickets", "run the autonomous solver", "fan out the agent-ready queue", "pick
  up the agent-ready tickets", or run `/solve-ready-tickets`. Built to run
  unattended on a schedule. Use `dry-run` for a read-only preview or `max N` to
  cap new workspaces; `apply` remains an alias for the default.
argument-hint: "[apply|dry-run] [max N]"
---

# Solve Ready Tickets — fan the queue out to the cloud

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `solve-ready-tickets`; supporting skills inherit the caller’s resolved role.

At entry, resolve bootstrap/checkpoint configuration under the shared runtime
contract **before** placeholders, tracker reads or stage detection. A pinned
config takes precedence over the checked-out branch for every setting and is
passed to all constituent skills; a missing named snapshot blocks the run.


The **autonomous-loop dispatcher** consumes `<AGENT-READY>` (default
`agent:ready`), whether applied by `daily-ticket-manager` or by the user.
It re-checks each ticket, then gives every eligible ticket **its own cloud
workspace running `/work-issue`**, which owns everything from the claim to the
green PR. Invoking this skill starts dispatch; `dry-run` previews it.

**The division of labour is absolute.** This skill never writes code, never
creates a branch or worktree itself, never opens a PR, and never runs the
development or review loop. It uses the shared configuration/model helpers and
supervisor, and touches the tracker only to decline or apply a worker's exact
queued operations. `/work-issue` owns development, per ticket,
in its own sandbox — including `/babysit-stack` to GOAL MET and the ticket's one
`## QA handoff` comment. If you find yourself implementing, you are in the wrong
skill.

## Repo contract — resolve this first

Use the configuration resolved at entry (`docs/agents/repo-config.md`'s
`## Config` JSON block when unpinned). The placeholders below use its values
and listed fallbacks. If the repository/team scope cannot be resolved, stop
and name the missing information; never scan unrelated projects.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<TEAM>` | `tracker.team` / `tracker.teamId` | the repo's only team |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | use the tracker's started/in-progress state category |
| `<AGENT-READY>` | `labels.agentReady` | `agent:ready` |
| `<HITL>` | `labels.needsHuman` | no hard exclusion to honour |
| `<SKIP>` | `labels.managerSkip` | no pipeline exclusion to honour |
| `<RISK:>` | `labels.riskPrefix` | no risk label to clear on decline |
| `<AGENT:>` | `routing.labelPrefix` | no routing labels — every workspace gets this runtime's agent |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<CLOUD-MODEL>` | shared registry `model --role implementer --runtime <agent> --cloud` | explicit model/effort; legacy cloud overrides remain supported |

Also read the prose rules at `tracker.docPath` (workspace ids, how to fetch
issues) and `labels.docPath` (the autonomous-loop trigger and additive
label-write rule). The trigger label is sufficient; no previous
`daily-ticket-manager` run is required.

The keys `/work-issue` needs — `skills.startWork`, `skills.createPr`,
`pr.botReviewer`, `pr.commentReviewer`, `pr.mediaBranch`, `e2eDir`,
`devServerCommand` — are **not** this skill's business. The dispatched session
resolves them from the same file inside its own sandbox.

This skill never marks an issue done, merges, approves, opens a PR, or runs
compliance. Its terminal state is **N completed or blocked workspaces + a report of deep
links**. Every line of code the run produces gets human eyes on a draft PR.

## Prerequisite — a way to create cloud workspaces

Fan-out needs Conductor:

- **From a local session** — the Conductor MCP: `list_projects` /
  `get_project`, `list_project_workspaces`, `create_workspace`,
  `create_session`, `get_session_status`, `list_messages`, `list_models`.
- **From inside a cloud sandbox** — the `conductor` CLI
  (`/conductor/bin/conductor`, authenticated as you):
  `conductor workspace create`, `conductor session create --workspace <id>
  --agent <agent> [--model --effort] --name <name> --message "<prompt>" --json`,
  `conductor session status <id>`.

Neither reachable → **STOP** and say so. Do **not** fall back to solving tickets
in this checkout: an unattended run that starts writing code in the user's
working copy is exactly the failure this design removes.

Resolve the repo's Conductor **project** once (match the git remote against
`list_projects`) and reuse it for every workspace this run creates.
Check supported/configured runtimes and model IDs through `list_models` (CLI:
`conductor model --json`) before launching the selected sessions.

## Mode — cloud dispatch is the default

- **Default / `apply`** — select the queue, triage, decline the escalations,
  create one cloud workspace per eligible issue, confirm each session started,
  and stop.
  An invocation without a mode authorizes this workflow; do not ask for an
  extra `apply` confirmation.
- **`dry-run`** (or an explicit request to preview only) — select the queue,
  triage, and report what *would* be dispatched
  and in what order. **Mutate nothing**: no workspaces, no sessions, no label or
  status changes, no decline notes.

Without `max N`, dispatch **every eligible issue in the queue snapshot**.
`max N` is an optional positive-integer cap on **new workspaces**; existing
workers and their recovery do not consume it. Select oldest-first. Independent
workspaces run **in parallel**; start every selected worker, confirm each
reaches working, then end the run — never wait on an implementation. Record
per-ticket failures and continue with the others. Reconcile adopted workers once
even when there is no new work.

## Resume — sweep the workspaces you already dispatched (first, always)

The run is **re-entrant: run it again to resume**. Each invocation reconciles
its fan-out in one pass and ends; the next run (usually the schedule) adopts
whatever is still in flight. Nothing local stays alive between runs — that is
the point of cloud workspaces.

**The durable ownership marker is the cloud workspace itself.** There is no
dispatch comment: a standalone ticket is human-facing and carries exactly one
suite comment ever, the QA handoff its session writes
(`../work-slice/references/qa-handoff.md`). So before anything else, list the
project's workspaces (page `list_project_workspaces` until exhausted; SQL
omits workspaces without transcripts) and match full issue IDs followed by a
space or end of name, so `PROJ-12` never matches `PROJ-123`: a workspace named
**`<ISSUE> …`** means this ticket is already dispatched and is **never
re-dispatched**.

In `dry-run`, inspect and report existing workspaces without restarting or
flushing queued writes; then continue to preview the new queue below.

In dispatch mode, for each already-dispatched ticket, adopt its persisted
supervisor state (or reconstruct it from the latest session and durable markers) and
take **one** reconcile step per `../feature-goal/references/cloud-relay.md`.
Working → report the deep link, nothing else. Idle without a relay result → one
recovery in that workspace, regardless of whether a PR already exists. Explicit
blocked → report it; complete → verify current-head GOAL MET and the ticket's QA
handoff. Never infer completion from a PR's mere existence. A second silent
death is blocked; no duplicate workspace. Reconcile adopted workers, then select
and launch new work in the same pass; nothing serializes on a terminal result.

A ticket in `<IN-PROGRESS>` with a branch or PR but **no** dispatch workspace is
someone else's work (mine, or a hand-run `/work-issue`) — leave it alone and
list it under Notes.

## Step 1 — Select the queue

Scope is **the repo's unclaimed `<AGENT-READY>` issues**. For Linear, filter by
label and the repo's `<TEAM>` / project scope from `tracker.docPath`; for GitHub,
use this repository's issues. Do not add an assignee, ready-for-dev status, or
cycle filter unless the user requested one. Paginate to exhaustion (a page size
of 100 is not a total cap), deduplicate by issue ID, and keep this snapshot for
the run. Resolve statuses by configured name/id and tracker state category.

Then **drop**, in this order:

1. Any closed, completed, cancelled, archived, or already-started issue,
   including `<IN-PROGRESS>` and in-review states. A stale trigger never takes
   over ongoing work. An assignee alone is not a claim.
2. Any ticket carrying **`<SKIP>`** — PRD-pipeline-owned, never autonomous.
   (`daily-ticket-manager` should never have stamped `<AGENT-READY>` on one, but
   guard anyway.)
3. Any ticket carrying **`<HITL>`** — never both, but guard.
4. Any ticket **already dispatched** — a workspace named `<ISSUE> …` exists
   (the Resume sweep found it).
5. Any ticket **already claimed elsewhere**: an existing branch carrying the
   issue id (`git fetch --prune origin` first, then
   `git branch --all --list '*<issue-id>*'`), or a PR referencing the issue
   (`gh pr list --search "<ISSUE>" --state all`). These searches return
   candidates: confirm the full issue ID/linked issue before excluding a ticket.

A previous decline does not require a new manager run: deliberately reapplying
`<AGENT-READY>` makes the ticket eligible for this run's fresh triage.

Only `<AGENT:><supported-runtime>` labels select the workspace's agent (Step 3).
Always exclude `<AGENT-READY>` and other queue/risk labels from runtime routing:
`agent:ready` is a trigger, never an agent named `ready`. A supported runtime
different from the caller is allowed. Report the resolved runtime per ticket.

Sort survivors **oldest-first** (by `createdAt`, then issue ID). Triage in that
order and select all `dispatch` results, or the first N when `max N` is given;
declined tickets do not consume the workspace cap.

Fetch each survivor with `get_issue` — the list description is truncated, and
the triage in Step 2 reads the real thing. **Do not** extract acceptance
criteria, write a contract, or plan an implementation: that is the dispatched
session's job, from the same ticket.

**An empty queue is a normal outcome** — report "no new `<AGENT-READY>` tickets
to pick up" and reconcile any adopted workers once. Never widen scope to
invent work.

## Step 2 — Triage: dispatch or decline

`<AGENT-READY>` is the user or ticket manager's signal to start unattended work.
This is the one cheap look at the *code* before an unattended agent is turned
loose on it, and it is the only reason this skill reads the repo at all.

Per surviving ticket, run **one read-only triage task** (leaner model; a
fresh native worker or shared CLI task using the explicit `triage` profile):
grep/glob/read a few files near the likely change and **implement nothing, edit
nothing**. Two outcomes, biased toward `escalate` when torn:

- **`dispatch`** — a bounded change in one or a few areas, criteria that can be
  proven by running something, no schema/contract redesign. Fits one small
  reviewable PR.
- **`escalate`** — on inspection BIGGER or riskier than an `<AGENT-READY>`
  ticket should be: multiple unrelated areas, ambiguous or underspecified
  acceptance criteria, a schema-changing DB migration, an
  auth/billing/security/sensitive-data surface, or anything needing
  product/architecture judgement. Choose this to bounce the ticket back to a
  human rather than let a sandbox ship a bad PR.

The old `trivial` / `standard` tiers are gone: they existed to size a review
loop this skill no longer runs. `/work-issue` judges leanness itself and owns
its own caps.

### `escalate` → decline the ticket (dispatch mode)

The solver does **not** make the routing call itself — it bounces the ticket
back to `daily-ticket-manager` for a fresh classification, handing over what it
learned:

1. **Write the decline note** — the only suite comment a human ticket may carry
   besides the QA handoff, because it is the durable signal
   `daily-ticket-manager` re-classifies on (the manager writes no comment of its
   own). It occupies the ticket's **one comment slot**, so keep it to three lines
   and let a later handoff replace it. Use this block exactly:

   ```md
   ## Autonomous solve — declined

   **Why:** <what the triage found, one sentence.>
   **Found:** <the one thing the text-only triage missed — real scope, the ambiguity, why it isn't one safe PR.>
   **Suggested:** <e.g. high risk + needs-human> — daily-ticket-manager makes the call.
   ```

   No preamble, no attribution footer, no bullet lists. Make it idempotent: if a
   comment already starts with `## Autonomous solve — declined`, update it **by
   id** rather than adding a second.
2. **Clear `<AGENT-READY>` and `<RISK:>*`** in one additive write — read the
   issue's current labels, write them back **minus those two**. Clearing
   `<AGENT-READY>` is what takes the ticket out of this skill's own queue; without
   it the next run re-selects it, re-triages it, and re-declines it forever.
   Clearing `<RISK:>` drops it into `daily-ticket-manager`'s gap-fill window so the
   next triage re-classifies both axes from scratch. Preserve every other label —
   type, product, compliance, everything.

   > **Preserving an existing label is not setting it.** Echoing back a
   > pre-existing `Compliance/*` (or any product) label in this
   > replace-the-whole-set write is *required* label preservation — it is **not**
   > "running compliance" or any of the forbidden terminal actions in the Safety
   > rules.
3. **Do not add `<HITL>`** and do not change the status — routing is the
   manager's call now, made fresh against the decline note. Report tickets
   outside the manager's assignee/ready-for-dev scope for manual re-triage.
4. Never dispatch a declined ticket. No workspace is created for it.

## Step 3 — Dispatch one workspace per ticket (dispatch mode)

For each `dispatch` ticket, in parallel:

1. **Create the workspace** — `create_workspace` on the repo's project (or
   `conductor workspace create` from a sandbox):
   - **name** `<ISSUE> <short slug of the title>` — this name **is** the
     ownership marker every later run matches on, so the `<ISSUE>` prefix is not
     optional.
   - **branch** `<BASE>`. Conductor cuts the workspace's own branch from it,
     which is exactly the virgin checkout `/work-issue` demands (it creates no
     branch and no worktree of its own).
   - **agent** = the supported runtime selected in Step 1, else this runtime's
     agent. Resolve `<CLOUD-MODEL>` as `model` + `effort` for every session.
   - **first session** = bootstrap. The cloud MCP `create_workspace` creates
     this session too: pass the bootstrap prompt as `message` and a bootstrap
     `sessionName` in that call; do not start a second bootstrap concurrently.
2. **Bootstrap and work session** — follow
   [cloud bootstrap and dispatch](../feature-goal/references/cloud-relay.md).
   Prepare a separate dispatch configuration from the resolved repo config,
   setting only `labels.agentReady` to the resolved `<AGENT-READY>` value
   (including the `agent:ready` fallback). Preserve every other setting and
   leave the source config and any incoming pinned snapshot untouched. Freeze
   this dispatch config as the worker's pinned snapshot and transfer it during
   bootstrap. This supplies the claim label through `work-issue`'s existing
   configuration handling; standalone `work-issue` defaults stay unchanged.
   Check the selected runtime's
   plugin, tracker, GitHub, browser and gate access in a fresh session. Start
   `/work-issue <ISSUE>` only after `BOOTSTRAP OK`. Its instruction remains the
   ticket invocation; bootstrap state points to the dispatch config snapshot
   and holds the runtime metadata. The worker claims the issue by
   removing only `<AGENT-READY>` and moving it to `<IN-PROGRESS>`, then runs
   the existing `work-issue` implement → review/fix → draft PR → babysit → QA
   handoff loop. Do not copy or shorten that loop in the dispatch prompt.
3. **Confirm and detach** — persist one supervisor state per workspace, confirm
   each work session reaches working (bounded, per the reference), report the
   deep links and **end the run**. The worker claims, implements, reviews,
   babysits and writes the QA handoff on its own. A later invocation recovers a
   silent crash and flushes queued tracker writes if sandbox access was denied.

**The claim window is real and accepted:** between dispatch and the session's
claim the ticket still carries `<AGENT-READY>`, so two dispatcher runs racing in
that window could both select it. The workspace-name check (Resume sweep,
Step 1 drop 4) closes it for every run that starts after the workspace exists —
which is why the workspace is created *before* the work session, and why its name
must carry `<ISSUE>`. Do not paper over the window by claiming the ticket here:
the session's claim is what proves a real agent picked it up.

## Step 4 — Report

End every run with a compact summary, regardless of mode:

```md
# Autonomous solve — agent-ready queue
Mode: apply | dry-run   ·   In queue: <n>   ·   Dispatched now: <k>   ·   Limit: all | <N>   ·   Adopted: <r>

| Ticket   | Title         | Triage    | Outcome                                    |
| -------- | ------------- | --------- | ------------------------------------------ |
| <id-1>   | <short title> | dispatch  | workspace <deep link> · GOAL MET + QA handoff |
| <id-2>   | <short title> | dispatch  | workspace <deep link> · Blocked: bot unavailable |
| <id-3>   | <short title> | escalate  | declined → re-triage (manager)             |
| <id-4>   | <short title> | —         | dispatch failed: BOOTSTRAP FAILED (<link>) |

## Needs me
- <id-4> — <title> — bootstrap failed; the workspace exists but nothing is running in it.
- <id-5> — <title> — <concrete blocker from the worker/supervisor> — <workspace/PR deep link>.

## Declined — bounced back for re-triage
- <id-3> — <title> — <why triage escalated it; trigger and risk labels cleared, status unchanged; manager or manual re-triage>.

## Notes
- <workspaces created; tickets left to other owners; prerequisites missing; anything skipped>
```

Use **deep links**, not ids — they are clickable, ids are not. This report is
the only place the dispatcher's own reasoning lives. Tracker writes are limited
to decline notes/labels and exact queued operations authored by the worker;
the dispatcher writes nothing to a PR.

In `dry-run`, the table shows what *would* be dispatched and in what order; no
Outcome column actions are taken. Include existing workers' observed status in
the preview. A dispatch report states each worker's status at the moment the
run ended — in-flight is a normal outcome, not an unfinished report.

## Scheduling

Scheduled invocations use the same default: `/solve-ready-tickets` dispatches
all eligible issues; `/solve-ready-tickets max 5` caps new workspaces;
`/solve-ready-tickets dry-run` previews only. Preserve any explicit preview or
read-only constraint in an existing schedule. Updating this skill does not
authorize creating or editing a schedule.

A schedule prompt should identify the repository/team and any narrower scope
or cap the user wants. `daily-ticket-manager` can populate the queue beforehand,
but is not a prerequisite. Each invocation is short — dispatch, confirm, report
— so schedule it at an interval that fits implementation, CI, bot reviews and
the QA handoff (workers usually need hours, so a run every few hours reconciles
them promptly without any of it running locally). Re-runs adopt existing
workspaces before selecting new tickets.

## Workflow Boundaries

**This skill drains the agent-ready queue by fanning it out: it selects, triages, and gives each ticket its own cloud workspace running `/work-issue`. It writes no code.**

- **DOES**: sweep existing workspaces, select the repo's unclaimed `<AGENT-READY>` queue, triage, decline escalations, and by default create one cloud workspace per eligible ticket (optional `max N`); bootstrap the selected runtime, invoke `/work-issue <ISSUE>`, confirm each session started, apply exact queued tracker operations found from earlier runs, and report deep links. Explicit `dry-run` only inspects and previews.
- **DOES NOT**: write, review, or fix code; create git branches or worktrees itself; run the development/review loop, Playwright, or gates; open, comment on, or babysit a PR; originate claims (the worker owns them); write to the tracker beyond declines and worker-authored queued operations; merge, mark PRs ready, approve, mark issues done, run compliance, or create/close tickets.

## Red Flags — STOP

- About to mutate anything in explicit `dry-run` / preview mode — report only, including during the Resume sweep. Otherwise dispatch is the default; no extra `apply` confirmation.
- About to implement, edit, test, or commit anything — **wrong skill**: this one dispatches. If Conductor is unreachable, stop and say so; never solve the ticket in this checkout.
- About to open a PR, request a bot, or run `/babysit-stack` — stop: the dispatched `/work-issue` session does all of it, on its own PR.
- About to claim a ticket (clear `<AGENT-READY>` or set `<IN-PROGRESS>`) — stop: the session claims. Your guard against double-grabbing is the `<ISSUE>`-named workspace.
- About to create a workspace whose name doesn't start with `<ISSUE>` — stop: that name is the ownership marker; without it the next run re-dispatches the ticket.
- About to put anything but `/work-issue <ISSUE>` in the work session's prompt — stop: no context paste, no criteria, no plan.
- About to compose a `## QA handoff`, a `## QA evidence` table, acceptance criteria, a dispatch marker, or any comment other than a decline note on a ticket — stop: the ticket's one comment is the handoff, and its session writes it after GOAL MET.
- About to call `create_attachment_from_upload` or attach media to a ticket — stop: this skill produces no media.
- About to wait on, poll, or babysit a dispatched worker — stop: confirm it is working, report the deep link, end the run. Ending with workers still running is the **expected** outcome; the next invocation reconciles them.
- About to re-dispatch a ticket that already has an `<ISSUE>`-named workspace — stop: restart a session *in that workspace* if it died, nothing more; a second silent death is Blocked.
- About to write labels without reading the current set first — `save_issue.labels` replaces the whole set; on a decline write it back minus exactly `<AGENT-READY>` and `<RISK:>`, nothing else. For dispatch, let the worker claim; only apply its exact queued label operations when tracker access requires the caller.
- About to stamp `<HITL>` or route an `escalate` ticket yourself — decline instead: the note, cleared trigger/risk labels, unchanged status.
- Empty queue and tempted to widen scope — an empty queue is a valid result; report it and stop. Honor `<SKIP>` and `<HITL>` as hard exclusions even alongside `<AGENT-READY>`.

## Verification

Before reporting done:

- [ ] The Resume sweep ran **before** selection: every `<ISSUE>`-named workspace on the project was matched against the queue, reconciled in one step, and reported; no ticket with such a workspace was re-dispatched.
- [ ] Selection paged the repo-scoped trigger queue to exhaustion, applied no implicit assignee/ready-for-dev filter, and treated `agent:ready` as a trigger rather than a runtime. Only explicit `max N` capped new workspaces.
- [ ] Nothing in this run wrote, tested, or committed code, created a git branch/worktree itself, ran the development/review loop, or touched a PR.
- [ ] No ticket was claimed here — the worker performed its own claim; the caller only applied queued operations when tracker access required it.
- [ ] Every dispatched ticket has exactly one workspace, named `<ISSUE> …`, whose work session's entire prompt is `/work-issue <ISSUE>` — after a bootstrap session that replied `BOOTSTRAP OK`.
- [ ] The dispatcher authored only decline notes and applied only exact worker-authored queued comments, upserting by ID. No tracker attachments.
- [ ] Declined tickets: `<AGENT-READY>` **and** `<RISK:>*` cleared in one additive write, every other label preserved, no routing label added, status unchanged, no workspace created.
- [ ] The Step 4 report accounts for every queue ticket — completed, blocked, declined, failed to dispatch, or left to another owner — with **deep links**, and names every item that needs me.
- [ ] Nothing in the run merged, marked ready, marked done, or initiated compliance.
- [ ] Explicit dry-run created no workspace/session, restarted no worker, flushed no writes, and still previewed the new queue after inspecting existing workspaces.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
