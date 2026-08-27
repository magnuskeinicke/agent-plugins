---
name: work-issue
description: The LEAN development loop — take a single Linear issue straight to a reviewed draft PR, skipping grilling/PRD/slicing. Runs the same implement + bounded review-fix + Playwright workflow as /work-slice, then drives the PR to green under /goal via /babysit-stack. For lean tickets only — as judged by the ticket manager (agent:ready) or the user. Use when the user says "work SER-xxxx directly", "run the lean loop on SER-xxxx", "just implement this ticket", "take this issue straight to a PR", or "this doesn't need the full pipeline".
argument-hint: "[SER-id]"
---

# Work Issue — the lean loop

Drive **one standalone Linear issue** to a **draft PR**, with the same quality machinery as the big pipeline but none of its planning stages: no grilling, no PRD, no slice split, no stack. The ticket itself is the contract. Implementation runs inside the **work-slice workflow** (implement Opus/TDD → up to 5 review rounds → Playwright loop max 3), and under `/goal` a `/babysit-stack` finish stage drives the PR to CI-green with resolved threads.

When to use which:

- **`/feature-goal`** — a feature that needs decisions surfaced: grilling → PRD → sliced stack.
- **`/work-issue`** (this) — a ticket lean enough to implement as-is, interactively, in this worktree.
- **`/solve-ready-tickets`** (personal config) — the same idea run unattended over the whole `agent:ready` queue.

Read `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and `docs/agents/repo-config.md` (→ `repoConfig` for the workflow; missing file → built-in Seranote defaults). If the first two are missing, the checkout is broken — stop.

## Step 1 — Fetch the ticket & gate on leanness

Input: a SER id (or infer from conversation; nothing → ask).

Fetch the issue via the Linear MCP. Hard gates, in order:

1. **`needs:human`** → STOP. Name the decision it needs — never implement it unattended.
2. **`manager:skip`** (a PRD parent or slice) → STOP and redirect: slices belong to `/work-slice`, parents to `/feature-goal`. The lean loop never touches pipeline tickets.
3. **Leanness.** `agent:ready` is the ticket manager's verdict that the ticket is lean + low-risk → proceed. Without it, judge: proceed only if the ticket has **at most one novel decision**, clear scope, no schema/contract redesign, and would ship as one small reviewable PR. Anything bigger (or `risk:high`) → recommend the full pipeline and stop — the user can overrule explicitly.

## Step 2 — Worktree preflight & claim

**This skill does NOT create a worktree or branch** — same rule as `/work-slice`. Confirm before claiming:

- Inside a git worktree (`git rev-parse --is-inside-work-tree`), clean (`git status --porcelain` empty), and the branch is virgin — `git rev-list --count <integrationBranch>..HEAD` prints `0`. Any failure → STOP and tell the user (open a fresh Conductor workspace for the ticket, or commit/stash first).
- **Keep the branch Conductor checked out** — no rename, no stack naming; there is no stack. Base = the integration branch (`development`).

**Claim the ticket:** set status **Dev in progress**; if it carries `agent:ready`, remove that label so the autonomous solver can't grab it concurrently (write back the full existing label set minus only that label — `save_issue.labels` replaces the whole set; never drop `type:*` or product labels).

**Acceptance criteria:** take the ticket's `- [ ]` checkboxes verbatim. If it has none, distill them from the description and post them back as a `## Acceptance criteria` comment (idempotent — update an existing one) so QA evidence has rows to reference. Also collect "where to look" pointers and any Figma links from the body.

## Setting the goal — before the workflow starts

Same pattern as `/feature-goal`: `/goal` is the built-in stop-blocker the **user types** (a skill cannot set it). Steps 1–2 are the only interactive gates, so set it here, once they're cleared. If no goal is active, print the template and ask (carry on identically if the user declines or is away — the skill just won't auto-resume):

```
/goal SER-<n> lean loop done: draft PR open, CI green, Copilot requested,
all review threads resolved — /babysit-stack verdict on the PR reads
GOAL MET (needs-human blockers count as not met)
```

**Re-entry (every /goal iteration) is stage detection from observable state, never memory:**

1. No committed diff vs the integration branch → Step 3 (implement).
2. Committed diff, no open/merged PR for the branch (`gh pr list --state all --head <branch>`) → Step 5 (draft PR). Never re-run the workflow after it returned — converged or cap-hit, its result stands; cap leftovers ride on the PR.
3. Open PR → Step 6 (babysit passes).
4. Last `/babysit-stack` verdict GOAL MET (or the PR merged) → done; report and stop.

## Step 3 — Implement + review loop (Workflow)

One **`Workflow` call** — the sanctioned opt-in. **Do not implement or review in the main session** — the workflow owns implement (Opus, TDD per criterion), the bounded review ⇄ fix loop (max 5 rounds; baseline + web/server lanes + reuse, Sonnet), and the Playwright user-story loop (max 3) on user-facing changes:

```
Workflow({
  scriptPath: ".claude/skills/work-slice/work-slice-loop.workflow.js",
  args: {
    sliceId,             // the SER id
    sliceKind: "delta",  // no skeleton here — mirror existing sibling features
    acceptanceCriteria,  // from Step 2, verbatim
    whereToLook,         // the ticket's pointers, or omit to discover
    conventionContract: "", // no PRD contract — repoConfig.goldenPaths still guides
    figma,               // ticket's Figma links, if any
    baseBranch,          // the integration branch (development)
    prdContract,         // the ticket DESCRIPTION verbatim — the wider intent
    repoConfig           // JSON block from docs/agents/repo-config.md
  }
})
```

`sliceKind: "delta"` makes the implementer mirror existing sibling features (there is no skeleton — siblings are the exemplars); provenance rules stay binding. Verify `args` reached the script — a returned "(unknown slice)" means they didn't; bake literals and re-run.

## Step 4 — Present + Linear bookkeeping

Work-slice Step 4 applies verbatim, minus stack talk: print the summary (AC ticked/flagged, rounds used, converged vs cap-hit with outstanding findings, disputed notes, provenance table, diff stat); upload **QA evidence** to the ticket when the Playwright loop ran (attachment flow + idempotent `## QA evidence` comment, one PASS/FAIL row per criterion); file **consolidation follow-ups** as their own tickets (`type:chore` + `manager:skip`).

## Step 5 — Open the draft PR

No stack, so this is the short form of work-slice Step 5:

1. **Scrub** untracked review scaffolding (`git status --porcelain` — remove every `??`; committed work is never untracked).
2. `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`.
3. **`create-pr`** verbatim (title regex, conflict check, Summary, test plan onto the Linear issue) — then draft it: `pr=$(gh pr view --json number --jq .number); gh pr ready "$pr" --undo`.
4. No `gh stack` anything — the PR stays based on the integration branch.
5. Loop hit its cap? Post the outstanding findings as a `## Outstanding review findings` PR comment so they surface on the draft. Only "no committed diff" skips this step entirely (stop and tell the user).

## Step 6 — Drive the PR to "in order" (babysit passes)

Run **`/babysit-stack <PR number>`** — one pass: Copilot requested (once, ever), CI watched/fixed, review threads addressed + resolved, verdict block at the end. Handle the verdict exactly like `/feature-goal`'s BABYSIT stage:

- **NOT MET, actionable** → run another pass (babysit's per-item caps apply).
- **NOT MET, only pending CI / awaited Copilot** → attempt to stop; the /goal hook bounces and the next iteration re-checks.
- **NOT MET, only `needs-human`** → report the blockers as the stop reason; the human unblocks or `/goal clear`s.
- **GOAL MET** → done. Report the PR + verdict table and stop. The ticket stays **Dev in progress** — the draft PR is the human review gate; never mark it done.

## Boundaries

- One ticket per run. Never batch; never pull adjacent work into the diff.
- **Never merge, approve, mark ready, or mark the issue done** — terminal state is a green, review-resolved **draft** PR.
- Never on pipeline tickets (`manager:skip`) — redirect to `/work-slice` / `/feature-goal`; never on `needs:human` unattended.
- Never create a worktree or branch; never rename the Conductor branch; `av` is decommissioned — never run it; no `gh stack` commands (nothing to stack).
- All constituent caps respected (5 review rounds, 3 Playwright, babysit's fix/thread caps, one Copilot request per PR ever) — caps exhausted → escalate on the PR, never grind.
- The workflow runs **once** per ticket, including across /goal re-entries — persistence after it is babysit passes, not more review rounds.
- Label writes stay additive; never stamp `agent:ready` or `slice:next` on anything; consolidation follow-ups are new tickets, never scope creep.
- `/goal` is user-typed, never self-set; the skill works identically without it.
- Model roles fixed, aliases only (implementers Opus, reviewers/verifier Sonnet) — never pin exact ids or effort.
