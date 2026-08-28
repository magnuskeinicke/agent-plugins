---
name: conductor-workspace
description: >
  Operating manual for running the suite across Conductor workspaces — the
  workspace-per-slice layout, which agent to start per slice (routing labels),
  where suite state lives and why it doesn't travel between workspaces, and
  the cross-workspace hazards (held branches, prune syncs, split babysit
  state). Use when the user asks "set up workspaces for this stack", "which
  workspace/agent should take this slice", "why is my ledger/checkpoint gone",
  "can I resume this in another workspace", or plans parallel slice work in
  Conductor.
---

# Conductor Workspace

Conductor runs many agents in parallel, one isolated git worktree ("workspace")
each, every workspace with its own gitignored `.context/` directory. The suite
is built for exactly this shape — durable markers on the tracker/branches/PRs,
re-entrant skills — but three things are workspace-local and two hazards are
cross-workspace. This is the map.

## Layout — one workspace per slice

- **`/work-slice` expects a virgin Conductor workspace per slice**: it renames
  the checked-out branch in place and re-points it at the predecessor — it
  never creates worktrees or branches. Start a fresh workspace per slice;
  never reuse a slice's workspace for the next slice (that's `/feature-goal`'s
  single-worktree mode, which substitutes work-slice Step 2).
- **Fan-out parallelism is real**: file-disjoint deltas stacked on the skeleton
  (the `/to-issues` depth-2 topology) can run in parallel workspaces
  simultaneously. Chained slices cannot — each needs its predecessor's branch
  pushed first.
- **Babysitting has one home.** `/babysit-stack` keeps its cross-pass state
  (attempt counters, failure signatures, bot-request flags) in
  `.context/babysit-<parent>.json` — run every babysit pass for a given stack
  from the **same workspace**, or the caps reset and the bot-request
  once-ever gate loses its memory. Pick one (e.g. the skeleton's) and stick
  with it.

## Which agent takes a slice

With `routing.labelPrefix` configured (see the plugin CONTRACT.md), slices
carry `<prefix><agent>` labels — e.g. `agent:claude` on frontend-dominant
slices when `routing.frontendAgent` is `claude`. When starting a workspace for
a slice:

- **Labelled slice** → start the workspace with that agent. Work-slice's
  routing gate refuses the slice in any other runtime, so a mismatched
  workspace just bounces.
- **Unlabelled slice** → any agent.
- Conductor supports multiple agent providers per project — pick the agent at
  workspace creation. The `/to-issues` quiz table shows each slice's routing
  up front, so the whole stack's workspace plan is readable before any code.

## State locality — what travels, what doesn't

| State | Lives in | Travels between workspaces? |
| --- | --- | --- |
| Tracker tickets, labels, comments, QA evidence | the tracker | ✅ |
| Branches, commits, PRs, PR comments | the remote | ✅ (after push) |
| `## Workflow State` checkpoints, engine ledger + findings, babysit state | that workspace's `.context/` | ❌ gitignored, workspace-local |

Consequences:

- **Resume a slice in the workspace that started it** whenever possible — the
  checkpoint and the engine's run state are there.
- A **fresh workspace can still resume** any slice: every skill re-derives its
  stage from durable markers (branch, PR, tracker state, engine `status` on
  whatever `.context/` exists). What's lost is the review-loop history — and
  the "one engine run per PR, ever" rule still holds: a finished run's ledger
  in another workspace is not a licence to re-`init` the loop here.
- `.context/` must stay out of commits — every workspace appends it to
  `.git/info/exclude` before writing state (the babysit rule); never commit
  another workspace's state files either.

## Cross-workspace hazards

- **Held branches.** A branch checked out in another workspace cannot be
  checked out here (git refuses; the babysit rule flags such fixes
  `needs-human`). Fix a slice's CI/review findings in the workspace that owns
  its branch, or hand the fix to that workspace's agent.
- **Prune syncs.** Never `gh stack sync --prune` (or any branch-pruning sync)
  while sibling stack branches are checked out in other workspaces — it
  deletes branches under a live worktree. Plain `--remote origin` sync only.
- **Renamed directories.** Never rename a workspace's directory — path-keyed
  dev stacks, Conductor's tracking, and running dev servers all break
  (work-slice's rule; same reason its branch rename leaves the dir alone).
- **Two agents, one workspace: never.** Handing a slice from one agent to
  another means: commit + push, let the first agent end its invocation
  (checkpoint written), then open the branch in the other agent's workspace —
  sequential handoff over durable markers, never concurrent editing.

## Boundaries

- This skill describes and plans; **creating workspaces is the user's (or the
  Conductor MCP's) act** — never fake one with `git worktree add` and call it
  a workspace (bootstrap scripts wouldn't run; the suite's assumptions break).
- Routing labels are honoured here exactly as in work-slice: a labelled slice
  goes to a workspace running that agent, never "just this once" elsewhere.
- One babysit home per stack; one workspace per slice; one agent per
  workspace at a time.
