---
name: work-slice
description: Pick up the next-slice sub-issue from a PRD, implement it test-first inside a bounded review-fix loop, open a stacked draft PR, babysit that PR (CI, Copilot rounds, CodeRabbit rounds, thread resolution on GitHub) until it is in order, and only then capture the visual evidence into its body. No human gates. Use when the user says "work the next slice", "start the next ticket", "implement slice X", "pick up this slice", or wants to work through PRD slices created by /to-issues.
---

# Work Slice

Runtime and model selection: read [the shared runtime contract](references/runtime.md) before launching workers or sessions. Use the registry role for `work-slice`; supporting skills inherit the caller’s resolved role.

At entry, resolve bootstrap/checkpoint configuration under the shared runtime
contract **before** placeholders, tracker reads or stage detection. A pinned
config takes precedence over the checked-out branch for every setting and is
passed to all constituent skills; a missing named snapshot blocks the run.


Drive **one** slice from a PRD to a stacked **draft PR**. The slices were produced by `/to-issues` as sub-issues of the **PRD ticket** (the `PRD: …` sub-issue of the human's feature ticket — its description is the PRD), ordered into a stack. This skill picks the next one up, implements it test-first inside a bounded **targeted review ⇄ fix loop**, **opens a stacked draft PR automatically**, **babysits that PR** (Step 7 — `/babysit-stack`) until CI is green, the review bots are satisfied and every thread is resolved, and **only then captures the visual evidence** (Step 8) into the PR body. **There is no human gate anywhere in this skill**: no confirmation before the PR, no stop on a HITL label, no stop on a routing label — the only stops are safety stops (dirty worktree, no committed diff, gut-check hard-stop) and `needs-human` escalations babysit cannot resolve. Run it once per slice; the next run stacks on the last.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). The engine CLI
reads the same file itself (`--config`, defaulting to that path in the host
repo root); the placeholders below stand for its values wherever this skill
acts directly. Missing file or empty key → the generic defaults apply and you
say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) — the **feature ticket** (human-facing) | the tracker's own id form (`#123`) |
| `<PRD-ISSUE>` | derived — the `PRD:`-titled sub-issue of `<ISSUE>`; parent of every slice, its description is the PRD | — |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `$CONDUCTOR_DEFAULT_BRANCH` (the local Conductor repo's base branch), else `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | discover Dev in progress via the shared lifecycle |
| `<NEXT>` | `labels.sliceNext` | no pointer label — the user names the next slice |
| `<HITL>` | `labels.needsHuman` | read "needs a human decision" from the ticket body — informational, never a gate |
| `<SKIP>` | `labels.managerSkip` | skip the triage opt-out stamp |
| `<PR-SKILL>` | `skills.createPr` | write the PR title/body inline, following `pr.titleRule` |
| `<TITLE-RULE>` | `pr.titleRule` | `<type>: <subject>` |
| `<COMMIT-RULE>` | `commit.format` / `commit.pattern` — resolved by the engine (`node "$engine" commit-rule`) | the `pr.titleRule` / `pr.scopes` shape, else `<type>: <subject>` |
| `<STACK>` | `pr.stackTool` | plain branches; every PR targets `<BASE>` and nothing is linked |
| `<SRC>` | `sourceDirs` | the whole source tree |
| `<GATE>` | `gates.all` | discover the repo's lint/test/build commands and name which you used |
| `<FIDELITY>` | `design.fidelityCheck` | no design-fidelity step — the Playwright AC loop stands alone |
| `<AGENT:>` | `routing.labelPrefix` | no routing disclosure — any agent works any slice |
| `<BOT>` / `<COMMENT-BOT>` | `pr.botReviewer` / `pr.commentReviewer` | babysit skips that bot phase (`n/a`) |
| `<MEDIA-BRANCH>` | `pr.mediaBranch` | `pr-media` — created as an orphan branch on first publish |

Also read the prose docs the config points at: `tracker.docPath` (how to fetch
issues, read blocked-by relations, mark state) and `labels.docPath` (the `<NEXT>`
work pointer vs the autonomous-loop trigger).
Read [the shared issue lifecycle](references/issue-lifecycle.md) for resolving
the human parent, claims and PR issue links. `/feature-goal` owns final statuses
for the whole stack; a completed slice alone never hands the parent to review.

## Resume — the `## Workflow State` checkpoint

This skill is **re-entrant: run it again to resume.** The checkpoint lives at
`.context/<slice-id>/workflow-state.md` in the host repo (gitignored) and is a
single overwritten block — full OIDs, never abbreviations:

```markdown
## Workflow State
- Stage: IMPLEMENTED
- Slice: PROJ-1234
- Parent / PRD: <IDs and URLs>
- Claim owner: <initiating user / run or workspace>
- PR issue mapping: <PR → parent / PRD / slice IDs and URLs>
- Branch: summary-feature/02-proj-1234
- Base: summary-feature/01-proj-1230 @ <full base OID>
- Head: <full head OID>
- PR: (none yet | #123)
- Verdict: (pending | converged | stalled — shipped with N open findings (CR-…))
- Assumptions: (none | <one line each>)
- Babysit: (not started | GOAL MET | NOT MET — <reason>)
```

Stages, in order: `CLAIMED` (Step 1 done) → `BRANCH_READY` (Step 2 done) →
`IMPLEMENTED` (Step 3 implement pass committed) → `REVIEWED` (review loop
verdict recorded) → `VERIFIED` (Playwright loop done or skipped-with-reason) →
`EVIDENCE_POSTED` (Step 4 QA evidence + `followups` tickets) → `PR_OPENED`
(Step 5.2) → `STACK_LINKED` (Step 5.3–5.4) → `HANDED_OFF` (Step 6 pointer
advanced) → `BABYSAT` (Step 7 babysit GOAL MET) → `COMPLETE` (Step 8 evidence
captured, published and in the PR body). **Rewrite the block at every stage
boundary.** `/feature-goal` runs Steps 3–8 in full per slice — its next layer is
only ever cut on a `COMPLETE` predecessor.

On invocation, if the chosen slice's checkpoint exists: read `Stage`, verify
its facts against the durable markers — the branch exists, `git rev-parse
HEAD` matches or descends from `Head`, the review loop's own state via the
CLI's `status`, PR state via `gh pr view` — **reality wins over the file** —
then continue from the first incomplete stage instead of restarting. Mid-loop
resume belongs to the CLI: `status` prints the phase and the pending step.

## Step 1 — Select the slice

**Preflight (before you claim anything):** confirm you're in a clean, dedicated worktree per Step 2. If you're not in a git worktree, or it has uncommitted changes, **STOP and tell the user** — do not claim the slice and do not create a worktree yourself.

Input is a PRD ticket id (or the feature ticket's — descend to its `PRD:` sub-issue), a specific slice id, or nothing.

- **Specific slice id given** → use it.
- **PRD ticket id given (or inferable from context)** → list its sub-issues and pick the slice carrying **`<NEXT>`** — the single work pointer that `/to-issues` (skeleton) or a previous `/work-slice` run placed on the slice that is up. That is the one to work. **Fallback** if no slice carries `<NEXT>` (e.g. it was cleared by hand): take the earliest slice in stack order that is **ready** (every predecessor has an open or merged PR — PR state, not the tracker's blocked flag; see Step 6) and **not-done, not-in-progress** (a `<HITL>` label does not exclude it — see below).
- **Nothing** → ask for the PRD ticket id or slice id.

**A `<HITL>` label (or a "needs a human decision" line in the body) is not a gate.** Read the decision, pick the option most consistent with the PRD and the skeleton's published contract, and record it — one line under a `## Assumptions` comment on the slice ticket (idempotent: update, don't duplicate; slice tickets are the suite's own) and as one bullet in the PR body's `## Notes`. Then implement as if it were AFK. The human reads assumptions at PR review time; they never block a slice.

**Routing disclosure** (only when `<AGENT:>` is configured): if the chosen slice carries an `<AGENT:><name>` label naming an agent **other than the runtime you are running in** (Claude Code vs Codex — you know which you are), you still work it — the user or orchestrator invoking you here made that call — but say so once in the terminal and under the slice ticket's `## Assumptions`: `routing label <AGENT:><name> not honoured: worked by <this runtime>`. A matching label, or no `<AGENT:>` label, changes nothing.

Fetch the chosen slice AND the PRD ticket (the PRD is the PRD ticket's **description**; its `## Implementation deltas` comments amend it). Read, verbatim: the slice's **Kind** (skeleton vs delta), **Novel decision**, acceptance criteria, "Where to look" code-layer pointers, the **"Convention contract"** section (binding exemplars + must-use libs), "Design" Figma nodes/tokens, and "Stacked on" predecessor. For a **delta**, also read the ticket's **"Skeleton map" comment** (posted by the skeleton's `/work-slice` run — the actual files the skeleton created; the primary mirror). Read the PRD for the wider contract. The feature ticket (the PRD ticket's parent) is the human's — read it for framing and design links; only claim/status fields follow `issue-lifecycle.md`.

**Claim the slice.** Remove its `<NEXT>` label and set its status to **`<IN-PROGRESS>`** so it reads as actively worked and no parallel run grabs it. The pointer only moves on to the next slice after the draft PR is opened (Step 6). When removing/adding `<NEXT>`, write back the issue's full existing label set minus/plus only that label — never drop a type label, `<SKIP>`, or any product label (Linear's `save_issue.labels` replaces the whole set; see `labels.docPath`). Checkpoint: `CLAIMED`.

First reconcile the human parent and PRD claims per `issue-lifecycle.md`, even
when this slice is invoked outside `/feature-goal`. Record their IDs/URLs and
this slice's mapping in the checkpoint; reconcile from live state on resume.

## Step 2 — Confirm the worktree & resolve the branch base

**This skill does NOT create a worktree or branch.** It trusts that one is already set up — e.g. the Conductor session's worktree — so the work lands in the same checkout you're watching. (Conductor's `setup` script runs `init-worktree.sh`, so a Conductor workspace is already bootstrapped: env config, Docker stack, migrations, seed.)

**Confirm the working tree** (this is the Step 1 preflight — do it before the claim):

- It is inside a git worktree — `git rev-parse --is-inside-work-tree` returns `true`.
- It is clean — `git status --porcelain` is empty (no uncommitted changes).
- If either fails — **not in a worktree, or there are pending changes** — **STOP and tell the user.** Ask them to open the slice's dedicated worktree (let Conductor create + bootstrap it), or to commit/stash pending work first. **Never create a worktree or switch branches yourself.**

**Confirm the stacking tool.** Stacking is driven by **`<STACK>`**. With no `pr.stackTool` configured, skip every stack-linking step below: each slice's PR simply targets `<BASE>`. Load the **`<STACK>`** skill before any stack command; every invocation must be non-interactive (`--json`, `--auto`, explicit branch args) or it hangs. For `gh-stack`, two one-time git settings keep it prompt-free:

```bash
gh extension list | grep -q gh-stack || gh extension install github/gh-stack
git config rerere.enabled true
git config remote.pushDefault origin
```

`gh stack` keeps **no local tracking state until PRs exist** in this flow — the branch is plain git here, and Step 5 links it into the stack after `<PR-SKILL>` opens the PR. That is deliberate: it makes the flow safe across Conductor's one-worktree-per-slice layout, where the predecessor's branch is checked out in a *different* worktree and cannot be checked out here. (`/feature-goal` runs the whole stack in **one** worktree — its pipeline workspace, one session per PR — and there it substitutes this step: it cuts the branch with `gh stack init` / `gh stack add` on top of the predecessor and hands in at Step 3, so local tracking exists and Step 5 pushes with `gh stack push`. See `feature-goal/references/pr-session.md`.)

**Keep the branch Conductor checked out.** Record its actual name with the slice id and stack position in the checkpoint; never rename it unless the user explicitly requests a rename. The PR number/head branch and checkpoint are the identity, not a naming convention.

Resolve the base: skeleton → `<BASE>`; downstream → the predecessor’s actual PR head branch, found from its ticket/PR/checkpoint. If the predecessor merged, use `<BASE>`. Record the zero-padded stack-order index for display only. Do not infer a predecessor by a synthetic branch-name suffix.

### Base the branch on its predecessor

Conductor branches the worktree off `<BASE>`, not off the predecessor — so a downstream slice must be **moved onto** its predecessor before any code is written, or the diff and the PR both show the predecessor's commits as this slice's.

- **Skeleton slice** → nothing to do; it is already based on `<BASE>`.
- **Downstream slice** → the current branch must still be **empty** (zero commits ahead of `<BASE>`), so re-point it at the predecessor rather than rebasing history:

  ```bash
  git fetch origin <predecessor-stack-branch>
  git rev-list --count <BASE>..HEAD               # MUST print 0 — otherwise STOP
  git reset --hard "origin/<predecessor-stack-branch>"
  ```

  The count check is the guard: if the branch already carries commits you are not in a virgin slice worktree — **STOP and tell the user** rather than discarding work.
- **Predecessor already merged** → stay on `<BASE>` and note it; this slice starts a fresh stack.

Verify with `git log --oneline -1` that HEAD is the predecessor's tip. From here every commit in Step 3 is a plain `git commit` on this branch, and Step 5 links the branch's PR into the GitHub stack. Checkpoint: `BRANCH_READY`.

## Step 3 — Implement + targeted review loop (engine CLI)

**Precondition:** Step 2 must have recorded the actual branch and, for a downstream slice, based it on the predecessor (`git log --oneline -1` shows the predecessor's tip). Every agent in this step commits with plain `git commit` on the current branch — if the base is wrong, every review round reviews the wrong diff.

The loop machinery is the plugin's **engine CLI** — a dependency-free Node CLI. **Loop control is deterministic CLI output, never prose discipline:** run each command from the host repo root, read the JSON it prints, and do exactly what its `action` / `next` field says. Never re-derive reviewer selection, finding suppression, classification thresholds, or stop conditions yourself — the CLI owns them, and its run state lives in the host repo's gitignored `.context/<slice-id>/` (ledger, emitted prompts, findings inbox). Which reviewers exist and when they trigger: `references/reviewer-roster.md` (documentation; `engine/lib/roster.mjs` is the source of truth).

Resolve `<ENGINE>` once — it lives in the **plugin install root**, not the host repo:

Resolve `engine` from the loaded skill’s real path using the shared runtime contract. Do not search another runtime’s cache or pick a version by sorting paths.

### 3.0 Write the run contract

`mkdir -p .context/<slice-id>` and write `.context/<slice-id>/contract.md` — the contract text every prompt in the loop (reviewers, validator, fixer, adjudicator) receives. Include, verbatim where the ticket has it: the slice id + title, its **Kind** with the matching guidance below, the acceptance criteria, the one **novel decision**, "Where to look" (for a delta, prepend the Skeleton map comment's file list — the primary mirror), the **Convention contract** (binding exemplars + must-use libs), the Figma node deep-links, the PRD's wider contract, and the push ban (never `git push` — this skill pushes once, in Step 5). The commit-subject rule is not hand-written here: the engine renders `<COMMIT-RULE>` into every fix and gate-fix prompt itself.

- **Skeleton:** this is the stack's WALKING SKELETON — the full end-to-end path with the REAL contract (schema, types, API shape, UI shell, one happy-path behaviour, tests wired) and stubbed/minimal behaviour elsewhere. Every cross-layer decision lands here; downstream deltas mirror this code, so its shape IS the feature's convention. Clone the exemplar's shape; don't invent structure an exemplar settles.
- **Delta:** a BEHAVIOUR DELTA on the walking skeleton — the skeleton (this feature's earlier slices, already on the base branch) is the primary pattern to mirror; sibling features are the fallback. Prefer APPENDING over modifying, introduce at most the ticket's one named novel decision, and **never alter the skeleton's published contract** (contract freeze — a needed contract change stops the slice and escalates).

### 3.1 Implement pass

**Capture nothing here.** Visual evidence is produced once, by Step 8, after babysit reports GOAL MET (`references/pr-evidence.md`) — no before shots, no pre-capture, no media of any kind before the PR is done.

One implementer, the **configured implementer model**, obtained through the writer-spawn ladder in 3.3 — a freshly spawned agent whenever the runtime has any spawn mechanism, the shared CLI adapter when native workers are unavailable. TDD discipline: one tracer-bullet test → impl per acceptance criterion (vertical slice — never all-tests-then-all-impl), using "Where to look" as the starting map. Binding rules: mirror the convention contract's exemplars (a deviation is allowed only when declared in the provenance table with a concrete reason — silent deviation is a review-blocking offence); no new helper/util/hook/component without first searching `<SRC>` (and the design system, and `repoConfig.libMap`) for an existing equivalent; consolidation is in-scope only within this slice's own new code plus at most ONE existing call site — anything wider is a noted candidate, not a refactor; stay strictly inside this slice's scope and note anything a later slice owns instead of pulling it forward. For UI: fetch the Figma screenshot fresh via the Figma MCP from the slice's node deep-link and reuse design-system tokens/components, not magic numbers. Run tests + lint/typecheck with `<GATE>` and see them pass **in-session** before claiming green. Commit following `<COMMIT-RULE>` — paste the `text` of `node "$engine" commit-rule --issue <slice-id> --type <type> --scope <scope>` (the PR's type/scope) into the implementer's brief verbatim, example included; separately: never push.

Record the result as JSON at `.context/<slice-id>/implement-result.json`:

```json
{"summary": "", "committed": true, "head": "<git rev-parse HEAD>", "testsGreen": true,
 "testEvidence": "<commands + final summary lines>",
 "changedFiles": [], "addedFiles": [], "deletedFiles": [],
 "provenance": [{"file": "", "mirroredFrom": "", "deviation": ""}],
 "touchedAreas": [], "userFacingImpact": true, "diffStat": "", "notes": []}
```

If sandbox git writes were denied, first follow the shared runtime contract's parent-owned commit procedure using the returned `editedFiles` (subject from `commit-rule --subject`, checked with `commit-check`); recompute `head` and gate evidence before checking for a committed diff.

`changedFiles`/`addedFiles`/`deletedFiles` from `git diff --name-only [--diff-filter=A|D] <base>...HEAD`; one provenance row per added file (`mirroredFrom` = the exemplar actually followed, or `deviation` = why none fits — never both blank); `userFacingImpact` biases **true**; `testsGreen=true` only after running the gates in-session — and every gate command run lands as a row in `.context/<slice-id>/evidence/verification.jsonl` (`references/pr-evidence.md`), the implementer's `testEvidence` included; gate-fix and fix passes append their runs the same way. No committed diff → stop and tell the user (nothing to review or PR). Checkpoint: `IMPLEMENTED`.

### 3.2 Start the loop

Extract the provenance array to `.context/<slice-id>/provenance.json`, then:

```bash
# gate values from implement-result.json; --commit-type/--commit-scope = the PR's type/scope
node "$engine" init --slice <slice-id> --base <base> \
  --tests-green <bool> --committed <bool> --commit-type <type> --commit-scope <scope>
```

`resumed: true` means a prior run's state exists — run `status` and continue at the phase it names instead of restarting.

`init` checks every commit subject in `<base>..HEAD` against `<COMMIT-RULE>` (`commitCheck` in its output). `rejected` turns round 1 into a gate-fix that rewrites the implement pass's commit messages — obey it like any other gate-fix. A parent-owned commit (sandbox-denied writer) is yours to reword before `init`.

### 3.3 Obey the CLI

The cycle (`status` re-prints the pending step any time):

```bash
node "$engine" plan --slice <id> --changed-files <csv> --added-files <csv> --deleted-files <csv> \
  --insertions <n> --user-facing <bool> --declared-areas <csv> \
  --provenance-file .context/<id>/provenance.json --head <head>
# → gate-fix (red gate: run ONE fix implementer with the emitted prompt, then apply-fix), or
# → the round's task manifest: prePass (round 1), reviewers[]
node "$engine" collect --slice <id>
# → validator task when findings survived suppression; run it, then
node "$engine" decide --slice <id> --verdicts <verdicts.json>
# action=fix        → run ONE fresh fix implementer with fix.promptFile → apply-fix --result <fix-result.json>
#                     (apply-fix refuses a fix range whose subjects break <COMMIT-RULE>: run the fix pass
#                      again with a fresh fixer — or reword a parent-owned commit — then re-run apply-fix)
#                     → plan again with the fix range's files (git diff --name-only <prevHead>..<newHead>, etc.)
# action=adjudicate → adjudicate → run ONE fresh agent with the emitted prompt (never the fix implementer)
#                     → apply-adjudication --rulings <rulings.json>
# action=incomplete → preserve the pending round; retry missing tasks once, then report a blocker.
# action=converged|stalled|hard-stop → report the terminal loop result:
node "$engine" report --slice <id>
node "$engine" followups --slice <id>   # the only follow-up ticket candidates (Step 4)
```

**Running an emitted task.** Use the shared runtime contract: every task has
resolved profiles for Claude and Codex, a schema and a persisted `taskFile`.
Claude native subagents remain supported; Codex native subagents may be used
when they expose the required controls. Otherwise run
`node "$engine" run --task <taskFile> --runtime <claude|codex>`.
Each worker returns JSON; the parent validates and saves it. Writers and the
adjudicator get a fresh worker per pass, never a resumed prior worker. If a
writer cannot commit, the parent verifies and commits only its `editedFiles`
as described in the runtime contract. No inline persona fallback: report
unavailable worker capability explicitly.

Ground rules, regardless of mechanism:

- **Gut-check runs first** (round 1). If its JSON contains any `"disposition": "block"` observation, skip the reviewers and run `collect` immediately — it hard-stops for the human before any reviewer spend. Otherwise run the reviewers.
- **Every emitted reviewer must report.** Retry missing/invalid results once, then report `incomplete` and preserve the round for resume. Never advance to PR creation with incomplete coverage.
- **Reviewers are read-only** — only the implement/fix agents edit code. Every writer pass is a **freshly spawned agent**: the implement pass, each gate-fix, each round's fix, the adjudicator (never the fix implementer's context), and each Playwright fix.
- Use the shared model registry: implementer/fixer/adjudicator roles for those passes, reviewer/verifier roles for reports. Apply the resolved model and effort explicitly.
- `--head` = the implement pass's commit on the **first** `plan` only; `apply-fix` records each fix head itself, so later `plan` calls omit it. After each `apply-fix`, update the checkpoint's `Head`, and recompute the next `plan`'s file flags from the **fix range** (`<prevHead>..<newHead>`) with the whole-slice provenance from the fix result.
- Never hand-edit `.context/<slice-id>/ledger.json` or a findings file — findings enter through reviewer output files, decisions exit through the CLI.

The stop conditions live in the CLI (convergence, two-round stall, per-fingerprint deferral, hard cap 5 rounds — a safety boundary, not a target). A non-converged stop reports `stalled — shipped with N open findings (CR-…)`, never a silently exhausted cap.

### 3.4 Read out the result

`incomplete` preserves the round and stops advancement until missing workers recover. `report` returns the verdict, the ledger report (open / addressed / deferred / disputed entries with `CR-NNN` ids, dispute evidence, adjudication rulings), and the advisory notes. Also run `node "$engine" followups --slice <slice-id>` (the only follow-up ticket candidates — `references/followups.md`) and gather the notes from the implement/fix results. Checkpoint `REVIEWED` only for a completed review verdict. On `incomplete`, keep the prior stage and pending task manifests; never mark it reviewed. A `hard-stop` (gut-check block) goes straight to the user — no PR.

### 3.5 Playwright user-story loop (skill-owned, max 3 rounds) — verification only, no evidence

**This loop proves the acceptance criteria; it does not produce evidence.** Headless, artifact-free: no screenshots kept, no video recorded, nothing uploaded, nothing published, nothing posted. Any shot a verifier takes to judge a criterion is scratch — it lives in the gitignored test-output dir and dies with the throwaway spec. All visual evidence comes from Step 8, after GOAL MET (`references/pr-evidence.md`), so a bot round can never strand a stale capture and no proof is ever shown twice.

Runs **only after the review loop converged AND the slice is user-facing** — the implementer's `userFacingImpact` flag biases true; skip only pure refactors / internal utils / no-behaviour-change migrations, and say so. A backend-only diff can still change user-facing behaviour — when in doubt, run it. **How the app is started is fixed by `references/run-app.md`**: the Conductor run script for this environment (`.conductor/settings.toml`, `CONDUCTOR_IS_LOCAL`), else `devServerCommand`. **With neither, skip entirely and say so**. Never invent a start command, and never let the e2e Playwright config start the app. This loop is yours, not the CLI's: track its rounds yourself (max 3). Verify with a lean model (subagent when available — browser transcripts are token-heavy), fix with the strongest.

Each verify round — read `browserGuidePath` first (login steps, seeded users, routes, selectors, fake-media flags):

1. **One dev server per slice run, ever.** First detect a server that already serves the app (a prior round's, or one the user/worktree bootstrap left running — probe the URL the resolved run command implies, per `references/run-app.md` §3) and **reuse it**. Only when nothing serves: start the app **once** in the background with the resolved run command, wait until it serves, and reuse that instance across every later round. **Never start a second server** — not on another port, not "fresh for this round"; a second instance means port fights, stale-build confusion, and orphan processes. If the port is bound but not serving this app, stop and tell the user instead of stacking another server beside it.
2. **Nothing leaves this loop.** Authenticate *outside* the exercised flow, use the seeded demo users, and keep any scratch shot in the gitignored test-output dir — it is never uploaded, published, or referenced anywhere. (Step 8, which does publish, carries the secret preflight.)
3. Restore the parked spec (`<e2eDir>/test-output/slice-verify.spec.ts.parked`, gitignored) when it exists; otherwise author a throwaway Playwright spec (copy the `e2eDir` login-spec dev-login pattern, but run it under its own minimal config with no `webServer` and no e2e env files, per `references/run-app.md` §2) driving isolated headless Chromium, `video: 'off'`, `baseURL` = the running app, plus any fake-media flags the browser guide names, never test-rendering flags such as showing i18n keys. Run the `run-app.md` §4 check after login.
4. Dev-login as the seeded user matching the slice, then exercise **this slice's acceptance-criterion user stories** and judge each one PASS or FAIL. A scratch screenshot is allowed where the verifier needs one to judge; it is not evidence and is deleted with the spec.
5. **Design-fidelity check** (only when `<FIDELITY>` is configured AND the slice has design deep-links): invoke the repo's `<FIDELITY>` skill/command with the slice's routes, ACs, and design links (I/O contract in the plugin's CONTRACT.md). Its `blocking` deviations are failed acceptance criteria — same treatment, same rounds; `advisory` deviations are recorded for the Step 4 QA evidence and listed under the PR body's `## Visual verification` scenes when Step 8 writes it, unfixed. No `<FIDELITY>` key → this point doesn't exist; never improvise a design comparison.
6. **Clean up before returning:** delete only files recorded before creation in the run's `scratch-files.json`. On a passing or final round, delete the owned throwaway spec (and its owned parked copy); on a failing non-final round, park it in the gitignored test-output dir. Only gitignored scratch shots (and a parked spec) stay.
7. Record PASS/FAIL per criterion (blocking fidelity deviations count as FAIL). "Couldn't verify" is a FAIL, not a pass. **A broken user story = a failed acceptance criterion = a blocking finding**: hand the failures to one **freshly spawned** fix agent (writer-spawn ladder, 3.3 — never the round before's), commit, re-verify with a fresh round. Round 3 still failing → stop and escalate; the failures ride into the PR as outstanding.

Checkpoint: `VERIFIED`. Before Step 4, run the slice's tests + lint/typecheck green with `<GATE>` one final time and append those runs to `evidence/verification.jsonl` — they are the rows the PR's `## Verification` table is rendered from.

## Step 4 — Present the result, then proceed

**No confirmation gate — the draft PR is the review surface, so proceed straight to Step 5.** First print, from the loop's outputs (so the terminal has the record):

- The slice id + one-line summary of what was built.
- The diff stat (and how to see the full diff).
- Acceptance criteria, each ticked or flagged (the Playwright loop's PASS/FAIL judgement — it keeps no screenshots).
- The loop outcome: the **verdict verbatim**, which reviewers ran, how many review rounds it took, whether the Playwright loop ran and converged (or how many of its 3 rounds it used) — plus the ledger report: open / deferred / disputed entries with their `CR-NNN` ids.
- Any judgement-call findings — advisory notes the relevance gate demoted, and disputed entries with their adjudication rulings (an upheld dispute is back open; a deadlock is yours to adjudicate on the PR).
- The **provenance table** (added file → mirrored exemplar or declared deviation) — the convention audit trail.
- The `followups` selection (`file` / `batch` / `demoted`), and any **ratchet candidates**: a convention finding that showed up in 2+ rounds (or that you recognise from earlier slices) is a candidate for a lint rule / Nx module-boundary tag — name it so the human can move it from review into the tests gate.
- The branch + its base (the stack position).

**QA evidence → the slice ticket (when the Playwright loop ran) — text only, no images.** Slice tickets are internal, the user and AI only (`references/qa-handoff.md`), and visual proof exists in exactly two places: the PR body's `## Visual verification` and the human ticket's one `## QA handoff` — both written after GOAL MET, both from the same Step 8 captures. So this comment carries **no screenshots, no video, no uploads, no attachments**: post/update a comment starting with `## QA evidence` — one row per acceptance criterion, PASS/FAIL + one clause on what was observed. When the `<FIDELITY>` check ran, append a `### Design fidelity` subsection — one row per deviation (severity, screen, description; blocking ones also appear as FAILed criteria above). Failed criteria stay marked FAIL so the next agent sees exactly what broke. Idempotent: update an existing `## QA evidence` comment rather than adding a second.

**Follow-up tickets → the tracker (only what `followups` returned, plus verified discoveries):** file per `references/followups.md`. Dedupe by marker against open tickets. `file` (at most one) becomes its own ticket, `batch` is appended to the feature's single rolling `Follow-ups:` ticket, and `demoted` is never filed. Verified defects outside the diff go into at most one bug ticket and one test-gap ticket (its `## Discoveries` section); never ask the user whether to file them. Nothing else from the run becomes a ticket: advisory findings, notes, deferred entries, ideas. Generalisation happens in its own reviewed change, never by scope-creeping this slice, and only where the duplication already exists. List what was filed in the terminal summary and as `## Notes` bullets in the PR body (Step 5). Checkpoint: `EVIDENCE_POSTED`.

Then open the draft PR (Step 5) **without asking**. Open it even when the loop stalled — carry the unresolved blocking findings + judgement-call notes into the PR body / a review comment so they surface on the draft. Do not reach Step 5 with incomplete coverage or a failed verification gate. Other stops: no committed diff (nothing to PR), or a gut-check `hard-stop` — report the blocker.

## Step 5 — Open the stacked draft PR (automatically)

Stacking is **owned by `<STACK>`**, but it does **not** open the PR — `<PR-SKILL>` does. The split:

- **`<PR-SKILL>`** (repo skill — preserve its title/template rules, subject to `issue-lifecycle.md`) opens the PR and owns everything it is good at: the `<TITLE-RULE>` title regex, the conflict check, the Summary body, and the test plan (on the internal slice ticket only, never the human parent). It opens against `<BASE>`.
- **`gh stack link`** then adopts that already-open PR into the stack: it retargets the base to the predecessor's branch and records the chain server-side.

No `pr.stackTool` and no `skills.createPr`? Then open the PR with `gh pr create --base <BASE> --draft`, title per `<TITLE-RULE>`, and skip the linking entirely.

The mechanism that makes this work: `gh stack link` **only creates a PR for a branch that has none** — a branch whose PR is already open is linked, not duplicated. So `<PR-SKILL>` opens the PR first and `link` reconciles it. Two rules make it safe: **always link by PR number** (never by branch name — a branch name races the "no PR yet → create one" path if the PR lookup lags), and **never pass `--open`** (it would mark the drafts ready for review).

**0. Remove only owned scratch artifacts.** Read `scratch-files.json`; delete only paths this run recorded before creating them. Preserve unknown untracked files and report them. Never infer ownership from `??`.

**1. Preserve remote branches.** There is no stale renamed Conductor branch to remove. Do not delete remote branches or close PRs as automatic cleanup; existing PR identity comes from the current branch and recorded PR number.

**2. Check the commit subjects, push the branch, run `<PR-SKILL>` with the issue mapping, then make it a draft.** Before anything is pushed, `node "$engine" commit-check --slice <slice-id> --base <base>` must print `ok: true` — every `git log <base>..HEAD --format=%s` subject matches `<COMMIT-RULE>`. A host that squash-merges a single-commit PR under its commit subject rejects a wrong one at merge time, and rewording after review can dismiss approvals. On `ok: false`, reword the listed commits (`git commit --amend -m` for HEAD, else `git reset --soft <base>` and one conforming commit) and re-run the check; never push past it. Then push so the branch has a remote head: `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`. Then `<PR-SKILL>` runs the conflict check, enforces the title, writes the test plan onto the internal slice ticket, and opens the PR against `<BASE>`. Let it do all of that — for a downstream slice the base (`<BASE>`) and the whole-stack Summary it computes are both "wrong" right now; step 3 fixes the base. (The Summary bullets stay `<PR-SKILL>`'s. The base retarget makes GitHub show the correct per-slice diff regardless — a downstream body that still reads whole-stack is a known cosmetic, not a correctness, issue.)

`<PR-SKILL>` opens a **ready** PR; this skill ships **drafts** (review happens on the draft PR, not before it). It can't be opened as a draft without editing that skill, so convert it immediately after — capture the number and undo-ready:

```bash
pr=$(gh pr view --json number --jq .number)
gh pr ready "$pr" --undo   # ready -> draft
```

**2b. Write `## Verification` and `## Issues` into the body** — per
`references/pr-evidence.md` and `references/issue-lifecycle.md`. Render
verification from `evidence/verification.jsonl`; pass it and the parent/PRD/this
slice's IDs and URLs to `<PR-SKILL>`. Read back both sections, repairing missing
or incorrect content in one `gh pr edit <n> --body-file` write (plus `## Notes`,
5.4) before any bot is requested. Remove generated auto-closing issue references;
preserve unrelated body content. Never a row for a command not run. **No
`## Visual verification` yet and no media published** — capture is Step 8's,
after GOAL MET. Issue-link repair on resume is allowed when a prior write missed
the mapping; the usual two body writes are not a reason to leave broken links.

Checkpoint: `PR_OPENED`, with the PR number.

**3. Link the PR into the stack.** Load the `<STACK>` skill first. Which form to use depends on what already exists — resolve it from `gh stack view --json` (run it while checked out on the branch; a `not part of a stack` error just means "no stack yet"), or list the predecessor's PR number with `gh pr list --state open --search "<predecessor issue id>" --json number,headRefName`:

- **Skeleton slice** → **nothing to link yet.** A stack needs ≥2 PRs; the skeleton's PR simply stays based on `<BASE>`. It becomes the bottom of the stack when the next slice links onto it.
- **Second and later slices** → re-list the **whole stack, bottom → top, by PR number**:
  ```bash
  gh stack link --base <BASE> <pr-slice-01> <pr-slice-02> … <this-pr>
  ```
  Re-listing is correct and idempotent: "if some of the PRs are already in a stack, the existing stack is updated to include the new PRs (existing PRs are never removed)". There is a stack-number shortcut (`gh stack link <stack-number> <this-pr>`) but **no CLI command lists stack numbers**, so re-listing the PRs is the form that always works from a cold session. Get the list with `gh pr list --state open --search "<project-slug>" --json number,headRefName` and order it by the `NN` in each head branch.
- **Predecessor already merged** → don't link; the base correctly stays `<BASE>` and this slice starts a fresh stack.

Then verify: `gh pr view <n> --json baseRefName,isDraft` must show the **predecessor's branch** and `true`. If `isDraft` came back `false`, `--open` leaked in — re-run `gh pr ready <n> --undo`.

**4. No PR comment.** The suite does not comment on its own PRs (`references/pr-evidence.md`) — the body is its only voice there, and the 5.2b write carries the human-relevant residue as `## Notes`: at most five one-line bullets covering the assumptions Step 1 recorded, any finding the loop shipped unfixed, and the consolidation tickets filed in Step 4 (id + one clause). Nothing else. The **convention provenance table**, the **review ledger** (`CR-NNN` entries, dispute evidence, adjudication rulings) and the routing disclosure are developer machinery: they stay in `.context/<slice-id>/` and the terminal summary, where the human can ask for them. Never a `gh pr comment`. The later evidence write is Step 8's visual-verification insert; preserve `## Issues` and repair its mapping on resume when needed. Checkpoint: `STACK_LINKED`.

That is the whole stack bookkeeping — no hand-maintained `### Stack` block. GitHub holds the parent/child chain and renders the navigation into each PR; later slices' `link` calls extend it.

**After the predecessor merges**, restack the remainder onto the new base. With local tracking present (`gh stack view --json` succeeds), `gh stack sync --remote origin` fetches, rebases and pushes the whole stack; add `--prune` only when no sibling branch is checked out in another Conductor worktree. Without local tracking, rebase the branch by hand — `git fetch origin && git rebase --onto origin/<BASE> <old-predecessor-tip> <branch>` — then `git push --force-with-lease`. Either way this handles the squash-merge case, where the predecessor's commits reappear as duplicates. **Ask the user before force-pushing branches other slices are still working on.**

## Step 6 — Advance the pointer & hand off

The PR is open, so this slice is "ready for PR" — hand off:

**If this slice was the skeleton**, first post a **"Skeleton map" comment on every downstream delta ticket**: the list of files the skeleton created/changed, one line each (`path — what it is / which layer`), taken from the final implement/fix result's `changedFiles` + provenance. This refreshes the deltas' "Where to look" with the feature's *actual* shape — a fresh delta agent mirrors these files, not a guess made before the skeleton existed. (Comments only — never edit sibling ticket bodies.) Idempotent: update an existing `Skeleton map` comment rather than adding a second.

**PRD sync-back.** If implementation deviated from the PRD — a disputed finding upheld, a contract clarified, an AC amended in flight — append one line per deviation to an **`## Implementation deltas` comment on the PRD ticket** (one comment, idempotent: extend it, never add a second; never rewrite the PRD description itself, and never post implementation deltas on the feature ticket). This keeps `/to-issues` re-runs and `/compliance-check` reading a truthful spec. No deviations → write nothing.

Then advance the work pointer:

- Find the **next slice in the stack** — the earliest slice in the published stack order whose predecessors all have an open or merged PR. Readiness comes from **PR state, never the tracker's blocked flag**: internal tickets are marked Done at the whole stack's final QA handoff, so blocked relations can remain unresolved during development. With fan-out, several deltas become ready at once — the pointer marks just the earliest, and you tell the user which siblings are also ready for parallel worktrees.
- **If there is a next slice** → add **`<NEXT>`** to it — `<HITL>`-labelled or not (HITL is a decision the next run makes and records, not a reason to hold the pointer). That is the signal the next `/work-slice` run reads to pick it up. Only ever one slice carries `<NEXT>`.
- **If there is no next slice** → do **not** stamp `<NEXT>`; say the stack is complete.

Name the slice that now carries `<NEXT>` (the next `/work-slice <PRD-ISSUE>` run stacks it on this branch). Checkpoint: `HANDED_OFF`. Then — unless an orchestrator told you to stop here — go straight into Step 7.

## Step 7 — Babysit the PR (no handoff to the human)

The draft PR is the review surface, and this skill stays with it until it is in order. Run **`/babysit-stack <PR number>`** (`<PR number>` = this slice's PR; babysit accepts explicit PR numbers). It is a babysitting mode, not a pass: it gets CI green, requests `<BOT>` and fixes until that bot is satisfied, then summons `<COMMENT-BOT>` by PR comment and fixes until it is satisfied, resolves every review thread, and **waits for each bot round itself** with bounded polls — all on GitHub, with a fresh fix agent per attempt. It returns only with a terminal verdict:

- **GOAL MET** → checkpoint `BABYSAT` (record the verdict) and go to **Step 8** — the PR is finished, so now the evidence is captured.
- **NOT MET** → nothing actionable is left: only `needs-human` threads, stuck CI, or a capped fix signature (a rate-limited or unavailable review bot is skipped and disclosed, never a blocker). Record the verdict in the checkpoint (stage stays `HANDED_OFF`), report the blockers verbatim as the stop reason, and end — **capturing nothing**; a PR short of GOAL MET gets no visual evidence anywhere. Re-running `/work-slice <slice-id>` later re-enters at Step 7 (babysit resumes from its own state file) — the human resolves the blockers on the PR first.

`/feature-goal` runs this step too — every PR session babysits its own PR before the next slice is cut, so bot findings are fixed in the PR that caused them and never inherited up the stack; its final stack-wide `/babysit-stack <ISSUE>` is a sweep, not the first review. Only an orchestrator that explicitly says "stop at Step 6" may skip this step, and it then owns the babysit **and** Step 8 itself.

## Step 8 — Capture the evidence, once, now that the PR is done

Reached only on a babysit **GOAL MET** verdict. This is the **only** place this skill captures anything visual, and it runs once per verified PR head — full mechanics in `references/pr-evidence.md` ("The capture stage"):

1. **Skip conditions, stated not guessed.** Internal-only slice (no user-facing surface), no run command resolved (`references/run-app.md` §1), no stack in this workspace, or the app cannot render real copy here (§4) → write the section's one-line form (`No user-facing change — no visual verification.` / the one-line reason) and go to point 5. Never substitute a Storybook or design image.
2. **Capture.** On this PR's branch at the head CI went green on, with the one dev server serving it, started per `references/run-app.md` (the Conductor run script for this environment, never the e2e harness): a throwaway Playwright spec under its own minimal config (`e2eDir` dev-login pattern, seeded user), the real-copy check and the **secret preflight** before any shot, then the fewest scenes that prove the change (aim 1–3, video for behaviour, still for appearance, never both of the same thing, finished state only — there are no before shots). Write `evidence/media/` + `media.json` with the criteria each scene covers. A user story that fails here is a **real regression** on a green PR: stop and report it, never doctor the capture.
3. **Publish** `.context/<slice-id>/evidence/media/` to `<MEDIA-BRANCH>` under `pr/<n>/` from a throwaway worktree (commit `media: PR #<n>`, sha-pinned raw URLs).
4. **One `gh pr edit`** inserting `## Visual verification` between `## Verification` and `## Notes`. Nothing else in the body changes; the bots are already satisfied, so the CI restart this triggers costs nothing.
5. **Clean up:** delete the throwaway spec — nothing untracked may remain in a source dir. Checkpoint `COMPLETE` (verdict + media commit sha). Report: the PR, the babysit table, the scenes published, the assumptions recorded.

The captured files stay in `.context/<slice-id>/evidence/media/` and on `<MEDIA-BRANCH>` — `/feature-goal` re-uses exactly these for the feature ticket's `## QA handoff` after the stack-wide babysit. It requests Step 8 again if a later stack fix changes the recorded `sourceHead`, and this skill never posts them on a ticket itself.

## Boundaries

- One slice per run. Don't batch slices.
- **Never create a worktree or a new branch.** Operate in the current (e.g. Conductor) worktree; keep its branch name and only rebase its empty starting point onto the predecessor after Step 2's clean/zero-commit checks, but never create additional branches or worktrees (no `gh stack add`/`gh stack init` — they create and check out branches), and never rename the Conductor worktree directory. If it isn't a clean worktree, stop and tell the user (Step 2).
- **`<STACK>` owns stacking.** Commits are plain `git commit` on the current branch; the stack is linked server-side at PR time (Step 5.3). Every stack call must be non-interactive (`--json`, `--auto`, explicit args) per the `<STACK>` skill. Never `--prune` a sync while sibling stack branches are checked out in other Conductor worktrees.
- **`<PR-SKILL>` is a repo skill — never edit it.** Preserve its title, conflict and Summary rules while applying `issue-lifecycle.md` to issue links, statuses and tracker writes. Then **`gh stack link` adopts that PR** by PR number, retargeting its base and recording the chain. Never link by branch name or pass `--open`; never use `gh stack submit`. Keep the convention audit in local evidence. The usual body writes are `## Issues` + `## Verification` (+ `## Notes`) at 5.2b and `## Visual verification` at Step 8; repair missing issue links idempotently on resume.
- Never merge, approve, or mark the PR ready — Step 5 opens it as a **draft** (`<PR-SKILL>` opens ready → `gh pr ready --undo`); promoting to ready is the human's call after review.
- **No human gates.** A `<HITL>` label or routing mismatch is disclosed and recorded (Step 1), never waited on; the PR opens without confirmation (Step 4→5); babysit runs to a terminal verdict (Step 7). The only stops are safety stops — dirty/missing worktree, no committed diff, gut-check hard-stop — and babysit's `needs-human` escalations.
- **The CLI owns the loop.** Reviewer selection, suppression, the relevance gate's thresholds, gate injection, stall/cap stops, dispute adjudication flow, and the verdict all come from `<ENGINE>`'s JSON output — never re-derive them in prose, never hand-edit `.context/<slice-id>/ledger.json` or a findings file, and never skip a command because you "know" what it will say.
- **Every emitted task must complete with its resolved model and valid JSON.** Native workers and the shared CLI adapter use the same contract; incomplete coverage blocks advancement.
- Use the shared model registry: implementer/fixer/adjudicator roles for those passes, reviewer/verifier roles for reports. Apply the resolved model and effort explicitly.
- Reviewers are **read-only** — only the implement/fix agents edit code; **every writer pass is a freshly spawned agent** (implement, gate-fix, each round's fix, adjudicator, Playwright fixes), never a previous pass's agent continued. Handoff is files only.
- **Commit subjects follow `<COMMIT-RULE>`** — resolved by the engine from the (pinned) config, never hand-rolled and never "issue id first" unless the rule says so. The engine rejects a mismatch at `init` and `apply-fix`, and `commit-check` gates the Step 5 push.
- **Tests + commit gate:** reviewers never see red or uncommitted code — the CLI turns a red gate into a gate-fix pass mechanically, and implementers must prove green with `testEvidence` (commands + summary lines run in-session), never assert it.
- Playwright runs as a **skill-owned loop, only after the CLI's loop converges**, and only on user-facing slices (max 3 rounds), **verification only — no artifacts kept**. A broken user story is a **blocking** finding (failed AC), not advisory.
- **One dev server per slice run**, started with the Conductor run script for this environment (`references/run-app.md`). Reuse it when it already serves; never start a second instance. Never capture a screen showing translation keys or test-mode copy. All evidence capture passes the secret preflight; a secret in a capture means discard + recapture, never blur/crop/edit.
- **PR evidence is factual, and captured once.** `## Verification` rows come from `evidence/verification.jsonl` — commands actually run in-session, results from their output. `## Visual verification` shows only Step 8 captures — taken after babysit GOAL MET, on the finished branch, published to `<MEDIA-BRANCH>` by sha. Nothing visual is captured, published or posted before that verdict, and the same files serve the PR body and (via `/feature-goal`) the human ticket's handoff — never a second set. An uncapturable surface or a check left to CI is written down, never omitted or faked.
- **`<FIDELITY>` is a repo extension point** — run it only when configured (blocking deviations = failed ACs); with no key, never improvise a design comparison.
- **Routing disclosure:** with `<AGENT:>` configured, a slice labelled for a different agent is still worked when invoked here, with the mismatch stated in the terminal and under the slice ticket's `## Assumptions` — never on the PR.
- TDD discipline is carried in the implement/fix prompts (red-green per criterion); loop agents don't load the `tdd` skill directly.
- **Checkpoint every stage boundary** (`## Workflow State`, full OIDs). On re-invocation resume from it — but durable markers (branch, ledger, PR state) always win over the checkpoint file.
- Don't apply `labels.agentReady` to anything — this skill speaks `<NEXT>`, never the autonomous-loop trigger.
- Don't modify the PRD ticket's description, the feature ticket's description/comments, or sibling slices' bodies. Parent/PRD claim fields follow `issue-lifecycle.md`. Besides those claim fields, the only writes beyond this slice's own ticket: moving the `<NEXT>` pointer, posting/updating the "Skeleton map" comment on downstream deltas, and extending the `## Implementation deltas` comment on the PRD ticket (Step 6).
- **Conventions are binding, not advisory:** exemplar mirroring per the slice's Convention contract; every added file carries a provenance row (`mirroredFrom` or a declared `[deviation: reason]`) — silent deviation is a blocking finding; no new helper without a `<SRC>` search.
- **Contract freeze:** a delta never alters the skeleton's published contract (schema/types/API shape). A needed contract change stops the slice and escalates — the stack gets restructured, not quietly edited.
- **Consolidation never widens a slice:** in-slice extraction only within this slice's own new code + at most one existing call site; anything wider is a follow-up only when `followups` selects it (Step 4, `references/followups.md`), named in the PR body's `## Notes` (Step 5). Everything else is a note or nothing.
- **No pre-PR confirmation gate.** Once the loop finishes, open the draft PR automatically (Step 4→5); the only skips are "no committed diff" and a gut-check hard-stop. Never promote it to ready or merge — that stays the human's call on the draft.
- **Babysit is part of the slice** (Step 7) unless an orchestrator owns the stack's babysit, and **Step 8 follows it** — evidence belongs to a finished PR. Bot reviews happen on GitHub only — never run a review CLI.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow

## Workflow Boundaries

**This skill drives exactly one PRD slice to a stacked draft PR.**

- **DOES**: claim the `<NEXT>` slice (recording HITL decisions as assumptions), record/base the existing branch, implement test-first, drive the engine-CLI review loop, run the artifact-free Playwright user-story loop, post the text-only QA evidence + consolidation tickets, open the draft PR with `## Verification` in its body, stack-link it, advance `<NEXT>`, run `/babysit-stack` on its PR to a terminal verdict, and — only on GOAL MET — capture, publish and insert `## Visual verification` (Step 8).
- **DOES NOT**: ask the human anything, capture / publish / post any visual evidence before babysit GOAL MET, put images on a slice ticket, create worktrees or branches (Conductor owns them), own CI/bot/thread mechanics (`/babysit-stack` does — this skill only invokes it), re-derive loop decisions (the engine CLI owns rounds, suppression, verdicts), merge or mark ready (the human's call on the draft), batch slices.

## Red Flags — STOP

- About to create a worktree or a new branch — stop: keep the existing branch name; base it only after the empty-branch checks (Step 2); a dirty or missing worktree goes back to the user.
- About to stop for a `<HITL>` label, a "needs a human decision" line, or an `<AGENT:><other-agent>` label — stop stopping: decide + record under `## Assumptions` / disclose the routing mismatch, and proceed.
- About to run `gh pr comment` on this slice's own PR — stop: the suite never comments on its own PRs; human-relevant residue is `## Notes` in the body, everything else stays in `.context/`.
- About to end the run after Step 6 with no orchestrator having claimed the babysit — stop: Step 7 runs `/babysit-stack <PR>` to its terminal verdict, and Step 8 captures the evidence after it.
- About to capture a screenshot, record a video, publish media, or write `## Visual verification` before babysit says GOAL MET — stop: the Playwright loop is verification only; evidence is Step 8's, once, on the finished PR.
- About to embed a screenshot or video in the slice ticket's `## QA evidence` — stop: that comment is text only; visual proof lives in the PR body and the human ticket's handoff.
- About to recapture for the ticket handoff, or capture a second set of scenes for the same PR — stop: one capture stage per PR; the handoff re-uses the published files.
- About to report the run done on a NOT MET babysit by capturing anyway — stop: no GOAL MET, no evidence; report the blockers and end.
- About to wait for a bot review yourself, or run a review CLI — stop: babysit owns the waiting and bot reviews happen on GitHub.
- About to skip an engine command, re-derive its verdict, or hand-edit `.context/<slice-id>/ledger.json` / a findings file — stop: the CLI owns the loop.
- About to re-prompt or continue a previous pass's writer agent (implement, fix, adjudicator, Playwright fix) — stop: spawn a fresh one and hand it the files.
- About to start a second dev server for a Playwright round — stop: reuse the instance already serving; a bound-but-wrong port goes to the user.
- About to add a `## Verification` row for a command you did not run, or present an image you did not capture as current — stop: record `not-run` / recapture instead.
- About to check out the base or add a worktree to manufacture a "before" shot — stop: scenes show the finished state only; there are no before/after pairs.
- A capture shows a secret shape (`sk-`, `ghp_`, `Bearer `, `?token=`) — discard and recapture; never blur/crop/edit.
- About to `gh stack link` by branch name, pass `--open`, or run `gh stack submit` — stop: link by PR number only, never `--open`, never `submit`.
- A delta needs the skeleton's published contract changed — stop and escalate (contract freeze); the stack gets restructured, not quietly edited.

## Verification

Before reporting done:

- [ ] `.context/<slice-id>/workflow-state.md` reads `COMPLETE` (babysit GOAL MET **and** Step 8 done) — or `BABYSAT` / `HANDED_OFF` with the babysit NOT MET reason / the orchestrator's stop-here instruction named — with full OIDs and the loop verdict verbatim.
- [ ] No question was put to the human: HITL decisions and routing mismatches are recorded under the slice ticket's `## Assumptions` (and, for decisions, one `## Notes` bullet on the PR), not waited on.
- [ ] `gh pr view <n> --json baseRefName,isDraft` shows the predecessor's branch (`<BASE>` for the skeleton) and `isDraft: true`.
- [ ] PR body `## Issues` links the human parent, PRD and this slice by URL,
  without auto-closing the parent; mapping survived stack/evidence body edits.
  Parent/PRD claims are reconciled; whole-stack final statuses remain
  `/feature-goal` QA-HANDOFF's responsibility.
- [ ] **Zero suite comments on the PR.** Provenance and the review ledger stayed in `.context/<slice-id>/` + the terminal summary; only human-actionable residue reached the PR, as ≤5 `## Notes` bullets in the creation body write.
- [ ] The PR body carries `## Verification` (every row backed by `evidence/verification.jsonl`) from the creation write, and `## Visual verification` from Step 8's single post-GOAL-MET write (scenes published to `<MEDIA-BRANCH>` by sha, or the one-line internal-only / uncapturable form) — the usual two body writes, in that order; idempotent issue-link repairs are allowed.
- [ ] **Nothing visual existed before GOAL MET**: the Playwright loop kept no artifacts, `evidence/media/` was written only by Step 8, and no image reached a tracker comment from this skill.
- [ ] User-facing slice: `## QA evidence` comment on the **slice** ticket — one PASS/FAIL row per acceptance criterion, **text only, no media**; no comments were written on the PRD ticket beyond `## Implementation deltas`, and only lifecycle claim fields on the feature ticket (its one `## QA handoff` is `/feature-goal`'s, written only after GOAL MET).
- [ ] User-facing slice: `evidence/media/` holds the fewest scenes that prove the change (video for behaviour, still for appearance, none duplicated, finished state only), each listing the criteria it covers in `media.json`, published to `<MEDIA-BRANCH>`.
- [ ] Skeleton slice: "Skeleton map" comment posted/updated on every downstream delta ticket.
- [ ] Exactly one slice carries `<NEXT>` — or the report says the stack is complete.
- [ ] `git status --porcelain` is clean — no review scaffolding left to trip the pre-push hook.
