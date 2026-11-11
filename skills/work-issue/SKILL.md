---
name: work-issue
description: The LEAN development loop — take a single tracker issue straight to a reviewed draft PR, skipping grilling/PRD/slicing, with no human gates. Runs the same implement + bounded review-fix + Playwright workflow as /work-slice, then babysits the PR (CI, Copilot rounds, CodeRabbit rounds, thread resolution on GitHub) until it is in order, and only then captures the visual evidence — once — for the PR body and the ticket's single concise QA handoff comment. Re-entrant — run it again to resume from durable markers. Meant for lean tickets (the ticket manager's agent-ready label or the user's judgement); a non-lean ticket is worked anyway with the concern disclosed. Use when the user says "work this ticket directly", "run the lean loop on it", "just implement this ticket", "take this issue straight to a PR", or "this doesn't need the full pipeline".
argument-hint: "[issue id]"
---

# Work Issue — the lean loop

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `work-issue`; supporting skills inherit the caller’s resolved role.

At entry, resolve bootstrap/checkpoint configuration under the shared runtime
contract **before** placeholders, tracker reads or stage detection. A pinned
config takes precedence over the checked-out branch for every setting and is
passed to all constituent skills; a missing named snapshot blocks the run.


Drive **one standalone tracker issue** to a **draft PR**, with the same quality machinery as the big pipeline but none of its planning stages: no grilling, no PRD, no slice split, no stack. The ticket itself is the contract. Implementation runs inside the **work-slice engine-CLI loop** (implement TDD → up to 5 review rounds → Playwright loop max 3), and a `/babysit-stack` finish stage babysits the PR — CI green, `<BOT>` rounds until satisfied, then `<COMMENT-BOT>` rounds until satisfied, every thread resolved — waiting for each bot round itself. Only once that lands is anything **captured**: one Playwright capture run fills the PR body's `## Visual verification` and the ticket's one comment, a concise, inline-illustrated `## QA handoff`, from the same files. Nothing visual exists before GOAL MET, and no proof is ever shown twice. **No human gates**: the user invoking this skill on a ticket is the decision; the only stops are safety stops (dirty worktree, no diff, gut-check hard-stop) and `needs-human` escalations babysit cannot resolve. **Run the skill again to resume.**

When to use which:

- **`/feature-goal`** — a feature that needs decisions surfaced: grilling → PRD → sliced stack.
- **`/work-issue`** (this) — a ticket lean enough to implement as-is, interactively, in this worktree.
- **`/solve-ready-tickets`** — the same idea run unattended over the whole `<AGENT-READY>` queue: it triages, then fans out one cloud workspace per ticket, each running **this skill**. A session started that way is an ordinary `/work-issue` invocation — the fresh workspace happens to satisfy the Step 2 preflight exactly.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). The engine CLI
reads the same file itself; the placeholders below stand for its values;
missing file or empty key → use the fallback and say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `$CONDUCTOR_DEFAULT_BRANCH` (the local Conductor repo's base branch), else `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | discover Dev in progress via the shared lifecycle |
| `<IN-REVIEW>` | `tracker.statuses.inReview` | discover Dev technical review via the shared lifecycle |
| `<DONE>` | `tracker.statuses.done` | discover Done for owned generated children via the shared lifecycle |
| `<AGENT-READY>` | `labels.agentReady` | no leanness verdict from triage — judge it yourself |
| `<HITL>` | `labels.needsHuman` | read "needs a human decision" from the ticket body |
| `<SKIP>` | `labels.managerSkip` | no pipeline marker — judge from the ticket's parent/children |
| `<PR-SKILL>` | `skills.createPr` | `gh pr create --base <BASE> --draft`, title per `pr.titleRule` |
| `<BOT>` | `pr.botReviewer` | babysit skips the review-request bot phase |
| `<COMMENT-BOT>` | `pr.commentReviewer` | babysit skips the comment-summoned bot phase |
| `<MEDIA-BRANCH>` | `pr.mediaBranch` | `pr-media` — created as an orphan branch on first publish |
| `<COMMIT-RULE>` | `commit.format` / `commit.pattern` — resolved by the engine (`node "$engine" commit-rule`) | the `pr.titleRule` / `pr.scopes` shape, else `<type>: <subject>` |

Also read `tracker.docPath` and `labels.docPath` when they exist.
Read [the shared issue lifecycle](../work-slice/references/issue-lifecycle.md)
for ownership, status resolution, PR links and finalization. This ticket is the
human parent; a standalone run does not create a child just to link a PR.

## Step 1 — Fetch the ticket & gate on leanness

Input: an issue id (or infer from conversation; nothing → ask).

Fetch the issue from `<TRACKER>`. Classify — none of these stops the run or asks the user:

1. **`<HITL>`** (or a "needs a human decision" line) → not a gate. Read the decision, pick the option most consistent with the ticket and the codebase, record it as one bullet for the PR body's `## Notes` (Step 5) — **not** on the ticket: a standalone ticket is QA-visible and gets exactly one suite comment, the `## QA handoff`, and not until Step 7 (`../work-slice/references/qa-handoff.md`) — and proceed.
2. **`<SKIP>`** (a pipeline ticket) → wrong tool, right invocation: a **slice** (its parent is a `PRD:` ticket) → run **`/work-slice <id>`** now, in this invocation, and stop this skill; a **PRD ticket** or a **feature ticket** with a `PRD:` sub-issue → run **`/feature-goal <id>`** now instead. Never run the lean loop on pipeline tickets, never send the user off to type the other command.
3. **Leanness.** `<AGENT-READY>` is the ticket manager's verdict that the ticket is lean + low-risk. Without it, judge: lean = **at most one novel decision**, clear scope, no schema/contract redesign, one small reviewable PR. **Not lean → still proceed** (the user chose the lean loop), but say so once in the terminal and carry one `## Notes` bullet into the PR body naming what would have warranted the full pipeline (extra decisions taken, contract touched), so the reviewer knows where to look. Never a PR comment; never anything on the ticket.

## Step 2 — Worktree preflight & claim

**Resolve Resume below before fresh-run preflight or claiming.** This skill does not create or rename the worktree/branch. A recorded run resumes on its recorded branch; only a new run needs a virgin branch:

- Inside a git worktree (`git rev-parse --is-inside-work-tree`), clean (`git status --porcelain` empty), and the branch is virgin — `git rev-list --count <BASE>..HEAD` prints `0`. Any failure → STOP and tell the user (open a fresh Conductor workspace for the ticket, or commit/stash first).
- **Keep the branch Conductor checked out** — no rename, no stack naming; there is no stack. Base = `<BASE>`.

**Claim the ticket** per `issue-lifecycle.md`: preserve/resolve its assignee,
record the run/workspace owner, set status **`<IN-PROGRESS>`**, and remove only
`<AGENT-READY>` from its full label set. Read the claim back. A denied cloud
claim must be applied by the caller before dispatch; queuing it is not a claim.

**Acceptance criteria:** take the ticket's `- [ ]` checkboxes verbatim. If it has none, distill them from the description — user-facing wording, per `../work-slice/references/qa-handoff.md` — and keep them in the run contract; they surface on the ticket only inside the Step 7 `## QA handoff` comment, never as a separate `## Acceptance criteria` comment and never before the PR is done. Also collect "where to look" pointers and any Figma links from the body.

## Resume — run again to continue

There is no stop-hook: **persistence is re-invocation.** One invocation runs to the terminal state (babysit GOAL MET, handoff written) or to a Blocked boundary (only `needs-human` items left), then ends with a report naming where the ticket stands and that `/work-issue <ISSUE>` resumes it. It never ends merely because something is pending — babysit waits for CI and bot rounds itself.

**Re-entry is stage detection from durable markers, never memory** (mid-Step-3 resume belongs to work-slice's own `## Workflow State` checkpoint in `.context/<issue-id>/workflow-state.md` and the engine CLI's `status`):

1. Read `.context/<issue-id>/workflow-state.md`, the engine `status` (if a ledger exists), the branch’s PR and head. Verify the recorded branch/base before proceeding. Reconcile ownership/status per `issue-lifecycle.md`; repair a missed claim without resetting an already handed-off parent. Do not apply the virgin-branch check to an owned run.
2. No implementation checkpoint/result → Step 3 implementation. A dirty tree left by the recorded worker can be resumed only after matching its exact owned files against its result/checkpoint; unknown changes are preserved and reported.
3. Implemented but engine absent or phase not `done` → resume Step 3 at `init` or the pending task from `status`. A committed diff alone is never proof of review. `incomplete` coverage resumes the same reviewer round.
4. Engine terminal verdict recorded, browser verification not recorded → finish Step 3.5. A gut-check hard stop remains blocked; do not open a PR. Only a recorded converged/stalled verdict may pass to the next stage.
5. Review and verification recorded, no PR → Steps 4–5. Never rerun a completed review merely because PR creation was interrupted.
6. Open PR without current-head babysit GOAL MET → Step 6.
7. Current-head babysit GOAL MET, evidence, QA handoff, PR issue links or final tracker statuses missing/stale → Step 7. Match the evidence `sourceHead` to the PR head; update stale media and the existing handoff by id. Resume only pending tracker writes when the rest is current.
8. Current-head verdict, current evidence, handoff, PR issue mapping, parent `<IN-REVIEW>` and any owned generated descendants `<DONE>` all verified → complete.

Checkpoint every boundary using work-slice’s stage names. Reality wins over the checkpoint, but a missing stage is not inferred from a later commit. A merged PR is read-only history: reuse verified evidence or name the gap; do not restart implementation on it.

## Step 3 — Implement + review loop (engine CLI)

Work-slice Step 3 applies verbatim — implement pass, then the engine-CLI review ⇄ fix loop (`init → plan → collect → decide → apply-fix → adjudicate → report`, loop control from the CLI's JSON output), then the Playwright user-story loop (max 3) on user-facing changes. That loop is **verification only — it captures nothing** (3.5); the only artifacts it leaves are the `evidence/verification.jsonl` rows every gate run appends (`../work-slice/references/pr-evidence.md`). All visual evidence comes from Step 7, after GOAL MET. The run contract you write to `.context/<issue-id>/contract.md` maps this way:

- slice id = the issue id; **Kind = delta**, with sibling features as the exemplars (there is no skeleton — mirror existing siblings; provenance rules stay binding).
- acceptance criteria = Step 2's, verbatim; where-to-look = the ticket's pointers, or omit to let the implementer discover.
- convention contract = empty (no PRD contract — `repoConfig.goldenPaths` still guides); Figma = the ticket's links, if any.
- the wider contract = the ticket DESCRIPTION verbatim; `--base` = `<BASE>`.
- commits follow `<COMMIT-RULE>`: the implementer's brief carries `commit-rule --issue <issue-id> --type <type> --scope <scope>`'s `text`, and `init` gets the same `--commit-type` / `--commit-scope` — the PR's type/scope. Most lean tickets ship as a single commit, and a host that squash-merges it under its commit subject rejects a wrong one only at merge time.

## Step 4 — Present + follow-ups

Work-slice Step 4 applies verbatim, minus stack talk and **minus every tracker write**: print the terminal summary (AC ticked/flagged, rounds used, converged vs cap-hit with outstanding findings, disputed notes, provenance table, diff stat) and file **only what `node "$engine" followups --slice <issue-id>` returns**, per `../work-slice/references/followups.md`: at most one own ticket, the rest appended to the single rolling `Follow-ups: consolidation candidates` ticket, deduped by marker, `demoted` never filed. Verified defects outside the diff (a pre-existing production bug, a test gap that belongs to shipped code or a sibling ticket) are filed per that reference's `## Discoveries`: at most one bug ticket and one test-gap ticket, never a question to the user. Nothing else becomes a ticket.

**Nothing at all is written on the ticket in this step.** A standalone ticket is the human's: it gets one suite comment, the `## QA handoff`, and it is written in **Step 7 — after the PR is done**, so it can never go stale behind a bot round (`../work-slice/references/qa-handoff.md`). No `## QA evidence` table, no acceptance criteria, no assumptions, no progress note, ever. Keep the run's evidence in `.context/<issue-id>/evidence/` for Step 5 and Step 7 to render from.

## Step 5 — Open the draft PR

No stack, so this is the short form of work-slice Step 5:

1. **Remove only owned scratch files** recorded before creation in `scratch-files.json`. Preserve all other untracked files; status alone does not prove they are scaffolding.
2. **Commit-subject gate, then push.** `node "$engine" commit-check --slice <issue-id> --base <BASE>` must print `ok: true` — every `git log <BASE>..HEAD --format=%s` subject matches `<COMMIT-RULE>` — before anything is pushed or a reviewer sees the PR. On `ok: false`, reword the listed commits (`git commit --amend -m` for HEAD, else `git reset --soft <BASE>` and one conforming commit) and re-check. Then `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`.
3. **`<PR-SKILL>`** for the title regex, conflict check and Summary; pass the parent ID/URL and the shared lifecycle's `## Issues` section. Keep test plans in the PR body to preserve the human ticket's one-comment rule. Then draft it: `pr=$(gh pr view --json number --jq .number); gh pr ready "$pr" --undo`.
4. **Write `## Verification`** per `../work-slice/references/pr-evidence.md`, rendered from `evidence/verification.jsonl` — handed to `<PR-SKILL>` where it has a slot, else one `gh pr edit --body-file` insert, before any bot is requested. Include/repair `## Issues` in that write and read it back: the parent URL must appear without an auto-closing keyword. Rows from this run only. **No `## Visual verification` and no media publish here** — that is Step 7's, after GOAL MET.
5. No stack commands — the PR stays based on `<BASE>`.
6. **`## Notes` rides in the same body write** — never a PR comment. At most five one-line bullets, only when a human must act: each assumption Step 1 recorded, each finding a cap-hit loop shipped unfixed, the leanness concern if there is one, the follow-up and discovery tickets filed in Step 4 (id + one clause each) and the rolling-ticket append (`N candidates appended to <id>`), and each decision taken for another plugin's gate. Nothing to say → omit the section. Only "no committed diff" skips this step entirely (stop and tell the user).

## Step 6 — Babysit the PR to "in order"

Run **`/babysit-stack <PR number>`**. It is a babysitting mode, not a pass: CI green first, then `<BOT>` (Copilot) requested and fixed until satisfied, then `<COMMENT-BOT>` (CodeRabbit) summoned by PR comment and fixed until satisfied, every thread resolved — each bot round waited for with bounded polls, each fix a fresh agent, all of it on GitHub. It returns only with a terminal verdict:

- **GOAL MET** → go to Step 7, including tracker finalization: the parent moves
  to **`<IN-REVIEW>`** after the handoff, while the PR remains draft.
- **NOT MET** → nothing actionable is left (only `needs-human` threads, stuck CI, or a capped fix signature; a rate-limited or unavailable review bot is skipped and disclosed, never a blocker). Report the blockers verbatim as the stop reason and end — **capturing nothing and posting no handoff**; evidence and the handoff are owed only to a finished PR. The human resolves the blockers on the PR, then re-invokes — babysit resumes from its state file. Never re-run babysit back-to-back on the same NOT MET state.

## Step 7 — Capture the evidence, then write the QA handoff

Only reachable on a babysit **GOAL MET** verdict. Capture, handoff, then tracker
finalization, in that order. The capture feeds both the PR body and the ticket.
On resume, reuse verified current evidence/handoff and run only missing steps.

**7a. Capture + publish + the PR body** — the capture stage in `../work-slice/references/pr-evidence.md`, identical to work-slice Step 8: on the PR's branch at the head CI went green on, with the one dev server serving it, started per `../work-slice/references/run-app.md` (the Conductor run script for this environment, never the e2e harness; no translation keys on screen), a throwaway Playwright spec drives the acceptance-criterion stories and captures the fewest scenes that prove the change (aim 1–3, video for behaviour, still for appearance, finished state only — no before shots), passing the secret preflight before any shot. Publish `.context/<issue-id>/evidence/media/` to `<MEDIA-BRANCH>` under `pr/<n>/` (sha-pinned URLs), insert `## Visual verification` into the body with **one** `gh pr edit`, delete the throwaway spec. Internal-only change or no dev stack → the section's one-line form, and the handoff says there is nothing for QA to see. A user story that fails here is a **real regression** on a green PR: stop and report it, never doctor the capture.

**7b. The QA handoff** — the ticket's **one** suite comment per `../work-slice/references/qa-handoff.md`, embedding the **same** files 7a captured (never a second capture run), for a QA reader with no code access:

- written for a designer or PM, not a developer: only steps they can do in the product's own screens and results they can see there, in plain words — criteria with no visible effect are left out (`qa-handoff.md` → *Who tests it*).
- per user-testable acceptance criterion — grouped where one walk-through covers several — the steps in user terms, the expected result, and **one** embedded artifact per group (video *or* still, never both for the same thing, 1–3 in total); a **Not working yet** line for anything that failed; the PR link at the bottom. Under ~150 words of prose, no tables, no method notes, no test counts.
- **Media is embedded inline, never attached.** Upload (Linear: `prepare_attachment_upload` → PUT) and put the returned **asset URL** straight into the comment markdown. **Never `create_attachment_from_upload`** — a downloadable resource in the attachments panel is not evidence. Never a GitHub raw URL. Video as inlineable `.mp4`, else fall back to a still — never a download link.
- Sources: the 7a captures in `.context/<issue-id>/evidence/media/`; if this run resumed and the local copies are gone, fetch them back from `<MEDIA-BRANCH>` (`git show origin/<MEDIA-BRANCH>:pr/<n>/<file>`) rather than capturing again.
- **Idempotent by edit:** find an existing `## QA handoff` comment and update it **by id**. Never a second comment, never a "v2 supersedes the above".
- Internal-only change with nothing capturable → a one-paragraph handoff saying there is nothing for QA to see and why.

**7c. Finalize the tracker** per `issue-lifecycle.md`: verify the PR's parent
reference and any corresponding generated issue links, mark all owned internal
descendants `<DONE>` if any, then move the human ticket to `<IN-REVIEW>`.
Read every effect back before recording COMPLETE. Pending/denied writes retain
Step 7 and emit `tracker-pending` in cloud mode; the next invocation resumes
those writes without repeating current reviews, captures or the handoff.

Then report and stop.

## Boundaries

- One ticket per run. Never batch; never pull adjacent work into the diff.
- **Never merge, approve, mark ready, or mark the issue done** — terminal state is a green, review-resolved **draft** PR, the ticket's one QA handoff, parent `<IN-REVIEW>` and any owned generated descendants `<DONE>`.
- **The ticket gets one comment, at the very end.** No comment before GOAL MET or beyond the handoff, no second comment ever, no tracker attachments. Claim/status fields follow `issue-lifecycle.md`. The PR body is the only place dev-adjacent material appears, and only as ≤5 `## Notes` bullets.
- **Evidence is captured once, after GOAL MET.** The Playwright loop in Step 3 verifies and keeps nothing; Step 7a is the only capture, and its files serve both the PR body and the handoff. Reuse captures only while their manifest `sourceHead` matches the live PR head. Later fixes require Step 7a again after fresh GOAL MET; replace the existing body and handoff content.
- **No human gates.** `<HITL>` becomes a recorded assumption; a non-lean ticket is worked with a disclosed concern; `<SKIP>` tickets are handed to `/work-slice` / `/feature-goal` **in this invocation**, never bounced to the user. The only stops are safety stops and babysit's `needs-human` escalations.
- Never create a worktree or branch; never rename the Conductor branch; no stack commands (nothing to stack).
- All constituent caps respected (5 review rounds, 3 Playwright, babysit's fix/thread caps and 5 rounds per bot) — caps exhausted → escalate on the PR, never grind. Bot reviews happen on GitHub only; never run a review CLI.
- The review loop runs **once** per ticket, including across re-invocations — persistence after it is babysit, not more review rounds.
- Label writes stay additive; never stamp `<AGENT-READY>` or `labels.sliceNext` on anything; follow-up tickets come only from `followups` and verified discoveries (never scope creep, never one per finding).
- **Persistence is re-invocation, never a stop-hook.** A run ends at GOAL MET or Blocked (`needs-human` only), always with the resume report; pending CI or bot rounds are waited on by babysit, never a reason to end.
- Use the shared model registry: implementer/fixer/adjudicator roles for those passes, reviewer/verifier roles for reports. Apply the resolved model and effort explicitly.

## Workflow Boundaries

**This skill takes one lean tracker issue straight to a green, bot-satisfied, thread-resolved draft PR — no planning stages, no stack, no human gates.**

- **DOES**: classify leanness (`<AGENT-READY>` or judged, disclosed when not lean), record HITL decisions as PR-body `## Notes` bullets, claim the ticket, run work-slice's implement + engine-CLI review loop + artifact-free Playwright verification verbatim, open the draft PR via `<PR-SKILL>` + `gh pr ready --undo` with `## Verification` (+ `## Notes`) in its body, run `/babysit-stack` to its terminal verdict, and — only on GOAL MET — capture the evidence once (7a: publish + `## Visual verification`) write the ticket's one concise `## QA handoff` from those same files, then finalize the parent/descendant statuses.
- **DOES NOT**: ask the human anything, capture / publish / post any visual evidence before GOAL MET or for a stale head, grill / write PRDs / slice (`/feature-goal`), work pipeline tickets (`<SKIP>` → hands off to `/work-slice` / `/feature-goal` in-invocation), create or rename worktrees/branches, run stack commands, comment on its own PR, post comments on the ticket before GOAL MET or beyond the one handoff (claim/status fields follow the shared lifecycle), attach files to the ticket, mark the issue done or the PR ready.

## Red Flags — STOP

- About to stop for a `<HITL>` label or ask the user a decision — stop stopping: decide, record it as a PR-body `## Notes` bullet, proceed.
- A hook or skill from **another plugin** blocks a step, forces its own review, or says a ruling is "the user's call" (a blocking question, "owner actions") — stop relaying it: the run is unattended. Satisfy the gate the way its message asks, decide each question as you would a `<HITL>` one, file verified out-of-diff defects per `## Discoveries` in `../work-slice/references/followups.md`, record each decision as a `## Notes` bullet, proceed. Never quote its jargon at the user.
- About to end a turn between steps with nothing blocking (after a fix, before the next review round, after opening the PR) — stop: carry on to the next step; only GOAL MET or Blocked ends a run.
- About to ask whether to file a follow-up or edit another ticket — stop: verified out-of-diff defects are filed per `## Discoveries` without asking, and other tickets are never edited.
- About to post a **comment** on the ticket before babysit says GOAL MET — stop: the ticket's one comment is the Step 7 handoff, and a handoff written earlier goes stale behind the bot rounds.
- About to capture a screenshot or video, publish media, or write `## Visual verification` before GOAL MET — stop: the Step 3 Playwright loop verifies and keeps nothing; capture is Step 7a's, once.
- About to capture a second time for the handoff (or recapture "for the ticket") — stop: 7b embeds the files 7a already produced; refetch from `<MEDIA-BRANCH>` if they are gone.
- About to post assumptions, acceptance criteria, a PASS/FAIL table, a method note, or any dev material on the ticket — stop: the ticket gets exactly one `## QA handoff`; human-actionable residue is a PR-body `## Notes` bullet, the rest stays in `.context/`.
- About to add a **second** suite comment to the ticket, or a "v2 supersedes the above" — stop: find the existing `## QA handoff` and update it by id.
- About to call `create_attachment_from_upload`, attach a file, or link a GitHub raw URL on the ticket — stop: evidence is embedded inline in the comment via the upload's asset URL.
- About to run `gh pr comment` on this PR — stop: the suite never comments on its own PRs; the body is its only voice.
- Ticket carries `<SKIP>` — don't run the lean loop and don't bounce the user: run `/work-slice <id>` (slice) or `/feature-goal <id>` (PRD or feature ticket) in this invocation.
- About to end because the ticket isn't lean — stop: proceed with a `## Notes` bullet in the PR body; the user chose this loop.
- About to end because CI or a bot review is pending, or to wait for it yourself — stop: `/babysit-stack` waits; a run ends only at GOAL MET or Blocked.
- A fresh run needs a clean virgin worktree. On resume, resolve the saved stage and owned edits first; a non-virgin branch alone does not block an existing run.
- About to create/rename a branch or run a stack command — stop: keep Conductor's checkout, base stays `<BASE>`.
- About to re-run the review loop after its verdict on a re-invocation — stop: converged or stalled, the result stands; leftovers ride the PR.
- About to run a review CLI — stop: bot reviews happen on GitHub, through babysit.
- About to mark the issue done or the PR ready on GOAL MET — stop: move the parent to `<IN-REVIEW>` after Step 7; keep the PR draft and mark only owned generated descendants `<DONE>`.

## Verification

Before reporting done:

- [ ] Claim verified at start: owner/assignee recorded, status `<IN-PROGRESS>`, `<AGENT-READY>` removed via an additive label write (full set minus only that label).
- [ ] Completion read back: parent `<IN-REVIEW>`, all owned generated descendants
  `<DONE>` (if any), PR body links the parent and its corresponding generated
  issue, no auto-closing parent reference, no pending tracker operation.
- [ ] No question was put to the human: HITL decisions and any leanness concern live as `## Notes` bullets in the PR **body** (not on the ticket, not as PR comments); a `<SKIP>` ticket was handed to the right skill in-invocation.
- [ ] Acceptance criteria exist in the run contract — the ticket's verbatim checkboxes, or user-facing ones distilled for the `## QA handoff`.
- [ ] Draft PR open against `<BASE>` with `isDraft: true`; **zero suite comments on it**; a cap-hit loop's unfixed findings appear as `## Notes` bullets in the body, ≤5 bullets total.
- [ ] PR body carries `## Verification` (+ `## Notes` when warranted) from the creation write and `## Visual verification` from Step 7a's single post-GOAL-MET write per `pr-evidence.md` — rows and captures from this run only, media on `<MEDIA-BRANCH>` by sha (or the one-line forms), the usual two body writes in that order; idempotent issue-link repairs are allowed.
- [ ] **Nothing visual existed before GOAL MET** and nothing was captured twice: the Step 3 Playwright loop kept no artifacts, `evidence/media/` was written only by 7a, and the handoff embeds those same files.
- [ ] The ticket carries **exactly one** suite-authored comment — `## QA handoff` per `qa-handoff.md`, written **after** GOAL MET and the capture, never before: user-terms steps, 1–3 **inline-embedded** artifacts, Not-working-yet line, PR link, under ~150 words, no dev material, no tracker attachments. Re-runs updated it by id rather than adding a second. Consolidation follow-ups filed as tickets with `<SKIP>`.
- [ ] The run ended at GOAL MET (handoff and final tracker statuses verified), tracker-pending, or Blocked (concrete reason named, no premature handoff), never on pending CI / bot rounds; the report says `/work-issue <ISSUE>` resumes; done claimed only on a babysit GOAL MET verdict.

When running under `/solve-ready-tickets`, read bootstrap's pinned config and
tracker mode in `.context/<ISSUE>/pipeline-state.md` before preflight. Apply the
queue and terminal marker protocol in
`../feature-goal/references/cloud-relay.md`: emit `complete` only after current
PR verification, issue links, published QA handoff and final tracker statuses, `tracker-pending` when its exact
payload awaits a caller invocation, or `blocked` with a concrete reason. No
caller is listening while this session runs: the marker and the queued files are
what a later invocation reads for crash recovery and denied tracker writes.
