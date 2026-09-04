---
name: solve-ready-tickets
description: >
  The autonomous-loop dispatcher. Scans the issue tracker for tickets that
  daily-ticket-manager stamped agent-ready (assigned to me, on the repo's team,
  queued to start), triages each for one last safety check, and fans out **one
  Conductor cloud workspace per ticket**, each running `/work-issue <id>` — which
  claims the ticket, implements it, opens a draft PR, babysits that PR to green
  (CI, both review bots, every thread resolved) and writes the ticket's QA
  handoff. This skill writes no code and opens no PRs: it selects, guards, and
  dispatches. Dispatch-and-end; re-entrant — a re-run sweeps the workspaces it
  already dispatched before selecting new work. Use when I say "solve my ready
  tickets", "run the autonomous solver", "fan out the agent-ready queue", "pick
  up the agent-ready tickets", or run `/solve-ready-tickets`. Built to run
  unattended on a schedule. Defaults to a read-only dry run; only declines and
  dispatches on `apply`.
argument-hint: "[dry-run|apply] [max N]"
---

# Solve Ready Tickets — fan the queue out to the cloud

The **autonomous-loop dispatcher** — the counterpart to `daily-ticket-manager`.
That skill *triages* my queue and stamps `<AGENT-READY>` on the small, low-risk,
single-PR work an unattended agent can safely take. This skill *drains that
label*: it re-checks each ticket, then gives each one **its own cloud workspace
running `/work-issue`**, which owns everything from the claim to the green PR.

**The division of labour is absolute.** This skill never writes code, never
creates a branch or worktree, never opens a PR, never runs the engine CLI, never
touches the tracker except to decline. `/work-issue` does all of it, per ticket,
in its own sandbox — including `/babysit-stack` to GOAL MET and the ticket's one
`## QA handoff` comment. If you find yourself implementing, you are in the wrong
skill.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). The placeholders
below stand for its values. A key this skill *needs* that is empty is a **hard
stop**, not a guess — say which key is missing and end the run.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<TEAM>` | `tracker.team` / `tracker.teamId` | the repo's only team |
| `<READY>` | `tracker.statuses.readyForDev` | **STOP** — there is no queue to scan |
| `<AGENT-READY>` | `labels.agentReady` | **STOP** — this skill *is* that label's consumer |
| `<HITL>` | `labels.needsHuman` | no hard exclusion to honour |
| `<SKIP>` | `labels.managerSkip` | no pipeline exclusion to honour |
| `<RISK:>` | `labels.riskPrefix` | no risk label to clear on decline |
| `<AGENT:>` | `routing.labelPrefix` | no routing labels — every workspace gets this runtime's agent |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<CLOUD-MODEL>` | `routing.cloudModels` — `{model, effort}` per session agent | claude → `opus-5-1m`/`xhigh`, codex → `gpt-5.6-sol`/`xhigh`; agent key `{}` → omit both, Conductor's default |

Also read the prose rules at `tracker.docPath` (workspace ids, how to fetch
issues) and `labels.docPath` (`<AGENT-READY>` is **the autonomous-loop trigger**,
owned by `daily-ticket-manager`; the additive label-write rule).

The keys `/work-issue` needs — `skills.startWork`, `skills.createPr`,
`pr.botReviewer`, `pr.commentReviewer`, `pr.mediaBranch`, `e2eDir`,
`devServerCommand` — are **not** this skill's business. The dispatched session
resolves them from the same file inside its own sandbox.

This skill never marks an issue done, merges, approves, opens a PR, or runs
compliance. Its terminal state is **N dispatched workspaces + a report of deep
links**. Every line of code the run produces gets human eyes on a draft PR.

## Prerequisite — a way to create cloud workspaces

Fan-out needs Conductor:

- **From a local session** — the Conductor MCP: `list_projects` /
  `get_project`, `list_project_workspaces`, `create_workspace`,
  `create_session`, `get_session_status`, `list_messages`.
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

## Mode — dry-run is the default

- **`dry-run`** (default, and the default whenever the mode is absent or
  ambiguous) — select the queue, triage, and report what *would* be dispatched
  and in what order. **Mutate nothing**: no workspaces, no sessions, no label or
  status changes, no decline notes.
- **`apply`** — do everything: triage, decline the escalations, create the
  workspaces and their sessions, report.

`max N` caps how many tickets one run dispatches — **default 5**. They go out
**in parallel**: nothing runs on this machine, so wall-clock is Conductor's
problem, not the queue's. Running unattended, never block on input: a ticket
whose dispatch fails is recorded and skipped, and the run moves on.

## Resume — sweep the workspaces you already dispatched (first, always)

The run is **re-entrant: run it again to resume**, and dispatch-and-end means a
re-run is the only thing that ever looks in on the fan-out.

**The durable ownership marker is the cloud workspace itself.** There is no
dispatch comment: a standalone ticket is human-facing and carries exactly one
suite comment ever, the QA handoff its session writes
(`../work-slice/references/qa-handoff.md`). So before anything else, list the
project's workspaces (`list_project_workspaces`; `run_sql` when the list is long
— it is paginated) and match names against the queue: a workspace named
**`<ISSUE> …`** means this ticket is already dispatched and is **never
re-dispatched**.

For each already-dispatched ticket, check its newest session **once**
(`get_session_status` / `conductor session status`) and classify:

- **`working`** → alive. Report ticket → workspace → session and move on.
- **`idle`** with a PR for the ticket (`gh pr list --search "<ISSUE>" --state all`)
  → its `/work-issue` run ended. Report the PR and whether the ticket has its
  `## QA handoff` yet; a PR without one means the session ended Blocked short of
  GOAL MET, which is a **human** item — say so, never re-dispatch it silently.
- **`idle`** with no PR → the session died before shipping. **Start one fresh
  session in that same workspace**, prompt exactly `/work-issue <ISSUE>` —
  work-issue is re-entrant and re-detects its stage from durable markers. Count
  it toward `max N`. A **second** silent death in the same workspace is
  **Blocked**: report the deep link and stop touching it.

A ticket in `<IN-PROGRESS>` with a branch or PR but **no** dispatch workspace is
someone else's work (mine, or a hand-run `/work-issue`) — leave it alone and
list it under Notes.

In `dry-run`, report the sweep's findings and stop; start no session.

## Step 1 — Select the queue

Scope is **my `<AGENT-READY>` tickets queued to start**: assignee `me`, team
`<TEAM>`, status `<READY>`, label `<AGENT-READY>`, limit 100. (Linear:
`list_issues` with those filters.) Match statuses by name and fall back to the
ids in `tracker.statuses` if names have drifted.

Then **drop**, in this order:

1. Any ticket carrying **`<SKIP>`** — PRD-pipeline-owned, never autonomous.
   (`daily-ticket-manager` should never have stamped `<AGENT-READY>` on one, but
   guard anyway.)
2. Any ticket carrying **`<HITL>`** — never both, but guard.
3. Any ticket **already dispatched** — a workspace named `<ISSUE> …` exists
   (the Resume sweep found it).
4. Any ticket **already claimed elsewhere**: an existing branch carrying the
   issue id (`git fetch --prune origin` first, then
   `git branch --all --list '*<issue-id>*'`), or a PR referencing the issue
   (`gh pr list --search "<ISSUE>" --state all`).
5. Any ticket carrying a **`## Autonomous solve — declined`** comment that
   `daily-ticket-manager` has not re-triaged since (no `<RISK:>` label). The
   decline already cleared `<AGENT-READY>`, so this should be unreachable — but a
   re-stamped trigger on an un-re-triaged decline is a ping-pong loop, and this
   guard is what breaks it. Report it as awaiting re-triage.

An `<AGENT:>` label naming a different agent is **no longer a reason to drop** a
ticket: the label picks the workspace's agent instead (Step 3). Report which
agent each ticket drew so the queue count adds up.

Sort the survivors **oldest-first** (by `createdAt`) and take the first **N**
(minus any sessions the sweep restarted).

Fetch each survivor with `get_issue` — the list description is truncated, and
the triage in Step 2 reads the real thing. **Do not** extract acceptance
criteria, write a contract, or plan an implementation: that is the dispatched
session's job, from the same ticket.

**An empty queue is a normal outcome** — report "no `<AGENT-READY>` tickets to
pick up" and stop. Never widen scope to invent work.

## Step 2 — Triage: dispatch or decline

`<AGENT-READY>` is `daily-ticket-manager`'s verdict from the ticket text alone.
This is the one cheap look at the *code* before an unattended agent is turned
loose on it, and it is the only reason this skill reads the repo at all.

Per surviving ticket, run **one read-only triage task** (leaner model; a
subagent where the runtime has them, else inline adopting the persona fresh):
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

### `escalate` → decline the ticket (apply only)

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
   manager's call now, made fresh against the decline note. The ticket stays in
   `<READY>` where the manager will find it.
4. Never dispatch a declined ticket. No workspace is created for it.

## Step 3 — Dispatch one workspace per ticket (apply only)

For each `dispatch` ticket, in parallel:

1. **Create the workspace** — `create_workspace` on the repo's project (or
   `conductor workspace create` from a sandbox):
   - **name** `<ISSUE> <short slug of the title>` — this name **is** the
     ownership marker every later run matches on, so the `<ISSUE>` prefix is not
     optional.
   - **branch** `<BASE>`. Conductor cuts the workspace's own branch from it,
     which is exactly the virgin checkout `/work-issue` demands (it creates no
     branch and no worktree of its own).
   - **agent** = the ticket's `<AGENT:>` label when it carries one, else this
     runtime's agent. `<CLOUD-MODEL>` as `model` + `effort`.
2. **Bootstrap session** — the sandbox is fresh and has no plugin, and skills
   load only at session start, so the plugin install must be its own session.
   Prompt, verbatim:

   > Bootstrap this workspace: install the agent plugin for your own CLI,
   > verify, and reply with exactly `BOOTSTRAP OK` or
   > `BOOTSTRAP FAILED: <reason>` — change nothing else in the repo.
   > Claude Code: `claude plugin marketplace add magnuskeinicke/agent-plugins
   > && claude plugin install magnus@magnus-skills`, verify with
   > `claude plugin list`. Codex: `codex plugin marketplace add
   > https://github.com/magnuskeinicke/agent-plugins.git &&
   > codex plugin add magnus@magnus-skills`.

   Wait for it to go idle — the **one bounded wait in this skill** (a few status
   checks over ~3 minutes; an install is seconds) — and read its last message.
   `BOOTSTRAP FAILED`, or not idle in that window → record the ticket as
   **dispatch failed** with the deep link and reason, and move on. Never paste
   ticket instructions inline and never implement the ticket here. (Usual cause:
   the sandbox's GitHub token cannot read the private plugin repo.)
3. **Work session** — a **new** session in that workspace, name `<ISSUE>`,
   agent + model as above, prompt **exactly**:

   ```
   /work-issue <ISSUE>
   ```

   Nothing else. No context paste, no acceptance criteria, no plan, no "and
   remember to…". The ticket is the contract and `/work-issue` reads it; every
   extra sentence is a chance to contradict the skill it is invoking.

That session now owns the ticket end to end: it claims it (clears
`<AGENT-READY>`, moves to `<IN-PROGRESS>`), implements it test-first inside the
bounded review loop, opens the draft PR with its evidence sections, runs
`/babysit-stack` to GOAL MET, and writes the ticket's one `## QA handoff`.
**This run touches none of that.** It does not claim the ticket, does not set a
status, does not wait for the work, and does not comment on the ticket or the PR.

**The claim window is real and accepted:** between dispatch and the session's
claim the ticket still carries `<AGENT-READY>`, so two dispatcher runs racing in
that window could both select it. The workspace-name check (Resume sweep,
Step 1 drop 3) closes it for every run that starts after the workspace exists —
which is why the workspace is created *before* the session, and why its name
must carry `<ISSUE>`. Do not paper over the window by claiming the ticket here:
the session's claim is what proves a real agent picked it up.

## Step 4 — Report

End every run with a compact summary, regardless of mode:

```md
# Autonomous solve — agent-ready queue
Mode: dry-run | apply   ·   In queue: <n>   ·   Dispatched now: <k of N>   ·   Already in flight: <r>

| Ticket   | Title         | Triage    | Outcome                                    |
| -------- | ------------- | --------- | ------------------------------------------ |
| <id-1>   | <short title> | dispatch  | workspace <deep link> · session working    |
| <id-2>   | <short title> | dispatch  | workspace <deep link> · draft PR #124      |
| <id-3>   | <short title> | escalate  | declined → re-triage (manager)             |
| <id-4>   | <short title> | —         | dispatch failed: BOOTSTRAP FAILED (<link>) |

## In flight
- <id-1> — <title> — <workspace deep link> — session working; it will open the PR, babysit it green and write the QA handoff itself.

## Needs me
- <id-4> — <title> — bootstrap failed; the workspace exists but nothing is running in it.
- <id-5> — <title> — draft PR #126 is green but the session ended without a QA handoff → it hit a needs-human blocker; open the PR.

## Declined — bounced back for re-triage
- <id-3> — <title> — <why triage escalated it; risk label cleared, still agent-ready in the queue for daily-ticket-manager>

## Notes
- <workspaces created; tickets left to other owners; prerequisites missing; anything skipped>
```

Use **deep links**, not ids — they are clickable, ids are not. This report is
the only place the run's own reasoning lives: nothing is written to a ticket but
a decline note, and nothing at all to a PR.

In `dry-run`, the table shows what *would* be dispatched and in what order; no
Outcome column actions are taken.

## Scheduling

Built to run unattended (e.g. nightly, after the morning `daily-ticket-manager`
run so the queue is fresh). Because it dispatches and ends, a scheduled run is
short and cheap — and it is also the sweep that reports on the previous run's
fan-out, so scheduling it daily is what keeps the workspaces visible.

The schedule prompt must be self-contained: name the scope (`my agent-ready
tickets, <TEAM>, <READY>`), the batch size (`max N`), and the mutation policy
(`apply` to dispatch, `dry-run` to just report the queue). Default a scheduled
run to `dry-run` unless I have explicitly approved `apply`. A scheduled `apply`
run still only ever: triages, writes decline notes, clears the declined tickets'
`<AGENT-READY>` + `<RISK:>` labels,
creates workspaces and starts sessions — never writing code, never claiming,
never merging, never marking done, never running compliance.

## Workflow Boundaries

**This skill drains the agent-ready queue by fanning it out: it selects, triages, and gives each ticket its own cloud workspace running `/work-issue`. It writes no code.**

- **DOES**: sweep the workspaces it already dispatched (restarting a session that died before shipping), select my `<AGENT-READY>` queue, run one read-only triage per ticket, decline the escalations with a three-line note + cleared `<AGENT-READY>`/`<RISK:>`, create one cloud workspace per remaining ticket (named `<ISSUE> …`, agent from its `<AGENT:>` label), bootstrap it, start one session whose whole prompt is `/work-issue <ISSUE>`, and report deep links
- **DOES NOT**: write, review, or fix code; create branches or worktrees; run the engine CLI, Playwright, or any gate; open, comment on, or babysit a PR; claim tickets (the session does); write anything on a ticket but a decline note; wait for the dispatched work; merge, mark PRs ready, approve, mark issues done, run compliance, create or close tickets; make routing calls on escalations (`daily-ticket-manager` re-classifies)

## Red Flags — STOP

- About to mutate anything in `dry-run`, or in an unattended run whose prompt didn't explicitly say `apply` — the mode is read-only; report only.
- About to implement, edit, test, or commit anything — **wrong skill**: this one dispatches. If Conductor is unreachable, stop and say so; never solve the ticket in this checkout.
- About to open a PR, request a bot, or run `/babysit-stack` — stop: the dispatched `/work-issue` session does all of it, on its own PR.
- About to claim a ticket (clear `<AGENT-READY>` or set `<IN-PROGRESS>`) — stop: the session claims. Your guard against double-grabbing is the `<ISSUE>`-named workspace.
- About to create a workspace whose name doesn't start with `<ISSUE>` — stop: that name is the ownership marker; without it the next run re-dispatches the ticket.
- About to put anything but `/work-issue <ISSUE>` in the work session's prompt — stop: no context paste, no criteria, no plan.
- About to write a `## QA handoff`, a `## QA evidence` table, acceptance criteria, a dispatch marker, or any comment other than a decline note on a ticket — stop: the ticket's one comment is the handoff, and its session writes it after GOAL MET.
- About to call `create_attachment_from_upload` or attach media to a ticket — stop: this skill produces no media.
- About to wait for a dispatched session to finish, or to poll it more than once — stop: dispatch and end; the next run is the sweep. The bootstrap wait is the only exception.
- About to re-dispatch a ticket that already has an `<ISSUE>`-named workspace — stop: restart a session *in that workspace* if it died, nothing more; a second silent death is Blocked.
- About to write labels without reading the current set first — `save_issue.labels` replaces the whole set; on a decline write it back minus exactly `<AGENT-READY>` and `<RISK:>`, nothing else. On a dispatch, write no labels at all.
- About to stamp `<HITL>` or route an `escalate` ticket yourself — decline instead: the three-line note, clear `<RISK:>*`, leave it in `<READY>`.
- Empty queue and tempted to widen scope — an empty queue is a valid result; report it and stop. Honor `<SKIP>` and `<HITL>` as hard exclusions even alongside `<AGENT-READY>`.

## Verification

Before reporting done:

- [ ] The Resume sweep ran **before** selection: every `<ISSUE>`-named workspace on the project was matched against the queue, checked once, and reported; no ticket with such a workspace was re-dispatched.
- [ ] Nothing in this run wrote, tested, or committed code, created a branch or worktree, ran the engine CLI, or touched a PR.
- [ ] No ticket was claimed here — every dispatched ticket still carried `<AGENT-READY>` and its old status when this run ended (its session clears them).
- [ ] Every dispatched ticket has exactly one workspace, named `<ISSUE> …`, whose work session's entire prompt is `/work-issue <ISSUE>` — after a bootstrap session that replied `BOOTSTRAP OK`.
- [ ] Zero suite comments on any ticket except the declines: `## Autonomous solve — declined`, three lines, updated by id. No tracker attachments anywhere.
- [ ] Declined tickets: `<AGENT-READY>` **and** `<RISK:>*` cleared in one additive write, every other label preserved, no routing label added, status still `<READY>`, no workspace created.
- [ ] The Step 4 report accounts for every queue ticket — dispatched, in flight, declined, failed to dispatch, or left to another owner — with **deep links**, and names every item that needs me.
- [ ] Nothing in the run merged, marked ready, marked done, or initiated compliance.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
