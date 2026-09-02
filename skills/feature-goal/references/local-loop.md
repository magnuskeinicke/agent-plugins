# Local loop — opt-in slice venue for `/feature-goal`

Default `/feature-goal` runs everything after planning in the cloud
(SKILL.md, "Stage SLICE-LOOP" / "Stage BABYSIT"). This reference is the
**opt-in** alternative: `routing.dispatch: "local"` in `repo-config.md`, the
user says `local` (argument or conversation), or the Conductor MCP is
unreachable (fallback, announced once). Every slice is then implemented in
**this one worktree**, walking up the stack, each by a **freshly spawned
subagent** that has never seen another slice's reasoning — the same
writer-spawn ladder work-slice uses (Claude → a subagent per slice, strongest
model; Codex → a `codex exec` child per slice; neither → inline as a fresh
persona, disclosed once). You, the orchestrator, do the tracker + git
choreography around it and **never implement a slice yourself**.

The mode choice never forks work: a slice already dispatched to the cloud (its
`## Cloud dispatch` ticket comment exists) stays cloud-owned even after a
fallback — resume or nudge its session; never re-implement it here.

Work-slice assumes Conductor handed it a fresh worktree per slice and *renames*
the branch checked out there; here branches are **created** instead, so its
Step 2 is substituted below. Everything else is work-slice verbatim.

## Per slice, in stack order, until none remain

1. **Select + claim** (work-slice Step 1) — pick the `<NEXT>` carrier
   (fallback: earliest slice in stack order whose predecessors all have an
   open or merged PR and that is not done / in progress), fetch slice + parent
   PRD + Skeleton-map comment, clear `<NEXT>` (additive label write), set
   status **`<IN-PROGRESS>`**. A `<HITL>` label is **not a gate**: note the
   decision text — the subagent gets it as an assumption to make and record.

   **Slice reserved for another agent** (`<AGENT:><name>`, `<name>` ≠ this
   runtime): `routing.delegate.<name>` configured → **delegate**: run that
   command template as a child process with the prompt `/work-slice
   <slice-id>` (it does its own Steps 1–2 in the child — skip step 2 below),
   wait for exit, then verify the slice's durable markers exactly as in step
   4. No delegate configured → this runtime works it via the loop below and
   the report + PR comment say `routing label <AGENT:><name> not honoured: no
   routing.delegate.<name> configured`. Never delegate below slice granularity.
2. **Branch (replaces work-slice Step 2).** Name
   `<project-slug>/<NN>-<issue-id>` (kebab-cased project name, zero-padded
   stack-order index, slice id). One-time, before the first slice:
   `git config rerere.enabled true`, `git config remote.pushDefault origin`.
   - **First slice, virgin worktree branch** (nothing ahead of `<BASE>` beyond
     the planning-doc commits: `git diff <BASE>...HEAD --name-only` empty or
     only `CONTEXT.md` / `docs/adr/**` / `docs/agents/**`, else STOP — that is
     a safety stop, not a gate): rename in place, `git branch -m
     <stack-name>`, remembering the old name for the subagent.
   - **Each later slice**: on the predecessor's branch with a clean tree →
     `git checkout -b <stack-name>`. **Predecessor already merged** →
     `git checkout <BASE> && git pull && git checkout -b <stack-name>`; this
     slice starts a fresh stack.

   Do not use the stack tool's branch-creation commands — work-slice Step 5
   links the stack server-side by PR number. Write the slice checkpoint
   `.context/<slice-id>/workflow-state.md` at `BRANCH_READY` (full OIDs).
3. **Spawn the slice subagent** — one fresh writer, strongest model, prompt:

   > Run the `magnus:work-slice` skill for slice `<slice-id>` (parent
   > `<ISSUE>`), **starting at Step 3**. Steps 1–2 are done: the slice is
   > claimed (status `<IN-PROGRESS>`, `<NEXT>` cleared) and branch
   > `<stack-name>` is checked out, based on `<predecessor-branch | BASE>` @
   > `<oid>`, checkpoint `BRANCH_READY`. Do NOT rename, reset, or create
   > branches. Run Steps 3–6 verbatim (implement + engine-CLI review loop,
   > Playwright loop, evidence + consolidation tickets, draft PR + stack link
   > + provenance comment, skeleton map + `<NEXT>` pointer). Pre-rename remote
   > branch for Step 5.1: `<old-name | none>`. If the slice body names a
   > decision that "needs a human", make the call most consistent with the
   > PRD and record it under `## Assumptions` on the ticket and in the PR
   > comment — never stop for it. **Stop after Step 6** (checkpoint
   > `HANDED_OFF`); do not run Step 7 — the orchestrator babysits the stack.
   > Reply with the PR number, the checkpoint stage, and any assumptions made.

   Never continue, re-prompt or reuse a previous slice's agent; the handoff
   is the ticket, the PRD, and the files in `.context/<slice-id>/`.
4. **Verify from durable markers, not the reply**: `.context/<slice-id>/
   workflow-state.md` reads `HANDED_OFF` (or later), `gh pr view` shows an
   open draft PR on `<stack-name>` with the right base, `git status
   --porcelain` is clean. Markers short of that → the slice is re-entrant:
   spawn **one more fresh** subagent with the same prompt (work-slice resumes
   from its checkpoint and the engine's `status`). Still short → **Blocked**:
   report where it stopped (a gut-check `hard-stop` is always Blocked — no PR
   is opened for it). Record assumptions in the pipeline checkpoint.
5. **Advance** the slice cursor in the checkpoint and loop. After the last
   slice, fall through to BABYSIT.

Load the `<STACK>` skill before the first stack command; with no `pr.stackTool`
configured, each PR simply targets `<BASE>` and nothing is linked.

## BABYSIT in local mode

Run **`/babysit-stack <ISSUE>`** in this worktree. It runs to its terminal
verdict here (it waits for CI and bot rounds itself); handle GOAL MET / NOT
MET exactly as SKILL.md's BABYSIT stage describes.

## Local-mode red flags

- About to implement, fix, or review a slice in the orchestrator context, or to reuse the previous slice's subagent — stop: one fresh subagent per slice.
- About to spawn a slice subagent with planning docs uncommitted, or a dirty tree — stop: commit the docs; work-slice's preflight refuses a dirty tree.
- About to create a second worktree — stop: the whole pipeline walks this one, switching branches.
- About to trust a subagent's or delegated child's reply — stop: verify durable markers.
