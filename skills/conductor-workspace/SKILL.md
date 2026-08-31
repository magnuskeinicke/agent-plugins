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

## Cloud dispatch — the full pipeline's default

With `routing.dispatch` = `cloud` (the default), `/feature-goal` creates the
workspace-per-slice layout above **remotely**: the Conductor MCP's
`create_workspace` makes one isolated cloud workspace + first session per
slice, first prompt `/work-slice <slice-id>` — so slices keep running while
the user is away. The durable dispatch marker is a `## Cloud dispatch`
comment on the slice ticket (workspace deep link + session id); it is the
cross-machine double-dispatch guard, and a slice carrying it is cloud-owned —
resume or nudge that session, never implement it elsewhere. In cloud mode
the babysit home is the **skeleton slice's cloud workspace**, and the
held-branch hazard applies to your local checkout too: the cloud workspaces
hold the stack's branches.

The standalone commands (`/work-issue`, `/solve-ready-tickets`,
`/daily-ticket-manager`) are venue-neutral by design — the user starts them
locally or in a cloud workspace, and no skill relocates them.

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

## Workflow Boundaries

**This skill maps and plans Conductor workspace usage for the suite — it never provisions anything.**

- **DOES**: plan the workspace-per-slice layout, match labelled slices to agent-matched workspaces, explain what state travels (tracker/remote) vs what doesn't (`.context/`), pick the babysit home, name the cross-workspace hazards
- **DOES NOT**: create workspaces (the user's or Conductor MCP's act), create branches or worktrees (`/work-slice` renames in place; single-worktree mode is `/feature-goal`'s), or run babysit passes itself (`/babysit-stack`)

## Red Flags — STOP

- About to `git worktree add` and call it a workspace — stop; bootstrap scripts wouldn't run; workspace creation is the user's (or the Conductor MCP's) act.
- About to start a labelled slice under a different agent — stop; the routing gate bounces it; never "just this once" elsewhere.
- About to run a babysit pass for a stack from a new workspace — stop; use the stack's one babysit home or the caps and once-ever gate reset.
- About to `gh stack sync --prune` while sibling branches are checked out in other workspaces — stop; it deletes branches under live worktrees; plain `--remote origin` sync only.
- About to check out or fix a branch held by another workspace — stop; git refuses; fix it in the owning workspace or hand it to that workspace's agent.
- About to reuse a slice's workspace for the next slice — stop; start a fresh workspace per slice.
- About to re-`init` an engine loop because the finished ledger lives in another workspace — stop; one engine run per PR, ever.
- About to rename a workspace directory or commit `.context/` — stop; paths are load-bearing and `.context/` stays in `.git/info/exclude`.

## Verification

Before reporting done:

- [ ] One workspace per slice — none planned to host two slices, or two agents at once
- [ ] Every labelled slice is matched to a workspace running that agent; unlabelled slices marked any-agent
- [ ] Only file-disjoint skeleton deltas run in parallel; each chained slice waits for its predecessor's push
- [ ] Exactly one babysit home named per stack
- [ ] Any agent handoff is sequential: commit + push + checkpoint before the other workspace opens the branch
- [ ] No workspaces, worktrees, or branches were created by this skill
