---
name: wayfinder
description: >
  Chart an initiative too big or too foggy for one grilling session (a whole
  settings page, a multi-feature project) as a decision map on the issue
  tracker, then resolve its decision tickets one per session until the route
  is clear and each feature can enter /feature-goal. The map is a tracker
  issue labelled wayfinder:map; its research, prototype, grilling and task
  tickets are sub-issues with native blocking, so any local or cloud session
  can pick up the frontier. Plans, never builds. Use when the user says "chart
  this", "wayfind this project", "this is too big for one grill", "map out the
  decisions for X", "work the next wayfinder ticket", or runs /wayfinder with
  an idea, a seed ticket, a whole tracker project, or an existing map.
argument-hint: "[seed issue id | project:<name|id|url> | idea] | [map issue id] [ticket id]"
---

# Wayfinder

A loose idea has arrived that is too big for one agent session and wrapped in
fog: the way from here to the **destination** is not visible yet. Wayfinding
finds that way instead of charging at the destination. It charts a **map** on
the tracker, then resolves **decision tickets** — questions whose answer is a
decision, not slices of a build — one per session, until nothing consequential
is left to decide. Then it hands off to the normal pipeline.

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md)
before launching workers or sessions. Use the registry role for `wayfinder`;
supporting skills inherit the caller's resolved role.

Read [references/tracker-map.md](references/tracker-map.md) before any tracker
write — it owns the map and ticket bodies, labels, statuses, claims, blocking
and the frontier query. Read [references/ticket-types.md](references/ticket-types.md)
before creating or resolving a ticket.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block) and the prose
docs it points at (`tracker.docPath`, `labels.docPath`). Missing file or empty
key → use the fallback and say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<TEAM>` | `tracker.team` / `tracker.teamId` | the seed ticket's team; else ask once |
| `<BASE>` | `integrationBranch` | `$CONDUCTOR_DEFAULT_BRANCH`, else `origin/HEAD` |
| `<SKIP>` | `labels.managerSkip` | no triage opt-out — say so; daily triage may then see the tickets |
| `<AGENT-READY>` | `labels.agentReady` | nothing to avoid |
| `<IN-PROGRESS>` / `<DONE>` | `tracker.statuses.inProgress` / `.done` | discover per `../work-slice/references/issue-lifecycle.md` |

## Plan, don't do

Every ticket resolves a decision; the map is done when the way is clear and
nothing is left to decide before someone builds. The pull to just build is the
signal you have reached the edge of the map — hand off. Only a `task` ticket
acts, and only to unblock a decision. A map's `## Notes` may explicitly carry
execution into the map; absent that, produce decisions, never deliverables.

**Refer by name.** In everything the human reads, a map or ticket is its
title with the id riding inside the link — `[Decide rollout strategy](url)`,
never a bare wall of `SER-1801, SER-1802`.

**The driver decides.** The driver — the user who charted the map — is the
only decider on it. Every HITL ticket is theirs to answer; never name,
assign or route a ticket to anyone else, even when the question touches a
colleague's area or another team's work. What someone else knows is input:
research it, or leave it to the driver to ask them. The decision is the
driver's.

## Step 1 — Classify the invocation

- **Chart mode** — the argument is an idea or a **seed**: a ticket that is not
  a `wayfinder:map`, or a whole tracker **project**. Resolve the seed kind:
  - **Project** — `project:<name>`, a project URL (`…/project/<slug>`), or a
    project identifier (Linear `P-…`). A bare name that matches both a project
    and an issue → ask once which one; recommend the project when the issue is
    only its umbrella ticket.
  - **Issue** — an issue id or URL.
- Read the seed before saying anything. Issue: its description and links
  (sibling tickets, the project, prototypes, designs). Project: its
  description, milestones and target date, resources and documents, recent
  status updates, and **every issue in it** (titles, states, assignees,
  parents, relations — bodies only where they matter). Milestones and the
  target date go into the map's Notes as constraints.
- **Work mode** — the argument is a `wayfinder:map` issue, optionally followed
  by one of its tickets. With no argument, look for a map in the conversation;
  otherwise ask for the idea or the map.
- A seed issue with an open `wayfinder:map` sub-issue, or a seed project
  containing an open `wayfinder:map` issue → work mode on that map. Never
  chart a second map for the same seed.

## Step 2 — Chart the map (chart mode only)

1. **Name the destination** with the user, running `/grill-with-docs` seeded
   with the seed ticket, scoped to this one question: what does reaching the
   end of this map look like? The default for this suite is **a feature split
   ready for `/feature-goal`**: the initiative cut into ordered features, each
   with its cross-feature decisions settled (scope cut, data/API contracts,
   rollout, shared building blocks). It may instead be a single decision or a
   spec. The destination fixes the scope, so settle it first.
2. **Map the frontier, breadth-first.** Fan out across the whole space —
   product, domain, data, API, UI, rollout, dependencies on other people's
   tickets — rather than deep on one thread. Explore the codebase and the
   tracker for anything they can answer. Surface the open decisions and the
   first steps takeable now.
3. **Not-needed gate.** If no meaningful fog remains — the route is clear and
   one grilling session can hold it — stop with `WAYFINDER NOT NEEDED` and
   recommend `/feature-goal <seed>` (or `/work-issue` for a lean ticket).
   Create nothing.
4. **Create the map**, then **the tickets you can specify now**, then wire
   blocking in a **second pass** (ids must exist before they can reference
   each other), per `references/tracker-map.md`. Sketch the rest into
   **Not yet specified**; put consciously excluded work under **Out of scope**.
   Link existing human tickets the map covers (every open feature ticket in
   a seed project, or sibling tickets of a seed issue — e.g. an AI-assist
   ticket under a settings-page effort) to the map as related, so `/feature-goal` on them waits for the map. Re-read
   the map and every ticket and confirm labels, parents, links, blockers and
   bodies match before reporting.
5. **Fire the research.** For each unblocked `research` ticket, launch a fresh
   subagent (explorer role) that claims and resolves exactly that ticket per
   Step 4 and the research rules in `references/ticket-types.md`. Research is
   the only type that may resolve in the charting session or in parallel.
6. **Stop.** Report the map, its destination, the frontier (by name, with
   type — HITL or AFK), the fog, and the command that works the next ticket:
   `/wayfinder <map>`. Charting hand-resolves nothing beyond step 5.

## Step 3 — Pick and claim one ticket (work mode)

1. Load the map at low resolution: its description, the open sub-issues with
   their labels/assignee/state, and their blocking relations. Do not read
   every ticket body or every resolution — zoom only when a decision matters
   to the current question.
2. **Reconcile first.** A ticket that is done but missing from **Decisions so
   far**, a graduated fog line still listed, a closed out-of-scope ticket
   missing from **Out of scope** → repair the map description and say so.
3. **Choose.** A named ticket is honoured only when it is on the frontier;
   otherwise report exactly why (blocked by whom, claimed by whom, resolved,
   out of scope, not on this map) and stop — never silently take another.
   With no named ticket, take the first frontier ticket in creation order.
4. **Claim before any work**, per `references/tracker-map.md`: assignee +
   `<IN-PROGRESS>` + a claim comment, then re-read. A competing earlier claim
   → yield and pick the next frontier ticket or stop. Never infer that a claim
   is abandoned from elapsed time; clear one only on its owner's release or the
   user's explicit say-so.
5. **HITL check.** A HITL ticket is decided by the driver. If the person in
   this session is not the driver, say so and stop. The driver may bring in
   what others told them — record that as evidence — but the recorded answer
   is the driver's. Never answer for the driver.

## Step 4 — Resolve the claimed ticket

1. Work only the claimed question, as its `wayfinder:<type>` label says —
   read the label, not the body. Follow the type's rules in
   `references/ticket-types.md`; consult any skills the map's `## Notes` name.
2. **Grilling and prototype tickets write repo docs.** `/grill-with-docs`
   updates `CONTEXT.md` and `docs/adr/` as decisions crystallise. Before the
   grill, cut the per-ticket `wf-<ticket>` branch from the map's docs branch;
   after it, push the doc commits to the docs branch — both per "Docs branch"
   in `references/tracker-map.md` — so later sessions in any workspace, and
   the eventual `/feature-goal` grill, read them.
3. **Record the resolution** in this order (retry-safe — on resume, a ticket
   that already has a resolution comment is never investigated again):
   1. Post the resolution comment on the ticket (format in
      `references/tracker-map.md`), linking assets — never pasting large ones.
   2. Move the ticket to `<DONE>` and release the claim.
   3. Append one line to the map's **Decisions so far**:
      `- [<ticket title>](url): <one-line gist of the answer>`.
   4. Create newly sharp tickets (create, then wire blockers), graduate the
      fog they came from (remove those lines), and move anything the answer
      shows is beyond the destination to **Out of scope** — closing such a
      ticket as canceled rather than resolving it. If the decision invalidates
      other open tickets, rewrite or cancel them and say so.
4. Keep secrets, credentials, patient or other private data and raw logs out
   of every tracker write; record safe locations or redacted facts instead.

## Step 5 — Stop, or clear the map

The map is **clear** only when no open ticket remains, **Not yet specified**
is empty, and reaching the destination needs no further consequential
decision.

- **Still active** → report the resolved ticket and its one-line answer, the
  evidence or who confirmed it, the newly unblocked tickets, the remaining fog,
  and `/wayfinder <map>` for the next one. **Stop, even if another ticket is
  ready** — each belongs to its own session.
- **Clear** → fill the map's `## Handoff` (format in `references/tracker-map.md`):
  one row per feature, each naming its feature ticket, the decisions it
  inherits and its build order. A feature with no ticket yet gets one only
  after the user confirms the list in this session, created the way `/to-prd`
  creates a missing feature ticket (title + a few user-facing lines of problem
  and outcome, no dev material, per `tracker.docPath`).
  Link each feature ticket to the map as related, move the map to `<DONE>`,
  and emit a `WAYFINDER CLEAR` brief: destination, every decision gist with its
  link, remaining assumptions, the docs branch, and the next command per
  feature — `/feature-goal <feature>` in the handoff order. Do not start it.

## Running across workspaces

The tracker is the only shared state, so any session — local, another
Conductor workspace, or a cloud session — can work the map. Use a clean
workspace; the docs branch carries `CONTEXT.md`/ADR changes between them.
HITL tickets need the driver in the session. Claims keep concurrent
sessions off each other's tickets.

**Dispatching AFK tickets to the cloud** (only when the user asks):

1. Reuse the map's cloud workspace if `## Notes` records one. Otherwise create
   one Conductor cloud workspace with `branch` = `<BASE>` (never omit it), named
   `<map id> wayfinder`, whose first session bootstraps: install the plugin for
   the runtime (step 2 of the bootstrap checklist in
   [the cloud relay contract](../feature-goal/references/cloud-relay.md)),
   verify the tracker connector can read and write, and reply `BOOTSTRAP OK`.
   Record the workspace id in the map's Notes.
2. Start one fresh session per AFK frontier ticket with the entire message
   `/wayfinder <map> <ticket>`, using the model and effort from
   `node "$engine" model --skill wayfinder --runtime <runtime> --cloud`.
   Research tickets may run side by side; AFK task tickets one at a time.
3. Check each session reaches working within three minutes (60-second checks),
   report the deep links, and **stop** — never poll it. The next
   `/wayfinder <map>` reconciles the map from the tracker.

## Workflow Boundaries

**This skill charts and resolves a tracker-native decision map, one ticket per session, until an initiative is ready for `/feature-goal`.**

- **DOES**: name the destination with the user; chart the map, its tickets,
  native blockers, fog and scope; fire research subagents at chart time; claim
  and resolve one frontier ticket per session; push grill doc changes to the
  map's docs branch; graduate fog; clear the map into a feature handoff.
- **DOES NOT**: implement, prototype into production code, open PRs, run
  `/to-prd`, `/to-issues` or `/feature-goal`, write on a human ticket beyond
  related links (the seed and feature tickets stay theirs), apply
  `<AGENT-READY>` or any routing label, answer a HITL ticket for the driver, or
  name or assign anyone but the driver as a ticket's decider.

## Red Flags — STOP

- About to resolve a second non-research ticket in this session — stop; report and end.
- About to answer a grilling or prototype question yourself — stop; HITL tickets resolve only through the driver.
- About to name someone other than the driver as a decider, or assign a ticket to them — stop; the driver decides everything on the map.
- About to work a ticket you have not claimed, or one claimed by another session — stop; claim or yield.
- About to restate a decision's reasoning on the map — stop; the map gists and links, the ticket holds the detail.
- About to pre-slice fog into speculative tickets — stop; ticket only questions you can state precisely now.
- About to write code, a PRD or slices for the destination — stop; you have reached the edge of the map — hand off.
- About to chart a map when one grilling session would hold the whole route — stop; `WAYFINDER NOT NEEDED`.
- About to write a comment or description on the seed or a feature ticket — stop; only related links.
- About to leave `CONTEXT.md` / ADR changes unpushed — stop; push them to the docs branch.

## Verification

Before reporting done:

- [ ] Chart: exactly one open `wayfinder:map` under the seed, with Destination, Notes (driver, seed, docs branch), empty Decisions so far, fog and scope sections; every ticket a sub-issue with one `wayfinder:<type>` label, `<SKIP>`, a precise question, HITL (driver) or AFK (agent) as its decider, no assignee but the driver, and native blockers that match the body.
- [ ] Work: exactly one non-research ticket was claimed and resolved this session; its resolution comment, `<DONE>` status, released claim and Decisions-so-far line all exist; graduated fog was removed; new tickets were wired.
- [ ] No HITL answer was invented; every HITL resolution is confirmed by the driver; no ticket names or is assigned to anyone else.
- [ ] Doc changes, if any, are pushed to the docs branch and the push was read back.
- [ ] No ticket carries `<AGENT-READY>` or a routing label; no human ticket got a comment or description edit.
- [ ] The report names tickets by title, states the frontier and fog, and ends with the next command — or, when clear, `WAYFINDER CLEAR` with the per-feature `/feature-goal` order.
