---
name: work-issue
description: The LEAN development loop — take a single tracker issue straight to a reviewed draft PR, skipping grilling/PRD/slicing. Runs the same implement + bounded review-fix + Playwright workflow as /work-slice, then drives the PR to green under /goal via /babysit-stack. For lean tickets only — as judged by the ticket manager's agent-ready label or the user. Use when the user says "work this ticket directly", "run the lean loop on it", "just implement this ticket", "take this issue straight to a PR", or "this doesn't need the full pipeline".
argument-hint: "[issue id]"
---

# Work Issue — the lean loop

Drive **one standalone tracker issue** to a **draft PR**, with the same quality machinery as the big pipeline but none of its planning stages: no grilling, no PRD, no slice split, no stack. The ticket itself is the contract. Implementation runs inside the **work-slice engine-CLI loop** (implement TDD → up to 5 review rounds → Playwright loop max 3), and under `/goal` a `/babysit-stack` finish stage drives the PR to CI-green with resolved threads.

When to use which:

- **`/feature-goal`** — a feature that needs decisions surfaced: grilling → PRD → sliced stack.
- **`/work-issue`** (this) — a ticket lean enough to implement as-is, interactively, in this worktree.
- **`/solve-ready-tickets`** — the same idea run unattended over the whole `<AGENT-READY>` queue.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). The engine CLI
reads the same file itself; the placeholders below stand for its values;
missing file or empty key → use the fallback and say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | leave the status untouched |
| `<AGENT-READY>` | `labels.agentReady` | no leanness verdict from triage — judge it yourself |
| `<HITL>` | `labels.needsHuman` | read "needs a human decision" from the ticket body |
| `<SKIP>` | `labels.managerSkip` | no pipeline marker — judge from the ticket's parent/children |
| `<PR-SKILL>` | `skills.createPr` | `gh pr create --base <BASE> --draft`, title per `pr.titleRule` |
| `<BOT>` | `pr.botReviewer` | no bot review round |

Also read `tracker.docPath` and `labels.docPath` when they exist.

## Step 1 — Fetch the ticket & gate on leanness

Input: an issue id (or infer from conversation; nothing → ask).

Fetch the issue from `<TRACKER>`. Hard gates, in order:

1. **`<HITL>`** → STOP. Name the decision it needs — never implement it unattended.
2. **`<SKIP>`** (a PRD parent or slice) → STOP and redirect: slices belong to `/work-slice`, parents to `/feature-goal`. The lean loop never touches pipeline tickets.
3. **Leanness.** `<AGENT-READY>` is the ticket manager's verdict that the ticket is lean + low-risk → proceed. Without it, judge: proceed only if the ticket has **at most one novel decision**, clear scope, no schema/contract redesign, and would ship as one small reviewable PR. Anything bigger (or a high-risk label) → recommend the full pipeline and stop — the user can overrule explicitly.

## Step 2 — Worktree preflight & claim

**This skill does NOT create a worktree or branch** — same rule as `/work-slice`. Confirm before claiming:

- Inside a git worktree (`git rev-parse --is-inside-work-tree`), clean (`git status --porcelain` empty), and the branch is virgin — `git rev-list --count <BASE>..HEAD` prints `0`. Any failure → STOP and tell the user (open a fresh Conductor workspace for the ticket, or commit/stash first).
- **Keep the branch Conductor checked out** — no rename, no stack naming; there is no stack. Base = `<BASE>`.

**Claim the ticket:** set status **`<IN-PROGRESS>`**; if it carries `<AGENT-READY>`, remove that label so the autonomous solver can't grab it concurrently (write back the full existing label set minus only that label — Linear's `save_issue.labels` replaces the whole set; never drop type or product labels).

**Acceptance criteria:** take the ticket's `- [ ]` checkboxes verbatim. If it has none, distill them from the description and post them back as a `## Acceptance criteria` comment (idempotent — update an existing one) so QA evidence has rows to reference. Also collect "where to look" pointers and any Figma links from the body.

## Setting the goal — before the loop starts

Same pattern as `/feature-goal`: `/goal` is the built-in stop-blocker the **user types** (a skill cannot set it). Steps 1–2 are the only interactive gates, so set it here, once they're cleared. If no goal is active, print the template and ask (carry on identically if the user declines or is away — the skill just won't auto-resume):

```
/goal <ISSUE> lean loop done: draft PR open, CI green, <BOT> requested,
all review threads resolved — /babysit-stack verdict on the PR reads
GOAL MET (needs-human blockers count as not met)
```

**Re-entry (every /goal iteration) is stage detection from observable state, never memory:**

1. No committed diff vs `<BASE>` → Step 3 (implement).
2. Committed diff, no open/merged PR for the branch (`gh pr list --state all --head <branch>`) → Step 5 (draft PR). Never re-run the review loop after its verdict — converged or stalled, the result stands; leftovers ride on the PR.
3. Open PR → Step 6 (babysit passes).
4. Last `/babysit-stack` verdict GOAL MET (or the PR merged) → done; report and stop.

## Step 3 — Implement + review loop (engine CLI)

Work-slice Step 3 applies verbatim — implement pass, then the engine-CLI review ⇄ fix loop (`init → plan → collect → decide → apply-fix → adjudicate → report`, loop control from the CLI's JSON output), then the Playwright user-story loop (max 3) on user-facing changes. The run contract you write to `.context/<issue-id>/contract.md` maps this way:

- slice id = the issue id; **Kind = delta**, with sibling features as the exemplars (there is no skeleton — mirror existing siblings; provenance rules stay binding).
- acceptance criteria = Step 2's, verbatim; where-to-look = the ticket's pointers, or omit to let the implementer discover.
- convention contract = empty (no PRD contract — `repoConfig.goldenPaths` still guides); Figma = the ticket's links, if any.
- the wider contract = the ticket DESCRIPTION verbatim; `--base` = `<BASE>`.

## Step 4 — Present + tracker bookkeeping

Work-slice Step 4 applies verbatim, minus stack talk: print the summary (AC ticked/flagged, rounds used, converged vs cap-hit with outstanding findings, disputed notes, provenance table, diff stat); upload **QA evidence** to the ticket when the Playwright loop ran (attachment flow + idempotent `## QA evidence` comment, one PASS/FAIL row per criterion); file **consolidation follow-ups** as their own tickets (chore type label + `<SKIP>`).

## Step 5 — Open the draft PR

No stack, so this is the short form of work-slice Step 5:

1. **Scrub** untracked review scaffolding (`git status --porcelain` — remove every `??`; committed work is never untracked).
2. `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`.
3. **`<PR-SKILL>`** verbatim (title regex, conflict check, Summary, test plan onto the tracker issue) — then draft it: `pr=$(gh pr view --json number --jq .number); gh pr ready "$pr" --undo`.
4. No stack commands — the PR stays based on `<BASE>`.
5. Loop hit its cap? Post the outstanding findings as a `## Outstanding review findings` PR comment so they surface on the draft. Only "no committed diff" skips this step entirely (stop and tell the user).

## Step 6 — Drive the PR to "in order" (babysit passes)

Run **`/babysit-stack <PR number>`** — one pass: `<BOT>` requested (once, ever), CI watched/fixed, review threads addressed + resolved, verdict block at the end. Handle the verdict exactly like `/feature-goal`'s BABYSIT stage:

- **NOT MET, actionable** → run another pass (babysit's per-item caps apply).
- **NOT MET, only pending CI / an awaited `<BOT>` review** → attempt to stop; the /goal hook bounces and the next iteration re-checks.
- **NOT MET, only `needs-human`** → report the blockers as the stop reason; the human unblocks or `/goal clear`s.
- **GOAL MET** → done. Report the PR + verdict table and stop. The ticket stays **`<IN-PROGRESS>`** — the draft PR is the human review gate; never mark it done.

## Boundaries

- One ticket per run. Never batch; never pull adjacent work into the diff.
- **Never merge, approve, mark ready, or mark the issue done** — terminal state is a green, review-resolved **draft** PR.
- Never on pipeline tickets (`<SKIP>`) — redirect to `/work-slice` / `/feature-goal`; never on `<HITL>` unattended.
- Never create a worktree or branch; never rename the Conductor branch; no stack commands (nothing to stack).
- All constituent caps respected (5 review rounds, 3 Playwright, babysit's fix/thread caps, one bot review request per PR ever) — caps exhausted → escalate on the PR, never grind.
- The review loop runs **once** per ticket, including across /goal re-entries — persistence after it is babysit passes, not more review rounds.
- Label writes stay additive; never stamp `<AGENT-READY>` or `labels.sliceNext` on anything; consolidation follow-ups are new tickets, never scope creep.
- `/goal` is user-typed, never self-set; the skill works identically without it.
- Model roles fixed, aliases only (implementers Opus, reviewers/verifier Sonnet) — never pin exact ids or effort.
