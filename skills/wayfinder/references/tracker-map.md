# The map on the tracker

The tracker is the canonical and only shared state of a wayfinder effort, so a
session in any workspace — local or cloud — sees the same map. This file owns
the shapes and the operations. `<TRACKER>` = Linear by default; the GitHub
fallback is at the end.

## Audiences

The seed — a ticket or a whole project — and every feature ticket are
**human**: a project's description, milestones, documents and status updates
are never written either. Seed and feature tickets are **human
tickets** (`../../work-slice/references/qa-handoff.md`): wayfinder never writes
the description or comments of an existing one. It only adds link metadata
(the map as a sub-issue of the seed, related links to feature tickets), which
`../../work-slice/references/issue-lifecycle.md` keeps outside the comment
budget. A missing feature ticket is created at clear time the way `/to-prd`
creates one with no seed. The map
and its decision tickets are the suite's own: write what the work needs there.

## Labels

| Label | On | Meaning |
| --- | --- | --- |
| `wayfinder:map` | the map | the canonical map issue |
| `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task` | each decision ticket | its type — the body never states it |
| `<SKIP>` | map + every ticket | keeps `daily-ticket-manager` off them |

Create a missing label once on the team (muted grey, e.g. `#6b7280`). Add
labels, never replace. Never apply `<AGENT-READY>`, the slice pointer, a type
label from `labels.typePrefix`, or a routing label: these are decisions, not
units of agent work.

## The map issue

- **Title:** `Wayfinder: <destination in a few words>`.
- **Parent:** the seed issue when there is one. A **project** seed has no
  parent issue: put the map in that project instead (Linear `project`). Either
  way, same team and project as the seed. A project spanning several teams →
  `tracker.team` if it is one of them, else the project's lead team; say which.
- **Assignee:** the driver (the user charting it). **Status:** `<IN-PROGRESS>`
  while active, `<DONE>` once clear.
- **Description** — the whole effort at low resolution, loaded once per
  session. Open tickets are **not** listed; they are the open sub-issues.

```markdown
## Destination

<one or two lines: what reaching the end of this map looks like>

## Notes

- Driver: <name>
- Seed: [<seed issue or project name>](url) (issue | project)
- Constraints: <project milestones and target date, other deadlines>
- Docs branch: `wayfinder/<map-id-lowercase>`
- Consult: <skills or docs every session should read, standing preferences>

## Decisions so far

<!-- one line per resolved ticket: link + gist of the answer, never the reasoning -->

## Not yet specified

<!-- in-scope fog that cannot be stated as a precise question yet -->

## Out of scope

<!-- work consciously ruled beyond the destination; canceled tickets linked here with why -->

## Handoff

Status: ACTIVE

## Workflow ownership

Workflow: wayfinder
Feature: <seed issue id and URL | "project <name> <URL>" | "none">
Role: map
```

Edit the description with `patch` operations (insert into one section, replace
one line) rather than rewriting it whole, so concurrent sessions do not
clobber each other's lines. Re-read after every write.

### Handoff when clear

```markdown
## Handoff

Status: CLEAR

| Order | Feature | Inherits | Notes |
| --- | --- | --- | --- |
| 1 | [<feature title>](url) | [<decision title>](url), … | <build-order reason, open assumption> |

Docs branch: `wayfinder/<map-id-lowercase>` | none (no doc changes were pushed)
```

`/feature-goal` reads this table: a feature listed under a CLEAR map runs a
delta grill on top of the decisions it inherits. A feature under an ACTIVE map
is not ready. `/feature-goal` finds the map as a related issue of the feature
ticket, a `wayfinder:map` sub-issue of the feature's parent, or a
`wayfinder:map` issue in the feature's project — keep these links in place. Charting relates the existing feature tickets the map covers;
clearing relates the rest.

## Decision tickets

- **Title:** the decision as a short imperative ("Decide rollout strategy",
  "Find which settings the AI endpoint supports").
- **Parent:** the map. Same team and project. Unassigned until claimed.
- **Status:** the team's unstarted/backlog state. Claimed → `<IN-PROGRESS>`;
  resolved → `<DONE>`; out of scope → the team's canceled state.
- **Blocking:** the tracker's native relation (Linear `blockedBy`), so the
  frontier shows in the tracker's own UI. Mirror it in the body's `Blocked by`
  line for readers.

```markdown
## Question

<the one precise question; sized to one agent session>

## Why it is on the route

<what this answer changes or unblocks on the way to the destination>

## Decider

<HITL: the person who must answer — and why | AFK: agent>

Blocked by: <ticket links, or none>

## Workflow ownership

Workflow: wayfinder
Map: <map id and URL>
Role: decision
```

## Create, then wire

1. Create the map. Re-read it.
2. Create every specifiable ticket under it with its full body except blocker
   links.
3. Second pass: set native blockers and the `Blocked by` lines with **real**
   ids (a placeholder like `#<n>` auto-links to an unrelated issue).
4. Re-read the map's children and their relations; fix any mismatch.

On an interrupted chart, resume from what exists: never create a second map or
a duplicate ticket for the same question (search the map's children by title
first).

## Frontier

The frontier is the map's sub-issues that are open (not done, not canceled),
**unassigned**, and whose every blocker is done. Order is creation order.
In Linear: `list_issues` with `parentId` = map (`orderBy: createdAt`), then
`get_issue` with `includeRelations` for each open candidate's `blockedBy`.

## Claim

Assignee alone cannot tell two sessions of the same person apart, so a claim
is three writes, then a check:

1. Set assignee = the driver and status `<IN-PROGRESS>`.
2. Comment `wayfinder:claim <workspace or session id> <ISO time>`.
3. Re-read the comments. If an earlier unreleased claim from another session
   exists, comment `wayfinder:release <your id> (yielded)` and yield — touch
   nothing else: the assignee and status belong to the winning claim.

Release = comment `wayfinder:release <id>`; a resolution comment also releases.
Clear someone else's claim only with that session's release or the user's
explicit reassignment, recorded as a comment. When releasing without
resolving, unassign and return the ticket to its unstarted state **only if no
other unreleased claim remains** on it.

## Resolution comment

```markdown
## Resolution

**Answer:** <direct answer to the question>

**Evidence:** <links to research docs, prototype, code, sources> | Confirmed by <decider> (<present | relayed by <driver>>)

**Implications:** <what this decides for the route; constraints later tickets inherit>

**Map changes:** <new tickets | fog graduated | blockers changed | scope ruled out | none>
```

Long research output goes into a tracker document attached to the ticket
(Linear `save_document` with `issue`), linked from **Evidence** — not pasted.

## Docs branch

`CONTEXT.md` and `docs/adr/` changes from grilling and prototype tickets must
reach later sessions in other workspaces, so every map has one docs branch,
`wayfinder/<map-id-lowercase>` (named in Notes). Never check that branch out
by name — another worktree may hold it. Per session, before the grill:

```bash
git status --porcelain            # must be empty; otherwise stop and ask
git fetch origin
if git ls-remote --exit-code origin refs/heads/<docs-branch> >/dev/null; then
  start=origin/<docs-branch>
else
  start=<BASE>
fi
if git show-ref --verify --quiet refs/heads/wf-<ticket-id-lowercase>; then
  git switch wf-<ticket-id-lowercase>      # resuming this ticket here
else
  git switch -c wf-<ticket-id-lowercase> "$start"
fi
```

After the resolution, if docs changed: commit only those files (subject per the
repo's commit rule, type `docs`), then `git push origin HEAD:refs/heads/<docs-branch>`.
On a non-fast-forward reject: `git fetch origin`, `git rebase origin/<docs-branch>`,
push again. A rebase conflict in `CONTEXT.md` keeps both sides' entries (the
glossary is additive; reconcile a term both sides defined with the decider's
wording from the resolution comments); an ADR number collision renumbers this
session's ADR to the next free number. Read the remote head back and cite it in the resolution's
**Evidence**. Never open a PR from it; `/feature-goal` merges it into its
planning branch.

## GitHub Issues fallback

Map and tickets are issues with the same labels and bodies. Parent/child uses
GitHub sub-issues (`gh api repos/{owner}/{repo}/issues/<map>/sub_issues`).
A project seed is
Linear-only — on GitHub, seed with an issue or an idea. Blocking uses GitHub
issue dependencies where the repo has them; otherwise the
body's `Blocked by` line is authoritative. Resolved = closed as completed; out
of scope = closed as not planned. Claims, comments and the docs branch work as
above.
