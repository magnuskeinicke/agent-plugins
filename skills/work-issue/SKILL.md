---
name: work-issue
description: The LEAN development loop — take a single tracker issue straight to a reviewed draft PR, skipping grilling/PRD/slicing, with no human gates. Runs the same implement + bounded review-fix + Playwright workflow as /work-slice, then babysits the PR (CI, Copilot rounds, CodeRabbit rounds, thread resolution on GitHub) until it is in order. Re-entrant — run it again to resume from durable markers. Meant for lean tickets (the ticket manager's agent-ready label or the user's judgement); a non-lean ticket is worked anyway with the concern disclosed. Use when the user says "work this ticket directly", "run the lean loop on it", "just implement this ticket", "take this issue straight to a PR", or "this doesn't need the full pipeline".
argument-hint: "[issue id]"
---

# Work Issue — the lean loop

Drive **one standalone tracker issue** to a **draft PR**, with the same quality machinery as the big pipeline but none of its planning stages: no grilling, no PRD, no slice split, no stack. The ticket itself is the contract. Implementation runs inside the **work-slice engine-CLI loop** (implement TDD → up to 5 review rounds → Playwright loop max 3), and a `/babysit-stack` finish stage babysits the PR — CI green, `<BOT>` rounds until satisfied, then `<COMMENT-BOT>` rounds until satisfied, every thread resolved — waiting for each bot round itself. **No human gates**: the user invoking this skill on a ticket is the decision; the only stops are safety stops (dirty worktree, no diff, gut-check hard-stop) and `needs-human` escalations babysit cannot resolve. **Run the skill again to resume.**

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
| `<BOT>` | `pr.botReviewer` | babysit skips the review-request bot phase |
| `<COMMENT-BOT>` | `pr.commentReviewer` | babysit skips the comment-summoned bot phase |
| `<MEDIA-BRANCH>` | `pr.mediaBranch` | `pr-media` — created as an orphan branch on first publish |

Also read `tracker.docPath` and `labels.docPath` when they exist.

## Step 1 — Fetch the ticket & gate on leanness

Input: an issue id (or infer from conversation; nothing → ask).

Fetch the issue from `<TRACKER>`. Classify — none of these stops the run or asks the user:

1. **`<HITL>`** (or a "needs a human decision" line) → not a gate. Read the decision, pick the option most consistent with the ticket and the codebase, record it for the PR's `## Assumptions` comment (Step 5) — **not** on the ticket: a standalone ticket is QA-visible and gets only the `## QA handoff` comment (`../work-slice/references/qa-handoff.md`) — and proceed.
2. **`<SKIP>`** (a pipeline ticket) → wrong tool, right invocation: a **slice** (its parent is a `PRD:` ticket) → run **`/work-slice <id>`** now, in this invocation, and stop this skill; a **PRD ticket** or a **feature ticket** with a `PRD:` sub-issue → run **`/feature-goal <id>`** now instead. Never run the lean loop on pipeline tickets, never send the user off to type the other command.
3. **Leanness.** `<AGENT-READY>` is the ticket manager's verdict that the ticket is lean + low-risk. Without it, judge: lean = **at most one novel decision**, clear scope, no schema/contract redesign, one small reviewable PR. **Not lean → still proceed** (the user chose the lean loop), but say so once in the terminal and post a `## Leanness concern` PR comment naming what would have warranted the full pipeline (extra decisions taken, contract touched), so the reviewer knows where to look.

## Step 2 — Worktree preflight & claim

**This skill does NOT create a worktree or branch** — same rule as `/work-slice`. Confirm before claiming:

- Inside a git worktree (`git rev-parse --is-inside-work-tree`), clean (`git status --porcelain` empty), and the branch is virgin — `git rev-list --count <BASE>..HEAD` prints `0`. Any failure → STOP and tell the user (open a fresh Conductor workspace for the ticket, or commit/stash first).
- **Keep the branch Conductor checked out** — no rename, no stack naming; there is no stack. Base = `<BASE>`.

**Claim the ticket:** set status **`<IN-PROGRESS>`**; if it carries `<AGENT-READY>`, remove that label so the autonomous solver can't grab it concurrently (write back the full existing label set minus only that label — Linear's `save_issue.labels` replaces the whole set; never drop type or product labels).

**Acceptance criteria:** take the ticket's `- [ ]` checkboxes verbatim. If it has none, distill them from the description — user-facing wording, per `../work-slice/references/qa-handoff.md` — and keep them in the run contract; they surface on the ticket only inside the Step 4 `## QA handoff` comment, never as a separate `## Acceptance criteria` comment. Also collect "where to look" pointers and any Figma links from the body.

## Resume — run again to continue

There is no stop-hook: **persistence is re-invocation.** One invocation runs to the terminal state (babysit GOAL MET) or to a Blocked boundary (only `needs-human` items left), then ends with a report naming where the ticket stands and that `/work-issue <ISSUE>` resumes it. It never ends merely because something is pending — babysit waits for CI and bot rounds itself.

**Re-entry is stage detection from durable markers, never memory** (mid-Step-3 resume belongs to work-slice's own `## Workflow State` checkpoint in `.context/<issue-id>/workflow-state.md` and the engine CLI's `status`):

1. No committed diff vs `<BASE>` → Step 3 (implement).
2. Committed diff, no open/merged PR for the branch (`gh pr list --state all --head <branch>`) → Step 5 (draft PR). Never re-run the review loop after its verdict — converged or stalled, the result stands; leftovers ride on the PR.
3. Open PR → Step 6 (babysit).
4. Last `/babysit-stack` verdict GOAL MET (or the PR merged) → done; report and stop.

## Step 3 — Implement + review loop (engine CLI)

Work-slice Step 3 applies verbatim — implement pass, then the engine-CLI review ⇄ fix loop (`init → plan → collect → decide → apply-fix → adjudicate → report`, loop control from the CLI's JSON output), then the Playwright user-story loop (max 3) on user-facing changes — including the before pre-capture in 3.1, the PR scene captures in 3.5, and the `evidence/verification.jsonl` row every gate run appends (`../work-slice/references/pr-evidence.md`). The run contract you write to `.context/<issue-id>/contract.md` maps this way:

- slice id = the issue id; **Kind = delta**, with sibling features as the exemplars (there is no skeleton — mirror existing siblings; provenance rules stay binding).
- acceptance criteria = Step 2's, verbatim; where-to-look = the ticket's pointers, or omit to let the implementer discover.
- convention contract = empty (no PRD contract — `repoConfig.goldenPaths` still guides); Figma = the ticket's links, if any.
- the wider contract = the ticket DESCRIPTION verbatim; `--base` = `<BASE>`.

## Step 4 — Present + tracker bookkeeping

Work-slice Step 4 applies verbatim, minus stack talk: print the summary (AC ticked/flagged, rounds used, converged vs cap-hit with outstanding findings, disputed notes, provenance table, diff stat); then write the **`## QA handoff`** comment on the ticket per `../work-slice/references/qa-handoff.md` — the ticket's one suite-authored comment, for a QA reader with no code access: per acceptance criterion — grouped where one walk-through covers several — the steps in user terms, the expected result, and the evidence (one video *or* screenshot per group, never both for the same thing, aim 1–3 artifacts — visual only, uploaded via the tracker's attachment flow, never GitHub raw URLs), a **Not working yet** line for anything that failed, one engineering PR link at the bottom. Idempotent. Nothing else goes on the ticket: no `## QA evidence` table, no assumptions, no leanness concern. Internal-only change with no Playwright run → a one-paragraph handoff saying there is nothing for QA to see and why. File **consolidation follow-ups** as their own tickets (chore type label + `<SKIP>`).

## Step 5 — Open the draft PR

No stack, so this is the short form of work-slice Step 5:

1. **Scrub** untracked review scaffolding (`git status --porcelain` — remove every `??`; committed work is never untracked).
2. `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`.
3. **`<PR-SKILL>`** verbatim (title regex, conflict check, Summary, test plan onto the tracker issue) — then draft it: `pr=$(gh pr view --json number --jq .number); gh pr ready "$pr" --undo`.
4. **Publish media + evidence sections** per `../work-slice/references/pr-evidence.md`: `.context/<issue-id>/evidence/media/` to `<MEDIA-BRANCH>` under `pr/<n>/` (sha-pinned URLs), then `## Verification` (from `evidence/verification.jsonl`) and `## Visual verification` (from `media.json`, or its one-line internal-only / uncapturable form) into the body — handed to `<PR-SKILL>` where it has a slot, else one `gh pr edit --body-file` insert, before any bot is requested. Rows and captures from this run only.
5. No stack commands — the PR stays based on `<BASE>`.
6. Loop hit its cap? Post the outstanding findings as a `## Outstanding review findings` PR comment so they surface on the draft. Add `## Assumptions` / `## Leanness concern` sections when Step 1 recorded any. Only "no committed diff" skips this step entirely (stop and tell the user).

## Step 6 — Babysit the PR to "in order"

Run **`/babysit-stack <PR number>`**. It is a babysitting mode, not a pass: CI green first, then `<BOT>` (Copilot) requested and fixed until satisfied, then `<COMMENT-BOT>` (CodeRabbit) summoned by PR comment and fixed until satisfied, every thread resolved — each bot round waited for with bounded polls, each fix a fresh agent, all of it on GitHub. It returns only with a terminal verdict:

- **GOAL MET** → done. Report the PR + verdict table + assumptions and stop. The ticket stays **`<IN-PROGRESS>`** — the draft PR is the human review gate; never mark it done.
- **NOT MET** → nothing actionable is left (only `needs-human` threads, a stuck bot, or a capped fix signature). Report the blockers verbatim as the stop reason and end; the human resolves them on the PR, then re-invokes — babysit resumes from its state file. Never re-run babysit back-to-back on the same NOT MET state.

## Boundaries

- One ticket per run. Never batch; never pull adjacent work into the diff.
- **Never merge, approve, mark ready, or mark the issue done** — terminal state is a green, review-resolved **draft** PR.
- **No human gates.** `<HITL>` becomes a recorded assumption; a non-lean ticket is worked with a disclosed concern; `<SKIP>` tickets are handed to `/work-slice` / `/feature-goal` **in this invocation**, never bounced to the user. The only stops are safety stops and babysit's `needs-human` escalations.
- Never create a worktree or branch; never rename the Conductor branch; no stack commands (nothing to stack).
- All constituent caps respected (5 review rounds, 3 Playwright, babysit's fix/thread caps and 5 rounds per bot) — caps exhausted → escalate on the PR, never grind. Bot reviews happen on GitHub only; never run a review CLI.
- The review loop runs **once** per ticket, including across re-invocations — persistence after it is babysit, not more review rounds.
- Label writes stay additive; never stamp `<AGENT-READY>` or `labels.sliceNext` on anything; consolidation follow-ups are new tickets, never scope creep.
- **Persistence is re-invocation, never a stop-hook.** A run ends at GOAL MET or Blocked (`needs-human` only), always with the resume report; pending CI or bot rounds are waited on by babysit, never a reason to end.
- Model roles fixed, aliases only (implementers Opus, reviewers/verifier Sonnet) — never pin exact ids or effort.

## Workflow Boundaries

**This skill takes one lean tracker issue straight to a green, bot-satisfied, thread-resolved draft PR — no planning stages, no stack, no human gates.**

- **DOES**: classify leanness (`<AGENT-READY>` or judged, disclosed when not lean), record HITL decisions as PR assumptions, claim the ticket, write the QA-facing `## QA handoff` on it, run work-slice's implement + engine-CLI review loop + Playwright verbatim, open the draft PR via `<PR-SKILL>` + `gh pr ready --undo` with `## Verification` + `## Visual verification` in its body, run `/babysit-stack` to its terminal verdict.
- **DOES NOT**: ask the human anything, grill / write PRDs / slice (`/feature-goal`), work pipeline tickets (`<SKIP>` → hands off to `/work-slice` / `/feature-goal` in-invocation), create or rename worktrees/branches, run stack commands, mark the issue done or the PR ready.

## Red Flags — STOP

- About to stop for a `<HITL>` label or ask the user a decision — stop stopping: decide, record it for the PR's `## Assumptions` comment, proceed.
- About to post assumptions, acceptance criteria, a PASS/FAIL table, or any dev material on the ticket — stop: the ticket gets one `## QA handoff` comment; everything else is a PR comment.
- Ticket carries `<SKIP>` — don't run the lean loop and don't bounce the user: run `/work-slice <id>` (slice) or `/feature-goal <id>` (PRD or feature ticket) in this invocation.
- About to end because the ticket isn't lean — stop: proceed with a `## Leanness concern` PR comment; the user chose this loop.
- About to end because CI or a bot review is pending, or to wait for it yourself — stop: `/babysit-stack` waits; a run ends only at GOAL MET or Blocked.
- Worktree dirty, not a worktree, or the branch isn't virgin (`git rev-list --count <BASE>..HEAD` ≠ 0) — stop and tell the user.
- About to create/rename a branch or run a stack command — stop: keep Conductor's checkout, base stays `<BASE>`.
- About to re-run the review loop after its verdict on a re-invocation — stop: converged or stalled, the result stands; leftovers ride the PR.
- About to run a review CLI — stop: bot reviews happen on GitHub, through babysit.
- About to mark the issue done or the PR ready on GOAL MET — stop: the ticket stays `<IN-PROGRESS>`; the draft PR is the human review gate.

## Verification

Before reporting done:

- [ ] Claim done right: status `<IN-PROGRESS>`, `<AGENT-READY>` removed via an additive label write (full set minus only that label).
- [ ] No question was put to the human: HITL decisions live under the PR's `## Assumptions` comment (not on the ticket); a non-lean ticket has its `## Leanness concern` PR comment; a `<SKIP>` ticket was handed to the right skill in-invocation.
- [ ] Acceptance criteria exist in the run contract — the ticket's verbatim checkboxes, or user-facing ones distilled for the `## QA handoff`.
- [ ] Draft PR open against `<BASE>` with `isDraft: true`; a cap-hit loop left a `## Outstanding review findings` PR comment.
- [ ] PR body carries `## Verification` + `## Visual verification` per `pr-evidence.md` — rows and captures from this run only, media on `<MEDIA-BRANCH>` by sha (or the one-line forms), one body write.
- [ ] The ticket carries exactly one suite-authored comment — `## QA handoff` per `qa-handoff.md` (user-terms steps, one visual artifact per criteria group, Not-working-yet line, PR link) — and no dev material; consolidation follow-ups filed as tickets with `<SKIP>`.
- [ ] The run ended at GOAL MET or Blocked (`needs-human` only — named), never on pending CI / bot rounds; the report says `/work-issue <ISSUE>` resumes; done claimed only on a babysit GOAL MET verdict.
