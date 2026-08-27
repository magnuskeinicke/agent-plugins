---
name: feature-goal
description: >
  Run the whole feature pipeline end-to-end under the built-in /goal command:
  grilled plan → PRD (/to-prd) → sliced PR stack (/to-issues) → each slice
  implemented red-green-refactor with the bounded review loop (work-slice
  workflow) → babysit every PR (Copilot review, CI, comment resolution) until
  the stack is green and resolved. Use when I say "run the feature pipeline",
  "take SER-xxxx to a green stack", "start the goal pipeline", "/feature-goal",
  or after a grilling session when I want the feature driven all the way to
  reviewed, green, stacked PRs.
argument-hint: "[SER-parent-id]"
---

# Feature Goal

The orchestrator that makes the built-in **`/goal`** command useful for
feature development. `/goal <condition>` is a persistence mechanism — a Stop
hook blocks stopping until the condition is met — not an orchestrator. This
skill supplies the orchestration: a stage machine that is **re-entrant** (every
/goal iteration re-detects where the pipeline stands from observable state and
does the next thing), built on the existing suite: `grill-with-docs`,
`to-prd`, `to-issues`, the work-slice workflow, `create-pr`, `gh-stack`,
`babysit-stack`.

Read `docs/agents/issue-tracker.md`, `triage-labels.md`, and
`repo-config.md` first — same conventions as the rest of the suite.

## Setting the goal — only around the implementation loop

`/goal` is a **stop-blocker**: its Stop hook refuses to let the session end
until the condition reads met. That is exactly wrong for the first three
stages, which are human-in-the-loop — grilling *needs* to stop and wait for the
user, and both `/to-prd` and `/to-issues` end on an approval gate. A goal set
there would bounce every one of those pauses.

So the boundary is: **GRILL, PRD and SLICE-SPLIT run with no goal set.
SLICE-LOOP and BABYSIT run under one.**

The user types `/goal` themselves (it's a user command). When this skill
reaches the top of SLICE-LOOP and no goal is active, print the template and ask
them to set it before the first slice starts (keep it short — the condition has
a length cap):

```
/goal SER-<parent> feature pipeline done: every slice has an open draft PR,
all stack PR CI green, Copilot requested, all review threads resolved —
/babysit-stack verdict reads GOAL MET (needs-human blockers count as not met)
```

If the user declines or is away, carry on anyway — the skill works identically
without a goal set, it just won't auto-resume when the session tries to stop.
`/goal clear` stops early. If a stage below reports a **human blocker**, say so
plainly in the attempted stop message — the user decides whether to intervene
or `/goal clear`.

**If a goal is already active when the skill is invoked at stage GRILL / PRD /
SLICE-SPLIT**, tell the user to `/goal clear` first — a live goal will fight
those stages' approval gates.

## Stage detection — run this at every (re)entry

Detect the stage from observable state, never from conversation memory alone.
With parent id `SER-<p>` (from the argument or the conversation; if there is
no parent ticket yet, that's stage 0/1):

1. **No parent ticket / no `# PRD` comment on it** → stage GRILL / PRD.
2. **PRD comment exists, no sub-issues** → stage SLICE-SPLIT.
3. **Sub-issues exist, at least one slice with neither an open nor a merged
   PR** → stage SLICE-LOOP. Check PRs with `gh pr list --state all` — a
   **merged** PR means that slice is done; never re-detect it as needing the
   slice loop.
4. **Every slice has an open or merged PR** → stage BABYSIT (merged slices
   impose no babysit work).
5. **Last `/babysit-stack` verdict = GOAL MET** → done; the goal condition is
   met, report and stop.

## Stage GRILL / PRD — human first

The grilling session is **human-in-the-loop and cannot run under the goal**:

- If the current conversation already contains a completed grilling session
  (decision tree traversed, decisions crystallised) → run **`/to-prd`** now: it
  writes the PRD onto the parent ticket (creating it if needed, with
  `type:*` + `manager:skip` per `triage-labels.md`).
- If not → **stop and tell the user** to run `/grill-with-docs` (or
  `/grill-me`) first, then re-invoke. Never fabricate a PRD from a bare Linear
  issue title — the grilling transcript + the Linear issue are the PRD inputs.

Both this stage and SLICE-SPLIT end on a human approval gate (`/to-prd` checks
the test seams; `/to-issues` presents the breakdown for sign-off). Stopping
there is correct — do not set a goal before those gates are cleared.

## Stage SLICE-SPLIT

Run **`/to-issues`** on the parent. It builds the code-layer map, gathers the
Figma design context, splits into walking skeleton + behaviour deltas
(≤1 novel decision each, small reviewable PRs), creates the sub-issues stacked
via `blockedBy`, and stamps `slice:next` on the skeleton. Nothing to add here —
follow that skill verbatim.

**Persist planning docs before leaving this stage.** Grilling and slicing may
have written `CONTEXT.md`, `docs/adr/**`, and `docs/agents/repo-config.md` in
this worktree. Commit them now on the current branch (one commit, e.g.
`docs: SER-<p> planning docs`) so work-slice's clean-tree preflight passes.
The first-slice check below tolerates exactly these doc-only commits; they
ride along in the first slice's PR.

## Stage SLICE-LOOP — sequential slices in THIS worktree

This is `/work-slice` run slice-after-slice in one session. Follow work-slice
**verbatim** — Step 1 (select + claim), Step 3 (the workflow), Step 4 (present,
QA evidence, consolidation tickets), Step 5 (push → `create-pr` → draft →
`gh stack link` → convention comment) and Step 6 (skeleton map + advance
`slice:next`). It is already gh-stack-native; there is no av anywhere in this
pipeline. Load the `gh-stack` skill before the first `gh stack` command
(non-interactive rules live there).

**The one deviation is work-slice's Step 2.** Work-slice assumes Conductor
handed it a fresh worktree per slice, so it *renames* the branch already
checked out there. Here every slice runs in **this one worktree**, walking up
the stack — so branches are created, not renamed. Substitute Step 2 with the
below and keep everything else as written.

For each slice, in stack order, until none remain:

1. **Select + claim** — work-slice Step 1 verbatim: pick the `slice:next`
   carrier (fallback: earliest unblocked, not-done, not-`needs:human`), fetch
   slice + parent PRD + Skeleton-map comment, clear `slice:next` (additive
   label write), set **Dev in progress**. A `needs:human` slice **stops the
   loop**: report which decision it needs — that's a human blocker.
2. **Branch (replaces work-slice Step 2).** Branch name
   `<project-slug>/<NN>-<ser-id>` (kebab-cased Linear project name, zero-padded
   stack-order index, slice id — work-slice's naming). One-time, before the
   first slice: `git config rerere.enabled true`, `git config remote.pushDefault
   origin`.
   - **First slice, virgin worktree branch** (nothing ahead of `development`
     — the integration branch from `docs/agents/repo-config.md`, here and in
     every later mention — beyond the SLICE-SPLIT planning-doc commits: check
     `git diff development...HEAD --name-only` is empty or lists only
     `CONTEXT.md` / `docs/adr/**` / `docs/agents/**`, else STOP): rename in
     place, `git branch -m <stack-name>`.
   - **Each later slice**: you are on the predecessor's branch and its tree is
     clean, so branch off it — `git checkout -b <stack-name>`.
   - **Predecessor already merged** → `git checkout development && git pull`
     first, then `git checkout -b <stack-name>`, and note that this slice starts
     a fresh stack.

   No `gh stack init`/`add` here: those create branches *and* local tracking
   state, and work-slice's Step 5 links the stack server-side by PR number
   instead. Keeping the local side plain git is what lets a slice's fixes be
   rebased later without fighting stale tracking.
3. **Implement + review loop** — work-slice Step 3's Workflow call, same args
   contract, unchanged:
   `scriptPath` must be an **absolute** path into this plugin's install root — the
   script ships with the plugin, not with the host repo, so a repo-relative path
   resolves to nothing. Resolve it first: use `$CLAUDE_PLUGIN_ROOT/skills/work-slice/work-slice-loop.workflow.js`
   when that variable is set, otherwise
   `ls -d "$HOME"/.claude/plugins/cache/*/magnus/*/skills/work-slice/work-slice-loop.workflow.js | sort -V | tail -1`.
   Below, `<PLUGIN_ROOT>` stands for the resolved root — substitute the real path.

   ```
   Workflow({
     scriptPath: "<PLUGIN_ROOT>/skills/work-slice/work-slice-loop.workflow.js",
     args: { sliceId, sliceKind, acceptanceCriteria, whereToLook,
             conventionContract, figma, baseBranch, prdContract, repoConfig }
   })
   ```
   `baseBranch` = predecessor stack branch (skeleton: `development`). Verify
   `args` actually reached the script (a past run came back "(unknown slice)")
   — if the workflow reports a missing slice id, bake the literals into the
   script rather than re-running blind. The
   workflow owns implement (Opus, TDD) → up to 5 review rounds (baseline +
   web/server lanes + reuse, Sonnet) → fix rounds → the Playwright user-story
   loop (max 3) on user-facing slices. Do not implement or review in the main
   session. A loop that hits its cap still ships — outstanding findings go
   onto the draft PR (work-slice Step 4 rules).
4. **Present + Linear bookkeeping** — work-slice Step 4 verbatim: print the
   summary, upload QA evidence to the slice ticket, file consolidation
   follow-up tickets.
5. **Draft PR** — work-slice Step 5 verbatim: scrub untracked review
   scaffolding → clean up the stale pre-rename remote branch and close its PR
   (first slice only; later slices were never pushed under another name) →
   `git push -u origin <branch>` → **`create-pr`** verbatim → `gh pr ready <n>
   --undo` → **`gh stack link`** (skeleton: nothing to link; every later slice:
   re-list the whole stack bottom → top by PR number,
   `gh stack link --base development <pr-01> … <this-pr>` — idempotent, and the
   only form that needs no stack-number lookup) → verify `baseRefName` +
   `isDraft` → post the `## Convention provenance` (+ consolidations) comment.
6. **Hand off** — work-slice Step 6 verbatim: skeleton → post/update the
   "Skeleton map" comment on every delta; advance `slice:next` to the next
   unblocked AFK slice (exactly one carrier; `needs:human` next → don't stamp,
   report the blocker).

Then loop to the next slice. After the last slice, fall through to BABYSIT.

Before the first slice, make sure a goal is set (see "Setting the goal") — this
is the point where unattended persistence starts paying off.

## Stage BABYSIT

Run **`/babysit-stack SER-<p>`** — one pass: ensure Copilot is requested on
every PR, watch/fix CI, address + resolve review threads, restack after fixes.
It ends with a `VERDICT: GOAL MET | NOT MET` block:

- **NOT MET, actionable items remain** → under /goal the session simply keeps
  going: run another pass (respecting its per-item caps).
- **NOT MET, only pending CI / awaited Copilot review** → say so and attempt to
  stop; the /goal hook will bounce it, and the next iteration re-checks —
  babysit-stack's bounded `--watch` paces this instead of hot-looping.
- **NOT MET, only `needs-human` blockers** → report them clearly and attempt
  to stop with that as the reason; the human unblocks or `/goal clear`s.
- **GOAL MET** → the pipeline is done. Report the stack (PRs, verdict table)
  and stop — the goal condition is satisfied.

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
- Stacking is gh-stack + plain git. `av` is decommissioned — never run an `av`
  command. Do not create extra worktrees: the whole pipeline lives in this one,
  switching branches as it walks the stack. Never `gh stack submit` (it opens
  its own auto-titled PRs) and never `gh stack link --open` (it un-drafts).
- Label writes stay additive (`save_issue.labels` replaces the whole set);
  `slice:next` has exactly one carrier; never stamp `agent:ready`.
- Re-entry safe: every iteration re-runs stage detection; never redo a stage
  whose artifacts exist (PRD comment, sub-issues, open PRs) — repair forward.
- A human blocker (HITL slice, needs-human thread, cap-exhausted failure)
  is reported as the stop reason, not worked around.
