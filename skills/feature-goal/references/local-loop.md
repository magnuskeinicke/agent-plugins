# Local loop — opt-in slice venue for `/feature-goal`

Default `/feature-goal` runs everything after planning in the cloud
(SKILL.md, "Stage SLICE-LOOP" / "Stage BABYSIT"). This reference is the
**opt-in** alternative: `routing.dispatch: "local"` in `repo-config.md`, the
user says `local` (argument or conversation), or neither the Conductor MCP nor
the `conductor` CLI is reachable (fallback, announced once). Every slice is
then implemented in **this one worktree**, walking up the stack, each by a
**freshly spawned subagent** that has never seen another slice's reasoning —
the shared runtime contract's native/CLI workers, with explicit `implementer`
model and effort. No inline persona fallback. The worker needs the tracker,
GitHub and browser tools for the full slice; verify those capabilities first.
You own the tracker/git choreography around it and never implement the slice
yourself. Pin the planning config with `engine snapshot` before cutting branches
and pass its path and docs commit OID in every slice brief.

The mode choice never forks work: a slice already claimed by a cloud relay
session (its `## Cloud dispatch` ticket comment exists) stays cloud-owned even
after a fallback — resume that relay; never re-implement it here.

The stack is the same as in cloud mode: **one linear `gh stack` stack in
stack order**, branches cut with `gh stack init` / `gh stack add` in this
worktree, PRs opened by the repo's PR skill and adopted with `gh stack link`
by PR number. Work-slice assumes Conductor handed it a fresh worktree per
slice and keeps the branch checked out there; here branches are
**created** instead, so its Step 2 is substituted below. Everything else is
work-slice verbatim.

## Per slice, in stack order, until none remain

1. **Select + claim** (work-slice Step 1) — pick the `<NEXT>` carrier
   (fallback: earliest slice in stack order whose predecessor has an open or
   merged PR and that is not done / in progress), fetch slice + PRD ticket +
   Skeleton-map comment, clear `<NEXT>` (additive label write), set status
   **`<IN-PROGRESS>`**. A `<HITL>` label is **not a gate**: note the decision
   text — the subagent gets it as an assumption to make and record.

   **Slice reserved for another agent** (`<AGENT:><name>`, `<name>` ≠ this
   runtime): `routing.delegate.<name>` configured → **delegate**: run that
   command template as the worker in step 3, after the parent prepares the branch in step 2. Give it the full step-3 handoff, including the pinned config and starting stage; wait for exit and verify step 4's durable markers. No delegate configured → this runtime works it via the loop below and
   the report and the slice ticket's `## Assumptions` say `routing label <AGENT:><name> not honoured: no
   routing.delegate.<name> configured`. Never delegate below slice granularity.
2. **Branch with `gh stack` (replaces work-slice Step 2)** — exactly
   `references/pr-session.md` §2: name `<project-slug>/<NN>-<issue-id>`;
   one-time `gh extension install github/gh-stack`, `git config
   rerere.enabled true`, `git config remote.pushDefault origin`. Before the
   first slice the worktree must carry nothing ahead of `<BASE>` beyond the
   planning-doc commits (`git diff <BASE>...HEAD --name-only` empty or only
   `CONTEXT.md` / `docs/adr/**` / `docs/agents/**`, else STOP — a safety stop,
   not a gate); those commits stay on the pushed docs branch, never on a stack
   branch.
   - **First slice** (skeleton, or first after a merged predecessor):
     `git fetch origin && git checkout -B <BASE> origin/<BASE>`, then
     `gh stack init --base <BASE> <stack-name>`.
   - **Each later slice**: `gh stack checkout <predecessor-branch>` (clean
     tree), then `gh stack add <stack-name>`.

   Write the slice checkpoint `.context/<slice-id>/workflow-state.md` at
   `BRANCH_READY` (full OIDs).
3. **Spawn the slice subagent** — one fresh writer with the resolved implementer profile, prompt:

   > Run the `magnus:work-slice` skill for slice `<slice-id>` (PRD ticket
   > `<PRD-ISSUE>`, feature ticket `<ISSUE>`), **starting at Step 3**. Steps 1–2 are done: the slice is
   > claimed (status `<IN-PROGRESS>`, `<NEXT>` cleared) and branch
   > `<stack-name>` is checked out via `gh stack`, based on
   > `<predecessor-branch | BASE>` @ `<oid>`, checkpoint `BRANCH_READY`. Do
   > NOT rename, reset, or create branches. Run Steps 3–8 verbatim (implement
   > + engine-CLI review loop, artifact-free Playwright loop, text-only QA
   > evidence + consolidation tickets, draft PR with `## Verification` only +
   > `gh stack link` by PR number, no PR comment, skeleton map + `<NEXT>`
   > pointer). Capture no media before the babysit verdict. Step 5.1 does not apply (nothing was
   > renamed); push with `gh stack push --remote origin`. If the slice body
   > names a decision that "needs a human", make the call most consistent
   > with the PRD and record it under `## Assumptions` on the ticket and in
   > the PR body's `## Notes` — never stop for it. Then run **Step 7**: `/babysit-stack
   > <PR number>` on this PR to its terminal verdict (CI, `<BOT>` rounds,
   > `<COMMENT-BOT>` rounds, threads) and, on GOAL MET, **Step 8**: capture the
   > scenes, publish them to `<MEDIA-BRANCH>`, insert `## Visual verification`
   > with one `gh pr edit` — checkpoint `COMPLETE` on GOAL MET + Step 8 done,
   > `HANDED_OFF` + the verdict line on NOT MET (capture nothing then). Reply with the PR number,
   > the checkpoint stage, the babysit verdict, and any assumptions made.

   Never continue, re-prompt or reuse a previous slice's agent; the handoff
   is the ticket, the PRD, and the files in `.context/<slice-id>/`.
4. **Verify from durable markers, not the reply**: `.context/<slice-id>/
   workflow-state.md` reads `COMPLETE` (babysit GOAL MET), `gh pr view` shows
   an open draft PR on `<stack-name>` with the predecessor's branch as base,
   CI green and no unresolved review threads, `gh stack view --json` shows
   the chain, `git status --porcelain` is clean. Markers short of that → the
   slice is re-entrant: spawn **one more fresh** subagent with the same
   prompt (work-slice resumes from its checkpoint, the engine's `status`, and
   babysit's state file). Still short → **Blocked**: report where it stopped
   (a gut-check `hard-stop` is always Blocked — no PR is opened for it; a
   babysit `NOT MET` is Blocked with its blockers verbatim — the human acts on
   the PR, then re-invokes, and the loop re-enters this slice at Step 7).
   Record assumptions and the slice's verdict in the pipeline checkpoint.
5. **Advance** the slice cursor in the checkpoint and loop — only past a slice
   whose PR reads GOAL MET. After the last slice, fall through to BABYSIT.

With no `pr.stackTool` configured, `git checkout -b` replaces the `gh stack`
commands, each PR simply targets `<BASE>` and nothing is linked.

## BABYSIT in local mode

Run **`/babysit-stack <PRD-ISSUE>`** in this worktree — the stack-wide sweep over
PRs that were each already babysat to GOAL MET on their own. It runs to its
terminal verdict here (it waits for CI and bot rounds itself); handle GOAL
MET / NOT MET exactly as SKILL.md's BABYSIT stage describes.

## Local-mode red flags

- About to implement, fix, or review a slice in the orchestrator context, or to reuse the previous slice's subagent — stop: one fresh subagent per slice.
- About to spawn a slice subagent with planning docs uncommitted, or a dirty tree — stop: commit the docs; work-slice's preflight refuses a dirty tree.
- About to create a second worktree — stop: the whole pipeline walks this one, switching branches with `gh stack checkout`.
- About to branch a slice off the skeleton instead of the previous slice in stack order — stop: one linear stack.
- About to spawn the next slice while the previous slice's PR is not babysat to GOAL MET — stop: every layer is cut on a bot-reviewed, green, thread-resolved PR; NOT MET is Blocked.
- About to trust a subagent's or delegated child's reply — stop: verify durable markers.
