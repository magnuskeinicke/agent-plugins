---
name: solve-ready-tickets
description: >
  The autonomous-loop solver. Scans the issue tracker for tickets that
  daily-ticket-manager stamped agent-ready (assigned to me, on the repo's team,
  queued to start), claims them, and drives each to a DRAFT
  pull request for my review — implementing inside a difficulty-triaged
  engine-CLI review loop. Drains up to N tickets per run (default N=3, oldest
  first); re-entrant — a re-run resumes in-flight tickets from durable markers
  before selecting new ones. Never merges, never marks an issue done, never
  runs compliance — the draft PR is the human review gate. Use when I say
  "solve my ready tickets", "run the autonomous solver", "pick up the
  agent-ready tickets", "work the agent-ready queue", or run
  `/solve-ready-tickets`. Built to run unattended on a schedule. Defaults to a
  read-only dry run; only claims/implements/opens PRs on `apply`.
argument-hint: "[dry-run|apply] [max N]"
---

# Solve Ready Tickets

The **autonomous-loop solver** — the counterpart to `daily-ticket-manager`.
That skill *triages* my queue and stamps `<AGENT-READY>` on the small, low-risk,
single-PR work an unattended agent can safely take. This skill is the loop that
*scans `<AGENT-READY>`, picks the work up, solves it, and opens a draft PR* for me
to review. The two are a producer/consumer pair joined by that label.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). The engine CLI
reads the same file itself; the placeholders below stand for its values.
A key this skill *needs* that is empty is a **hard stop**, not a guess — say
which key is missing and end the run.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<TEAM>` | `tracker.team` / `tracker.teamId` | the repo's only team |
| `<READY>` | `tracker.statuses.readyForDev` | **STOP** — there is no queue to scan |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | leave the status untouched |
| `<AGENT-READY>` | `labels.agentReady` | **STOP** — this skill *is* that label's consumer |
| `<HITL>` | `labels.needsHuman` | no hard exclusion to honour |
| `<SKIP>` | `labels.managerSkip` | no pipeline exclusion to honour |
| `<RISK:>` | `labels.riskPrefix` | no risk label to clear on decline |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<START-SKILL>` | `skills.startWork` | create the worktree with plain `git worktree add` off `<BASE>` |
| `<PR-SKILL>` | `skills.createPr` | `gh pr create --base <BASE> --draft`, title per `pr.titleRule` |
| `<E2E-DIR>` | `e2eDir` | the repo's e2e project, if any |

Also read the prose rules at `tracker.docPath` (workspace ids, how to fetch /
claim / link issues) and `labels.docPath` (`<AGENT-READY>` is **the
autonomous-loop trigger**, owned by `daily-ticket-manager`; the additive
label-write rule).

This skill **never** marks an issue done, merges, approves, or runs compliance.
Its terminal state is a **draft PR + a summary comment**. Every output gets human
eyes before it goes anywhere.

## Mode — dry-run is the default

Parse the argument for the run mode (mirrors `daily-ticket-manager`):

- **`dry-run`** (default, and the default whenever the mode is absent or
  ambiguous) — select the queue, report which tickets *would* be picked up and
  in what order. **Mutate nothing**: no label changes, no status changes, no
  branches, no PRs, no solve runs.
- **`apply`** — do everything: claim, branch, run the solve loop, open the
  draft PR, comment.

`max N` sets how many tickets one run drains (default **3**). Running unattended
(scheduled / non-interactive), never block on input: if a prerequisite is
missing or a ticket turns ambiguous, record it, leave the ticket flagged for a
human, and move to the next. Treat an unattended run as `dry-run` unless the
schedule prompt explicitly says `apply`.

## Resume — in-flight tickets first (apply only)

The run is **re-entrant: run it again to resume.** A crashed or interrupted
`apply` run leaves claimed tickets stranded mid-solve; before selecting new
work, sweep for them and finish them first, counting each toward `max N`.

An **in-flight ticket** is one that shows all of: status `<IN-PROGRESS>`
assigned to me, a branch carrying its issue id, **no** open PR referencing it,
and a worktree for that branch (in `git worktree list`) whose gitignored
`.context/<issue-id>/` contains this skill's state (`triage.json` or
`ledger.json`) — that state dir is the ownership marker. A ticket matching the
first three but **without** the state dir is someone else's WIP: leave it
alone, list it under Notes as flagged for a human.

Resume each in-flight ticket from its durable markers, never from memory:
`triage.json` missing → Step 4a; present → Step 4b, where the engine CLI's
`status` names the loop's pending step; loop `done` with a committed diff →
Playwright (4c) / Step 5. Never re-`init` a finished engine run.

In `dry-run`, just report the in-flight tickets that a re-run would resume.

## Step 1 — Select the queue

Scope is **my `<AGENT-READY>` tickets queued to start**: assignee `me`, team
`<TEAM>`, status `<READY>`, label `<AGENT-READY>`, limit 100. (Linear:
`list_issues` with those filters.) Match statuses by name and fall back to the
ids in `tracker.statuses` if names have drifted.

Then **drop**, in this order:

1. Any ticket carrying **`<SKIP>`** — PRD-pipeline-owned, never autonomous.
   (`daily-ticket-manager` should never have stamped `<AGENT-READY>` on one, but
   guard anyway.)
2. Any ticket carrying **`<HITL>`** — never both, but guard.
3. Any ticket **already claimed**: an existing branch carrying the issue id
   (run `git fetch --prune origin` first so remote branches are current, then
   `git branch --all --list '*<issue-id>*'`), or an open PR referencing the issue
   (`gh pr list --search "<ISSUE>" --state open`). The claim in Step 2 clears
   `<AGENT-READY>` precisely so a re-run never re-grabs the same ticket, but branch/PR
   presence is the belt-and-braces check for in-flight work. (Tickets this
   skill itself left in flight are handled by the Resume sweep above, not
   here — they no longer carry `<AGENT-READY>` and never reach this list.)

Sort the survivors **oldest-first** (by `createdAt`) and take the first **N**
(minus any resumed in-flight tickets already counted).

For each, fetch the full issue with `get_issue` (the list description may be
truncated) and extract **acceptance criteria** — the contract for the solve
loop. If a ticket has no explicit AC, derive a short bullet list from the
description.

**An empty queue is a normal outcome** — report "no `<AGENT-READY>` tickets to
pick up" and stop. Never widen scope to invent work.

## Step 2 — Claim each ticket (apply only)

Claiming is what stops a re-run or a parallel run from double-grabbing. For each
selected ticket, **before any code**:

1. **Clear the trigger.** Remove the **`<AGENT-READY>`** label so the ticket leaves
   the autonomous queue and is never picked up again. ⚠️ Linear's
   `save_issue.labels` *replaces* the whole set — read the issue's current labels
   and write them back **minus only `<AGENT-READY>`**. Never drop a type label, a
   `<RISK:>` label, or any product label. See the additive rule in
   `labels.docPath`.

   > **Preserving an existing label is not setting it.** Echoing back a
   > pre-existing `Compliance/*` (or any product) label in this replace-the-whole-set
   > write is *required* label preservation — it is **not** "running compliance",
   > stamping compliance status, or any of the forbidden terminal actions in the
   > Safety rules. The "never compliance" rule forbids *initiating*
   > compliance/`/compliance-check` and *adding* a compliance verdict the agent
   > didn't earn; it never forbids carrying forward labels the ticket already had.
   > Write the full existing set minus `<AGENT-READY>`, unchanged.
2. **Move status** to **`<IN-PROGRESS>`** so the ticket reads as actively
   worked. Skip the move if it's already there or later.

Clearing `<AGENT-READY>` **and** moving to `<IN-PROGRESS>` is the claim — do both.

## Step 3 — Branch in an isolated worktree (apply only)

The run is unattended, so it must never touch my active checkout. Create the
branch in **its own git worktree** using **`<START-SKILL>`**, based on `<BASE>`.
Branch name follows that skill's slug: `<ISSUE> <title>` → `<issue-id>-<slug>`.
The worktree gets its own generated dev env so the loop's tests can run in
isolation. One worktree per ticket.

## Step 4 — Solve (engine CLI, apply only)

Each ticket's triage → implement → review → fix runs through the plugin's
**engine CLI**, entirely **inside the ticket's worktree** — run every command
from the worktree root so the run state lands in *its* gitignored
`.context/<issue-id>/` (contract, triage, ledger, prompts, findings inbox),
and every file read/edit, test, commit, and diff happens there, never in the
main checkout. **Loop control is deterministic CLI output, never prose
discipline:** read the JSON each command prints and do exactly what its
`action` / `next` field says. The orchestrator does **not** write or review
code — the emitted tasks own that.

Resolve `<ENGINE>` once — it lives in the **plugin install root**, not the host repo:

```bash
engine="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/engine/cli.mjs}"
[ -n "$engine" ] && [ -f "$engine" ] || engine="$(realpath "<this-skill-dir>/../..")/engine/cli.mjs"  # symlinked install
[ -f "$engine" ] || engine="$(ls -d "$HOME"/.claude/plugins/cache/*/magnus/*/engine/cli.mjs 2>/dev/null | sort -V | tail -1)"
```

**Running an emitted task** (triage here, and every task the CLI emits in 4b):
mechanism is runtime-dependent — spawn a subagent from the named `agentFile`
when the runtime has them, run `codex exec` children in the background, or do
it yourself inline adopting the persona fresh per task (disclose the fallback
once). Sequential costs wall-clock only; it is **never a licence to drop a
reviewer**. Model roles: implement/fix tasks get the strongest model,
read-only reporters (triage, gut-check, reviewers, validator, Playwright
verifier) run leaner — aliases only, never exact ids.

### 4a — Triage the tier

One **read-only** triage task (leaner model): do a quick grounding scan of the
repo (grep/glob/read a few files near the change — implement nothing), then
classify the ticket, biased heavier when torn:

- **`trivial`** — copy/text/constant change, dependency bump, lint/format fix,
  a single-file mechanical edit, or a small isolated test — no real branching
  logic, one area at most.
- **`standard`** — a small bounded feature or bug fix with real logic, in one
  or a few areas. Still single-PR.
- **`escalate`** — on inspection BIGGER or riskier than an `<AGENT-READY>`
  ticket should be: multiple unrelated areas, ambiguous/underspecified
  acceptance criteria, a schema-changing DB migration, an
  auth/billing/security/sensitive-data surface, or anything needing
  product/architecture judgement. Choose this to kick the ticket back to a
  human rather than ship a bad PR.

Record `{tier, reason, whereToLook, touchedAreas, userFacing}` (userFacing
biases **true**) to `.context/<issue-id>/triage.json` — the durable marker a
resumed run reads instead of re-triaging.

**`escalate` → decline the ticket** (skip 4b–4d and Step 5). The solver does
**not** make the routing call itself — it bounces the ticket back to
`daily-ticket-manager` for a fresh classification, handing over what it
learned:

1. **Write an elaborate decline comment** — this is the *new info* the manager
   re-classifies on. Don't be terse: capture the triage reason (quoted), what
   the solver actually found when it dug in, and why that makes the original
   `<AGENT-READY>` wrong. Use this block:

   ```md
   ## Autonomous solve — declined

   The autonomous solver picked this up from the agent-ready queue but **declined to
   implement it** and is bouncing it back for re-triage.

   Why declined (tier: escalate):
   <the triage reason, quoted verbatim.>

   What the solver found:
   <2–4 lines of new info the original triage missed: the real scope/blast
   radius it touches, the ambiguity or judgement calls discovered, why it
   doesn't fit one safe PR.>

   For re-triage:
   - The agent-ready and risk labels are cleared, so daily-ticket-manager
     re-classifies both axes from scratch against the above.
   - Suggested direction: <e.g. likely high risk + needs-human because …> — the
     manager makes the final call.

   _Declined by solve-ready-tickets. Re-classify with daily-ticket-manager
   before re-queueing._
   ```

   Make it idempotent: if a comment already starts with
   `## Autonomous solve — declined`, update it rather than adding a second.
2. **Clear `<RISK:>*`** (additive write — read the issue's current labels, write
   them back **minus any `<RISK:>` label**; `<AGENT-READY>` is already gone
   from the Step 2 claim). Stripping the risk label drops the ticket back into
   the manager's gap-fill window so the next run re-classifies it. Preserve every
   other label (type, product, compliance, etc.) per the Step 2 rule.
3. **Do not add `<HITL>`** — routing is the manager's call now, made fresh
   against the decline comment. The solver clears the managed labels and steps
   out of the routing decision entirely.
4. **Move the ticket back to `<READY>`** so it re-enters the manager's triage
   scope.
5. **Remove the ticket's worktree and branch** (nothing shipped) so the
   Resume sweep never mistakes the remains for in-flight work.

Then move to the next ticket. This is the escape hatch for a mislabelled
ticket — instead of the solver guessing the routing, the manager re-triages with
the new info the solver surfaced.

### 4b — Implement + review loop

Work-slice Step 3 applies **verbatim** (run contract → implement pass →
`init → plan → collect → decide → apply-fix → adjudicate → report`, obeying
the CLI's JSON), with these lean mappings:

- **Contract** (`.context/<issue-id>/contract.md`): slice id = the issue id;
  **Kind = delta** with sibling features as the exemplars (no skeleton —
  mirror existing siblings; provenance rules stay binding); acceptance
  criteria = Step 1's, verbatim; where-to-look = triage's `whereToLook` plus
  the ticket's own pointers; the ticket DESCRIPTION verbatim as the wider
  contract; commit rule `<issue-id> …; never git push`.
- **TDD scaled by tier** — goes in the implement prompt: `standard` =
  test-first, one tracer-bullet test → impl per criterion; `trivial` = keep it
  minimal, add or adjust a test only where test infrastructure already exists
  for the touched code — never scaffold new test infrastructure.
- **Init** (from the worktree root):

  ```bash
  node "$engine" init --slice <issue-id> --base <BASE> \
    --tests-green <bool> --committed <bool> --max-rounds 2
  ```

  `--max-rounds 2` is the lean cap: at most **one** fix round
  (review → fix → re-review), lighter than work-slice's 5. `resumed: true` →
  run `status` and continue at the phase it names. `plan` gets
  `--declared-areas` from triage's `touchedAreas` and `--user-facing` from its
  `userFacing`.
- **Reviewer selection is the CLI's**, not the tier's: the engine's mechanical
  roster selection replaces the old trivial/standard reviewer scaling — a
  small mechanical diff triggers few lanes by itself. Never re-derive or trim
  the manifest.
- **Tests gate:** reviewers never see red code — a red gate makes the CLI
  emit one gate-fix pass mechanically. Still red after that pass → the ticket
  ships nothing: skip review entirely, note the red state on the ticket
  (comment), leave it `<IN-PROGRESS>` flagged for a human in the report, and
  move to the next ticket. Never open a PR on red tests; implementers prove
  green via `testEvidence` (commands + summary lines run in-session), never
  assert it.
- A **gut-check `hard-stop`** (out-of-scope work detected) is handled like a
  red gate: no PR, note it on the ticket, flag for a human, next ticket.

### 4c — Playwright check (standard + user-facing only)

`tier = standard` **and** `userFacing` → run work-slice's Step 3.5 Playwright
user-story loop with the lean cap: **one** verify round, at most **one** fix
pass, one re-verify. `devServerCommand` empty → skip entirely and say so.
Capture a screenshot per acceptance criterion — PASS and FAIL alike — plus the
run video; "couldn't verify" is a FAIL. Criteria still failing after the cap
ride into the draft PR and the QA table as FAIL — evidence of what broke.
Clean up before leaving: scrub the throwaway spec; only gitignored
screenshots/video stay. `trivial` tickets skip this entirely.

### 4d — Read out the result

`report` returns the verdict and the ledger (open / addressed / deferred /
disputed entries with `CR-NNN` ids). Also gather, for Step 5: the tier and
reason from `triage.json`; which reviewers ran (the round manifests) and any
that died; the fixed-findings count (addressed entries); residual
judgement-call notes and `[disputed:…]` entries (I adjudicate those on the
draft PR); the provenance table from the implement/fix results; the
`consolidations` arrays from `.context/<issue-id>/round-*/findings/*.json`;
Playwright per-AC verdicts + proof paths. A `stalled` verdict still ships —
the outstanding findings surface on the draft PR (Step 5.5).

## Step 5 — Draft PR + comment (apply only)

Only when the solve shipped a real change (not declined, tests green):

0. **Scrub worktree artifacts first.** The Playwright check can leave a
   throwaway e2e spec (under `<E2E-DIR>`) untracked in
   the worktree; an untracked source file makes the repo's pre-push lint
   hook lint it and fail the push. Before opening the PR, in the worktree, drop any
   untracked file that is NOT part of the implementer's committed change set:
   `git -C <worktree> status --porcelain` → for each `??` line, remove it (these
   are review scaffolding, never the shipped change — the implementer committed
   its work, so anything still untracked is throwaway). The `.context/`
   state dir is gitignored and stays. Then confirm the tree is clean. Do
   **not** touch tracked/committed files.
1. Open the PR with **`<PR-SKILL>`** (base `<BASE>`). It enforces the
   CI-required title regex and writes the **test plan onto the tracker issue** —
   let it. It opens a *ready* PR and does not mark it draft.
2. **Flip it to draft** immediately so it can't be merged without me:
   `gh pr ready <number> --undo`. The draft state IS the review gate.
3. **Upload QA evidence first (when the Playwright check ran).** Upload the
   proof files (per-AC screenshots + video) to the ticket with `<TRACKER>`'s
   attachment flow (Linear: `prepare_attachment_upload` → PUT the file to the
   returned URL → `create_attachment_from_upload`), so QA can verify each criterion from
   the ticket without pulling the branch. Failed criteria are uploaded too —
   evidence of what broke, not just what works.
4. **Comment on the ticket** with the solve summary — use this block:

   ```md
   ## Autonomous solve

   Tier: trivial | standard
   PR: <draft PR url> (draft — awaiting your review)

   Shipped:
   <1–2 lines: what was built.>

   Reviewers run: <from the round manifests; note any dead reviewer>
   Fixed in review: <n finding(s)>  ·  Tests: green  ·  Verdict: <verbatim>

   Convention provenance:
   | Added file | Mirrors / deviation |
   | --- | --- |
   | <path> | <mirroredFrom exemplar, or [deviation: reason]> |

   QA evidence:
   | AC | Result | Proof |
   | --- | --- | --- |
   | <criterion> | PASS/FAIL | <uploaded screenshot link> |

   Consolidation follow-ups (not fixed in this PR — candidates for their own tickets):
   - <consolidation title — targetLib — detail>

   Flagged for your review:
   - <residual judgement-call or [disputed:…] note, if any>

   _Solved by solve-ready-tickets. Not merged, not marked done — review the draft PR._
   ```

   Omit the QA evidence table when the Playwright check didn't run, the
   provenance table when no files were added, and the consolidation section
   when the reuse audit returned none. Consolidations are surfaced for me to
   decide — this skill does NOT file follow-up tickets (unlike `/work-slice`);
   it never creates tickets. Make it idempotent: if a comment already starts
   with `## Autonomous solve`, update it rather than adding a second.
5. **Stalled verdict?** Post the outstanding findings as a
   `## Outstanding review findings` PR comment (the verdict line verbatim,
   then the open/deferred/disputed `CR-NNN` entries) so they surface on the
   draft.

Leave the ticket in **`<IN-PROGRESS>`** (or `tracker.statuses.inReview` if the
team has one). **Never** mark it done, merge, mark the PR ready, or run
`/compliance-check` — those are my calls on the draft.

## Step 6 — Report

End every run with a compact summary, regardless of mode:

```md
# Autonomous solve — agent-ready queue
Mode: dry-run | apply   ·   In queue: <n>   ·   Resumed: <r>   ·   Picked up: <k of N>

| Ticket   | Title         | Tier      | Outcome                          |
| -------- | ------------- | --------- | -------------------------------- |
| <id-1>   | <short title> | standard  | draft PR #123                    |
| <id-2>   | <short title> | trivial   | draft PR #124                    |
| <id-3>   | <short title> | escalate  | declined → re-triage (manager)   |

## Draft PRs awaiting review
- <id-1> — <title> — <draft PR url>

## Declined — bounced back for re-triage
- <id-3> — <title> — <why the solver declined; agent-ready + risk labels cleared, back in the ready queue for daily-ticket-manager>

## Notes
- <claims made, worktrees created, tickets left in flight (a re-run resumes them), red-tests/hard-stop flags, anything skipped, prerequisites missing>
```

In `dry-run`, the table shows what *would* be picked up and in what order; no
Outcome column actions are taken.

## Safety rules

- Default to `dry-run`. Claim / branch / implement / open PRs only on `apply`.
- **Clear `<AGENT-READY>` on claim** (additive write — never clobber other labels)
  so a ticket is never picked up twice; pair it with the `<IN-PROGRESS>` move.
- **Terminal state is a DRAFT PR.** Never merge, mark the PR ready, approve, mark
  the issue done, or run compliance. "Run compliance" means *initiating*
  `/compliance-check` or *adding* a compliance verdict — it does **not** mean
  preserving a compliance label the ticket already carried; echoing an existing
  label back on the additive claim write is mandatory, not a compliance action
  (see Step 2). The draft is the human gate.
- Honor `<SKIP>` and `<HITL>` as hard exclusions even if `<AGENT-READY>`
  is somehow also present.
- **One worktree per ticket**, based on `<BASE>` — never work in the user's
  active checkout. Every solve command runs from the ticket's worktree.
- The orchestrator does no code work: implementation + review live entirely in
  the emitted tasks the engine CLI drives (Step 4); the PR mechanics live in
  `<PR-SKILL>`. Read summaries and CLI JSON, not full logs.
- **The CLI owns the loop.** Reviewer selection, suppression, classification
  thresholds, gate injection, and the stop conditions come from `<ENGINE>`'s
  JSON output — never re-derive them, never hand-edit
  `.context/<issue-id>/ledger.json` or a findings file, never skip a command.
- **Re-entrant, never duplicating:** a re-run resumes in-flight tickets from
  durable markers (the `.context/<issue-id>/` state dir is the ownership
  marker) before selecting new ones; a branch without that marker is a
  human's WIP — flag it, never touch it. Never re-`init` a finished engine
  run.
- A ticket that triages to `escalate` is **declined**, not routed: write the
  elaborate decline comment, clear `<RISK:>*` (`<AGENT-READY>` already cleared on
  claim), add **no** routing label, move it back to `<READY>`
  so `daily-ticket-manager` re-classifies it, and remove its worktree.
  Never stamp `<HITL>` yourself — routing is the manager's call once the
  solver hands back the new info.
- A ticket that fails to claim, stays red after the gate-fix pass, gut-check
  hard-stops, or errors mid-solve is flagged and skipped — never crash the
  whole run, never force a low-quality PR.
- Don't touch tickets that aren't mine, aren't `<AGENT-READY>` (or in-flight from
  a prior run of this skill), or aren't in `<READY>`/`<IN-PROGRESS>`
  accordingly. Don't create or close tickets.
- An empty queue is a valid result — report it and stop.

## Scheduling

Built to run unattended (e.g. nightly, after the morning `daily-ticket-manager`
run so the queue is fresh). The schedule prompt must be self-contained: name the
scope (`my agent-ready tickets, <TEAM>, <READY>`), the batch
size (`max N`), and the mutation policy (`apply` to actually solve, `dry-run` to
just report the queue). Default a scheduled run to `dry-run` unless I've
explicitly approved `apply`. A scheduled `apply` run still only ever: clears
`<AGENT-READY>` + claims, branches in a worktree, resumes or runs the solve
loop, opens a **draft** PR, and comments — never merging, never marking done,
never running compliance.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
