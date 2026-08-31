---
name: feature-goal
description: >
  Run the whole feature pipeline end-to-end as a re-entrant stage machine:
  grilled plan → PRD (/to-prd) → sliced PR stack (/to-issues) → each slice
  implemented red-green-refactor with the bounded review loop (work-slice
  engine-CLI loop) → babysit every PR (bot review, CI, comment resolution) until
  the stack is green and resolved. Every invocation re-detects where the
  pipeline stands from durable markers and advances it — run it again to
  resume. Use when I say "run the feature pipeline", "take this ticket to a
  green stack", "resume the feature pipeline", "/feature-goal", or after a
  grilling session when I want the feature driven all the way to reviewed,
  green, stacked PRs.
argument-hint: "[parent issue id]"
---

# Feature Goal

The feature-pipeline orchestrator: a **re-entrant stage machine** built on the
existing suite — `grill-with-docs`, `to-prd`, `to-issues`, the work-slice
engine-CLI loop, the repo's PR skill, the stack tool, `babysit-stack`. Every
invocation re-detects where the pipeline stands from **durable markers**
(tracker comments, sub-issues, branches, PR state — never conversation memory
alone) and does the next thing. There is no stop-hook and no self-set goal:
**persistence is re-invocation** — when a run ends, its report says exactly
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
| `<NEXT>` | `labels.sliceNext` | no pointer label — the user names the next slice |
| `<SKIP>` | `labels.managerSkip` | skip the triage opt-out stamp |
| `<HITL>` | `labels.needsHuman` | read "needs a human decision" from the ticket body |
| `<TYPE:>` | `labels.typePrefix` | skip the type label |
| `<BOT>` | `pr.botReviewer` | no bot review round to request or wait on |
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>` |
| `<AGENT:>` | `routing.labelPrefix` (with `routing.delegate`) | no agent routing — this runtime works every slice |

Also read the prose docs the config points at when they exist:
`tracker.docPath`, `labels.docPath`, and `docs/agents/README.md`.

## Persistence — run again to resume

One invocation advances the pipeline as far as live state allows, then ends
with a report. A run ends at exactly three kinds of boundary:

- **A human gate** — grilling, the `/to-prd` and `/to-issues` approval gates, a
  `<HITL>` slice, a `needs-human` babysit blocker, an exhausted cap, or a slice
  reserved for another agent with no `routing.delegate` configured. Name the
  gate and what the human must decide; the human acts, then re-invokes.
- **Waiting on external state** — CI running, an awaited `<BOT>` review.
  Report what's pending; a re-invocation re-checks. For unattended pacing the
  user can wrap the re-invocation in whatever cadence the runtime offers
  (`/loop 15m "/feature-goal <ISSUE>"`, a scheduler, or re-running by hand) —
  never hot-loop passes back-to-back inside one invocation when only external
  state is pending.
- **Done** — the last babysit verdict reads GOAL MET.

Every report ends with the resume line: the current stage, the blocking reason
if any, and the exact command (`/feature-goal <ISSUE>`) that continues it.

**Checkpoint.** Keep `.context/<ISSUE>/pipeline-state.md` in the host repo
(gitignored) — a single overwritten `## Workflow State` block:

```markdown
## Workflow State
- Stage: GRILL/PRD | SLICE-SPLIT | SLICE-LOOP | BABYSIT | DONE
- Parent: PROJ-1200
- Slice cursor: PROJ-1234 (03 of 05) | (none)
- Last babysit verdict: (none | GOAL MET | NOT MET — <reason>)
```

Rewrite it at every stage boundary and after every babysit pass. It is a
cache, not the truth: **stage detection below always wins** — the checkpoint
just saves a cold re-entry from re-deriving context it can state up front.

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
5. **Last `/babysit-stack` verdict = GOAL MET** → done; report and stop.

## Stage GRILL / PRD — human first

The grilling session is **human-in-the-loop** and always ends the invocation:

- If the current conversation already contains a completed grilling session
  (decision tree traversed, decisions crystallised) → run **`/to-prd`** now: it
  writes the PRD onto the parent ticket (creating it if needed, with
  `<TYPE:>*` + `<SKIP>` per the labels doc).
- If not → **stop and tell the user** to run `/grill-with-docs` (or
  `/grill-me`) first, then re-invoke. Never fabricate a PRD from a bare tracker
  issue title — the grilling transcript + the tracker issue are the PRD inputs.

Both this stage and SLICE-SPLIT end on a human approval gate (`/to-prd` checks
the test seams; `/to-issues` presents the breakdown for sign-off). Ending the
invocation there is correct — report the gate and the resume command.

## Stage SLICE-SPLIT

Run **`/to-issues`** on the parent. It builds the code-layer map, gathers the
Figma design context, splits into walking skeleton + behaviour deltas
(≤1 novel decision each, small reviewable PRs), creates the sub-issues stacked
via `blockedBy`, and stamps `<NEXT>` on the skeleton. Nothing to add here —
follow that skill verbatim.

**Persist planning docs before leaving this stage.** Grilling and slicing may
have written `CONTEXT.md`, `docs/adr/**`, and `docs/agents/repo-config.md` in
this worktree. Commit them now on the current branch (one commit, e.g.
`docs: <ISSUE> planning docs`) so work-slice's clean-tree preflight passes.
The first-slice check below tolerates exactly these doc-only commits; they
ride along in the first slice's PR.

## Stage SLICE-LOOP — sequential slices in THIS worktree

This is `/work-slice` run slice-after-slice in one session. Follow work-slice
**verbatim** — Step 1 (select + claim), Step 3 (the engine-CLI loop), Step 4 (present,
QA evidence, consolidation tickets), Step 5 (push → `create-pr` → draft →
stack linkage → convention comment) and Step 6 (skeleton map + advance
`<NEXT>`). Work-slice keeps its own per-slice `## Workflow State` checkpoint in
`.context/<slice-id>/workflow-state.md` — a re-entry mid-slice resumes from
that (and from the engine CLI's `status`), so an interrupted slice is picked
up where it stopped, never restarted. Load the `<STACK>` skill before the
first stack command (non-interactive rules live there). With no `pr.stackTool`
configured, skip every stack-linking step: each PR simply targets `<BASE>`.

**The one deviation is work-slice's Step 2.** Work-slice assumes Conductor
handed it a fresh worktree per slice, so it *renames* the branch already
checked out there. Here every slice runs in **this one worktree**, walking up
the stack — so branches are created, not renamed. Substitute Step 2 with the
below and keep everything else as written.

For each slice, in stack order, until none remain:

1. **Select + claim** — work-slice Step 1 verbatim: pick the `<NEXT>`
   carrier (fallback: earliest unblocked, not-done, not-`<HITL>`), fetch
   slice + parent PRD + Skeleton-map comment, clear `<NEXT>` (additive
   label write), set status **`<IN-PROGRESS>`**. A `<HITL>` slice **stops the
   loop**: report which decision it needs — that's a human gate ending the
   invocation.

   **Slice reserved for another agent** (`<AGENT:><name>` label, `<name>` ≠
   this runtime — work-slice's routing gate):
   - `routing.delegate.<name>` configured → **delegate**: run that command
     template as a child process with the prompt `/work-slice <slice-id>`,
     wait for it to exit, then verify the slice's **durable markers** (its
     `.context/<slice-id>/workflow-state.md` checkpoint, engine `status`,
     branch, PR state) exactly as a re-entry would. Markers show the slice
     reached PR → continue the loop at the next slice. Child died or markers
     show a mid-stage stop → report where it stopped; a re-invocation resumes
     (the delegated slice is re-entrant like any other). Never re-implement a
     delegated slice in this runtime, and never delegate anything below slice
     granularity.
   - No delegate configured → **end the invocation** naming the slice and the
     agent it waits on ("open it in a `<name>` workspace — e.g. via
     Conductor — then re-invoke here"); this is a routing boundary, same
     reporting shape as a human gate.
2. **Branch (replaces work-slice Step 2).** Branch name
   `<project-slug>/<NN>-<issue-id>` (kebab-cased project name, zero-padded
   stack-order index, slice id — work-slice's naming). One-time, before the
   first slice: `git config rerere.enabled true`, `git config remote.pushDefault
   origin`.
   - **First slice, virgin worktree branch** (nothing ahead of `<BASE>` beyond
     the SLICE-SPLIT planning-doc commits: check
     `git diff <BASE>...HEAD --name-only` is empty or lists only
     `CONTEXT.md` / `docs/adr/**` / `docs/agents/**`, else STOP): rename in
     place, `git branch -m <stack-name>`.
   - **Each later slice**: you are on the predecessor's branch and its tree is
     clean, so branch off it — `git checkout -b <stack-name>`.
   - **Predecessor already merged** → `git checkout <BASE> && git pull`
     first, then `git checkout -b <stack-name>`, and note that this slice starts
     a fresh stack.

   Do not use the stack tool's own branch-creation commands: they create
   branches *and* local tracking state, and work-slice's Step 5 links the stack
   server-side by PR number instead. Keeping the local side plain git is what lets a slice's fixes be
   rebased later without fighting stale tracking.
3. **Implement + review loop** — work-slice Step 3 verbatim: write the run
   contract to `.context/<slice-id>/contract.md` (Kind guidance, AC,
   where-to-look, convention contract, Figma, PRD contract), run the
   implement pass, then drive the **engine CLI** (`engine/cli.mjs` in the
   plugin install root) through `init → plan → collect → decide → apply-fix →
   adjudicate → report`, obeying its JSON output, then the Playwright
   user-story loop (max 3) on user-facing slices. `--base` = predecessor
   stack branch (skeleton: `<BASE>`). A loop that stalls still ships —
   outstanding findings go onto the draft PR (work-slice Step 4 rules).
4. **Present + tracker bookkeeping** — work-slice Step 4 verbatim: print the
   summary, upload QA evidence to the slice ticket, file consolidation
   follow-up tickets.
5. **Draft PR** — work-slice Step 5 verbatim: scrub untracked review
   scaffolding → clean up the stale pre-rename remote branch and close its PR
   (first slice only; later slices were never pushed under another name) →
   `git push -u origin <branch>` → the repo's PR skill (`skills.createPr`)
   verbatim → `gh pr ready <n> --undo` → **link the stack** (skeleton: nothing
   to link; every later slice: re-list the whole stack bottom → top by PR
   number, `gh stack link --base <BASE> <pr-01> … <this-pr>` — idempotent, and
   the only form that needs no stack-number lookup) → verify `baseRefName` +
   `isDraft` → post the `## Convention provenance` (+ consolidations) comment.
6. **Hand off** — work-slice Step 6 verbatim: skeleton → post/update the
   "Skeleton map" comment on every delta; advance `<NEXT>` to the next
   unblocked AFK slice (exactly one carrier; `<HITL>` next → don't stamp,
   report the blocker).

Then update the pipeline checkpoint (slice cursor) and loop to the next slice.
After the last slice, fall through to BABYSIT.

## Stage BABYSIT

Run **`/babysit-stack <ISSUE>`** — one pass: ensure `<BOT>` is requested on
every PR, watch/fix CI, address + resolve review threads, restack after fixes.
It ends with a `VERDICT: GOAL MET | NOT MET` block:

- **NOT MET, actionable items remain** → run another pass now (respecting its
  per-item caps).
- **NOT MET, only pending CI / an awaited `<BOT>` review** → nothing to do but
  wait: record the verdict in the checkpoint and **end the invocation**,
  naming what's pending — babysit-stack's bounded `--watch` is the only
  in-pass wait; beyond it, the re-invocation cadence (re-run, `/loop`, a
  scheduler) paces the re-check.
- **NOT MET, only `needs-human` blockers** → report them clearly as the stop
  reason and end the invocation; the human unblocks, then re-invokes.
- **GOAL MET** → the pipeline is done. Report the stack (PRs, verdict table),
  set the checkpoint stage to DONE, and stop.

## Boundaries

- Everything the constituent skills forbid stays forbidden: **never merge,
  approve, or mark a PR ready; never mark issues done; never run compliance.**
  Terminal state = green, review-resolved **draft** PRs — promoting and
  merging stay the human's calls.
- Grilling is never automated — no PRD without a grilling session or an
  explicit user instruction to derive one from stated context.
- One slice at a time, stack order; all caps respected (5 review rounds, 3
  Playwright rounds, babysit's fix caps). Caps exhausted → escalate on the PR,
  never grind.
- **Routing is honoured, never overridden:** a slice labelled `<AGENT:><name>`
  for another runtime is delegated (when `routing.delegate.<name>` exists) or
  reported — never implemented here because delegation is inconvenient. A
  delegated slice's work is verified from durable markers, not the child's
  exit code alone.
- Stacking is `<STACK>` + plain git. Do not create extra worktrees: the whole
  pipeline lives in this one, switching branches as it walks the stack. With
  `gh-stack`: never `gh stack submit` (it opens its own auto-titled PRs) and
  never `gh stack link --open` (it un-drafts).
- Label writes stay additive (Linear's `save_issue.labels` replaces the whole
  set); `<NEXT>` has exactly one carrier; never stamp `labels.agentReady`.
- Re-entry safe: every invocation re-runs stage detection; never redo a stage
  whose artifacts exist (PRD comment, sub-issues, open PRs) — repair forward.
  Durable markers always win over the pipeline checkpoint file.
- **Persistence is re-invocation, never a stop-hook.** A run ends only at a
  human gate, a waiting-on-external boundary, or DONE — always with the
  resume line. Never spin passes back-to-back when only external state is
  pending.
- A human blocker (HITL slice, needs-human thread, cap-exhausted failure)
  is reported as the stop reason, not worked around.

## Workflow Boundaries

**This skill orchestrates the feature pipeline as a re-entrant stage machine — it sequences the constituent skills, never re-implements them.**

- **DOES**: detect the stage from durable markers, run `/to-prd` and `/to-issues` at their gates, walk the slice loop (work-slice verbatim, Step 2 substituted), delegate `<AGENT:>`-routed slices via `routing.delegate`, run `/babysit-stack` passes, keep `.context/<ISSUE>/pipeline-state.md`, end every run with the resume line.
- **DOES NOT**: grill (the human runs `/grill-with-docs`), own review-loop internals (the engine CLI does), own CI/bot/thread mechanics (`/babysit-stack` does), merge/approve/mark ready/mark issues done, create extra worktrees.

## Red Flags — STOP

- About to fabricate a PRD from a bare ticket title with no grilling session in the conversation — stop: send the user to `/grill-with-docs` and end.
- About to redo a stage whose artifacts exist (PRD comment, sub-issues, open PRs) — stop: repair forward from stage detection; durable markers beat the checkpoint.
- About to implement a slice labelled `<AGENT:><other>` here because delegation is inconvenient — stop: delegate via `routing.delegate.<name>` or end naming the agent it waits on.
- About to trust a delegated child's exit code — stop: verify the slice's durable markers (workflow-state checkpoint, engine `status`, branch, PR) like a re-entry would.
- About to run another babysit pass when only CI / an awaited `<BOT>` review is pending — stop: record the verdict, end with the resume line; the cadence re-checks.
- About to run `gh stack submit` or `gh stack link --open` — stop: submit opens auto-titled PRs, `--open` un-drafts.
- About to create a second worktree — stop: the whole pipeline walks this one, switching branches.
- About to work past a `<HITL>` slice, a `needs-human` blocker, or an exhausted cap — stop: that is a human gate; report it and end.

## Verification

Before reporting done:

- [ ] `.context/<ISSUE>/pipeline-state.md` rewritten to the current stage, slice cursor, and last babysit verdict.
- [ ] The reported stage matches live markers (`# PRD` comment, sub-issues, `gh pr list --state all`) — not conversation memory or the checkpoint alone.
- [ ] Planning docs (`CONTEXT.md`, `docs/adr/**`, `docs/agents/**`) were committed before the first slice, so work-slice's clean-tree preflight passes.
- [ ] Every completed slice has a draft PR, and `<NEXT>` has exactly one carrier (or the report names the HITL/complete reason for none).
- [ ] The report ends with the resume line: stage, blocking reason if any, and `/feature-goal <ISSUE>`.
- [ ] Stage DONE claimed only when the last `/babysit-stack` verdict reads GOAL MET.
