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
  never reuse a slice's workspace for the next slice when running work-slice
  by hand. `/feature-goal` is the exception by design: it runs the whole
  stack in **one pipeline workspace**, one fresh *session* per PR, and
  substitutes work-slice Step 2 (`feature-goal/references/pr-session.md`).
- **Fan-out parallelism is real**: file-disjoint deltas stacked on the skeleton
  (the `/to-issues` depth-2 topology) can run in parallel workspaces
  simultaneously. Chained slices cannot — each needs its predecessor's branch
  pushed first.
- **Babysitting has one home.** `/babysit-stack` keeps its cross-run state
  (attempt counters, failure signatures, per-bot round counters) in
  `.context/babysit-<parent>.json` — run every babysit for a given stack
  from the **same workspace**, or the caps reset and the per-bot round cap
  loses its memory. Pick one and stick with it — for a `/feature-goal` stack
  that is its pipeline workspace; for hand-run stacks, e.g. the skeleton's.

## Cloud dispatch — the full pipeline's default after planning

With `routing.dispatch` = `cloud` (the default), `/feature-goal` keeps
planning (grill → PRD → slices) in your session — local, or a cloud workspace
the grilling session was handed off to — and then runs the stack as a
**relay of fresh sessions in one pipeline workspace** (opt-in `local` keeps
it in your worktree — `feature-goal/references/local-loop.md`): the workspace
is created via the Conductor MCP (`create_workspace`, then a **bootstrap
session** installs the plugin + `gh-stack` in the fresh sandbox) or is simply
the handed-off one; then every PR gets its **own session** (`create_session`
from a local session, `/conductor/bin/conductor session create` from inside
the sandbox) that works one slice to a linked draft PR, babysits that PR to
GOAL MET, starts the next session and ends — no session outlives one PR, so
no agent's context fills up, and every layer is cut on a reviewed PR. The
last PR session starts the stack-wide babysit session. The durable marker is a
`## Cloud dispatch` comment on the slice ticket (workspace deep link, the
session that worked it, docs branch); a slice carrying it is relay-owned —
resume the relay, never implement it elsewhere. All stack branches live in
the pipeline workspace (so `gh stack` has local tracking and babysit has its
home there), and the held-branch hazard applies to your local checkout: that
workspace holds the stack's branches.

## Cloud fan-out — the autonomous queue's default

`/solve-ready-tickets` is the other cloud dispatcher, and it fans **out** where
feature-goal relays **along**: it triages my `<AGENT-READY>` queue and gives each
surviving ticket **its own cloud workspace**, named `<ISSUE> <slug>`, with a
bootstrap session and then one session whose entire prompt is
`/work-issue <ISSUE>`. Those workspaces are independent — different tickets,
different branches off `<BASE>`, no stack — so they run in parallel. Each session
owns its ticket end to end: claim, implement, draft PR, `/babysit-stack` to GOAL
MET, the ticket's one QA handoff.

The dispatcher then **ends**. There is no dispatch comment (a standalone ticket
is human-facing and takes exactly one suite comment, the handoff), so the
**workspace name is the ownership marker**: a re-run lists the project's
workspaces, matches `<ISSUE>` prefixes, and never re-dispatches a ticket that
already has one — it restarts a dead session inside that same workspace instead.
Rename such a workspace and the next run will dispatch the ticket twice.

`/work-issue` and `/daily-ticket-manager` stay venue-neutral: the user starts
them locally or in a cloud workspace, and nothing relocates them — being
*dispatched into* a fresh cloud workspace is just a normal `/work-issue`
invocation, which is why its virgin-worktree preflight fits a new workspace
exactly.

## Getting the plugin into a workspace

- **Local (Mac) workspace** — nothing to do. Plugins are user-scoped
  (`~/.claude`, `~/.codex`), shared by every worktree on the machine; install
  once per machine (README), not per workspace.
- **Cloud workspace via `/feature-goal`** — automatic: its dispatch runs the
  bootstrap session before the work session.
- **Cloud workspace created by hand** (Mac app, iOS, MCP outside
  feature-goal) — the sandbox is fresh and has no plugin. Paste this as the
  **first message**, then start a **new session** (skills load only at
  session start; the install never appears mid-session):

  > Bootstrap this workspace: install the agent plugin for your own CLI,
  > verify, and reply with exactly `BOOTSTRAP OK` or
  > `BOOTSTRAP FAILED: <reason>` — change nothing else in the repo.
  > Claude Code: `claude plugin marketplace add magnuskeinicke/agent-plugins
  > && claude plugin install magnus@magnus-skills`, verify with
  > `claude plugin list`. Codex: `codex plugin marketplace add
  > https://github.com/magnuskeinicke/agent-plugins.git &&
  > codex plugin add magnus@magnus-skills`.

  Never put the install in a host repo's shared `.conductor/settings.toml`
  setup script — it would run (and fail, private repo) for every colleague's
  workspace. The plugin stays personal: bootstrap message or feature-goal's
  automatic equivalent, nothing repo-shared.

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
- One babysit home per stack; one workspace per slice for hand-run
  work-slice (one pipeline workspace, one session per PR, for
  `/feature-goal`); one agent per workspace at a time.

## Workflow Boundaries

**This skill maps and plans Conductor workspace usage for the suite — it never provisions anything.**

- **DOES**: plan the workspace-per-slice layout, match labelled slices to agent-matched workspaces, explain what state travels (tracker/remote) vs what doesn't (`.context/`), pick the babysit home, name the cross-workspace hazards
- **DOES NOT**: create workspaces (the user's or Conductor MCP's act), create branches or worktrees (`/work-slice` renames in place; single-worktree mode is `/feature-goal`'s), or babysit PRs itself (`/babysit-stack`)

## Red Flags — STOP

- About to `git worktree add` and call it a workspace — stop; bootstrap scripts wouldn't run; workspace creation is the user's (or the Conductor MCP's) act.
- About to start a labelled slice under a different agent — stop; the routing gate bounces it; never "just this once" elsewhere.
- About to run `/babysit-stack` for a stack from a new workspace — stop; use the stack's one babysit home or the caps and per-bot round counters reset.
- About to `gh stack sync --prune` while sibling branches are checked out in other workspaces — stop; it deletes branches under live worktrees; plain `--remote origin` sync only.
- About to check out or fix a branch held by another workspace — stop; git refuses; fix it in the owning workspace or hand it to that workspace's agent.
- About to reuse a slice's workspace for the next slice when running work-slice by hand — stop; start a fresh workspace per slice (only `/feature-goal`'s pipeline workspace hosts a whole stack, one fresh session per PR).
- About to re-`init` an engine loop because the finished ledger lives in another workspace — stop; one engine run per PR, ever.
- About to rename a workspace directory or commit `.context/` — stop; paths are load-bearing and `.context/` stays in `.git/info/exclude`.

## Verification

Before reporting done:

- [ ] Hand-run: one workspace per slice — none planned to host two slices, or two agents at once. `/feature-goal`: one pipeline workspace, sessions strictly sequential, one per PR
- [ ] Every labelled slice is matched to a workspace running that agent; unlabelled slices marked any-agent
- [ ] Only file-disjoint skeleton deltas run in parallel; each chained slice waits for its predecessor's push
- [ ] Exactly one babysit home named per stack
- [ ] Any agent handoff is sequential: commit + push + checkpoint before the other workspace opens the branch
- [ ] No workspaces, worktrees, or branches were created by this skill
