---
name: work-slice
description: Pick up the next-slice sub-issue from a PRD, implement it test-first inside a bounded review-fix loop, open a stacked draft PR, then babysit that PR (CI, Copilot rounds, CodeRabbit rounds, thread resolution on GitHub) until it is in order. No human gates. Use when the user says "work the next slice", "start the next ticket", "implement slice X", "pick up this slice", or wants to work through PRD slices created by /to-issues.
---

# Work Slice

Drive **one** slice from a PRD to a stacked **draft PR**. The slices were produced by `/to-issues` as sub-issues of a parent PRD ticket, ordered into a stack. This skill picks the next one up, implements it test-first inside a bounded **targeted review ⇄ fix loop**, **opens a stacked draft PR automatically**, and then **babysits that PR** (Step 7 — `/babysit-stack`) until CI is green, the review bots are satisfied and every thread is resolved. **There is no human gate anywhere in this skill**: no confirmation before the PR, no stop on a HITL label, no stop on a routing label — the only stops are safety stops (dirty worktree, no committed diff, gut-check hard-stop) and `needs-human` escalations babysit cannot resolve. Run it once per slice; the next run stacks on the last.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block). The engine CLI
reads the same file itself (`--config`, defaulting to that path in the host
repo root); the placeholders below stand for its values wherever this skill
acts directly. Missing file or empty key → the generic defaults apply and you
say so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | leave the status untouched |
| `<NEXT>` | `labels.sliceNext` | no pointer label — the user names the next slice |
| `<HITL>` | `labels.needsHuman` | read "needs a human decision" from the ticket body — informational, never a gate |
| `<SKIP>` | `labels.managerSkip` | skip the triage opt-out stamp |
| `<PR-SKILL>` | `skills.createPr` | write the PR title/body inline, following `pr.titleRule` |
| `<TITLE-RULE>` | `pr.titleRule` | `<type>: <subject>` |
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

## Resume — the `## Workflow State` checkpoint

This skill is **re-entrant: run it again to resume.** The checkpoint lives at
`.context/<slice-id>/workflow-state.md` in the host repo (gitignored) and is a
single overwritten block — full OIDs, never abbreviations:

```markdown
## Workflow State
- Stage: IMPLEMENTED
- Slice: PROJ-1234
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
`EVIDENCE_POSTED` (Step 4 QA evidence + consolidation tickets) → `PR_OPENED`
(Step 5.2) → `STACK_LINKED` (Step 5.3–5.4) → `HANDED_OFF` (Step 6 pointer
advanced) → `COMPLETE` (Step 7 babysit GOAL MET). **Rewrite the block at every
stage boundary.** An orchestrator (`/feature-goal`) may tell you to stop at
`HANDED_OFF` because it babysits the whole stack itself.

On invocation, if the chosen slice's checkpoint exists: read `Stage`, verify
its facts against the durable markers — the branch exists, `git rev-parse
HEAD` matches or descends from `Head`, the review loop's own state via the
CLI's `status`, PR state via `gh pr view` — **reality wins over the file** —
then continue from the first incomplete stage instead of restarting. Mid-loop
resume belongs to the CLI: `status` prints the phase and the pending step.

## Step 1 — Select the slice

**Preflight (before you claim anything):** confirm you're in a clean, dedicated worktree per Step 2. If you're not in a git worktree, or it has uncommitted changes, **STOP and tell the user** — do not claim the slice and do not create a worktree yourself.

Input is a parent PRD ticket id, a specific slice id, or nothing.

- **Specific slice id given** → use it.
- **Parent id given (or inferable from context)** → list its sub-issues and pick the slice carrying **`<NEXT>`** — the single work pointer that `/to-issues` (skeleton) or a previous `/work-slice` run placed on the slice that is up. That is the one to work. **Fallback** if no slice carries `<NEXT>` (e.g. it was cleared by hand): take the earliest slice in stack order that is **ready** (every predecessor has an open or merged PR — PR state, not the tracker's blocked flag; see Step 6) and **not-done, not-in-progress** (a `<HITL>` label does not exclude it — see below).
- **Nothing** → ask for the parent id or slice id.

**A `<HITL>` label (or a "needs a human decision" line in the body) is not a gate.** Read the decision, pick the option most consistent with the parent PRD and the skeleton's published contract, and record it — one line under a `## Assumptions` comment on the slice ticket (idempotent: update, don't duplicate) and in the Step 5 PR comment. Then implement as if it were AFK. The human reads assumptions at PR review time; they never block a slice.

**Routing disclosure** (only when `<AGENT:>` is configured): if the chosen slice carries an `<AGENT:><name>` label naming an agent **other than the runtime you are running in** (Claude Code vs Codex — you know which you are), you still work it — the user or orchestrator invoking you here made that call — but say so once in the terminal and in the Step 5 PR comment: `routing label <AGENT:><name> not honoured: worked by <this runtime>`. A matching label, or no `<AGENT:>` label, changes nothing.

Fetch the chosen slice AND its parent PRD (the PRD lives in the parent's `# PRD` comment — read it from there). Read, verbatim: the slice's **Kind** (skeleton vs delta), **Novel decision**, acceptance criteria, "Where to look" code-layer pointers, the **"Convention contract"** section (binding exemplars + must-use libs), "Design" Figma nodes/tokens, and "Stacked on" predecessor. For a **delta**, also read the ticket's **"Skeleton map" comment** (posted by the skeleton's `/work-slice` run — the actual files the skeleton created; the primary mirror). Read the parent PRD for the wider contract.

**Claim the slice.** Remove its `<NEXT>` label and set its status to **`<IN-PROGRESS>`** so it reads as actively worked and no parallel run grabs it. The pointer only moves on to the next slice after the draft PR is opened (Step 6). When removing/adding `<NEXT>`, write back the issue's full existing label set minus/plus only that label — never drop a type label, `<SKIP>`, or any product label (Linear's `save_issue.labels` replaces the whole set; see `labels.docPath`). Checkpoint: `CLAIMED`.

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

`gh stack` keeps **no local tracking state until PRs exist** in this flow — the branch is plain git here, and Step 5 links it into the stack after `<PR-SKILL>` opens the PR. That is deliberate: it makes the flow safe across Conductor's one-worktree-per-slice layout, where the predecessor's branch is checked out in a *different* worktree and cannot be checked out here.

The slice's branch is **whatever Conductor checked out** (a `start-work` slug like `proj-1234-…`, or a Conductor-generated name) — you will **rename it in place** to the stack branch name below. `git branch -m` only renames the branch already checked out; it does not create a branch or a worktree. Before renaming, sanity-check you're in the slice's intended worktree (HEAD should be fresh off the base, not carrying another slice's commits).

**Resolve the base branch and the stack position** — base feeds the reviewers' `git diff <base>...HEAD` and the stacked PR; the position gives the branch its number:

- **Skeleton slice** (first in the stack) → base = `<BASE>`; stack position **`01`**.
- **Downstream slice** → base = the **predecessor slice's stack branch** (the blocked-by ticket — the skeleton for fanned-out deltas, the chained predecessor otherwise) — the renamed `<project-slug>/NN-<issue-id>` branch a previous `/work-slice` run created. Find it on the remote by the predecessor's issue id: `git ls-remote --heads origin '<project-slug>/*'` (match the predecessor's id suffix), or read the predecessor's open PR head with `gh pr list --state open --json number,headRefName,baseRefName`. This slice's position `NN` is its **index in the PRD's published stack order** (the `/to-issues` numbering) — NOT predecessor+1: with fan-out, several deltas share the skeleton as predecessor, and only the stack-order index stays unique. If the predecessor has already merged, base off `<BASE>` instead and note it.

### Rename the branch to the stack name

Derive `<project-slug>` once per stack: kebab-case the parent PRD's **project name** (e.g. project "Summary feature" → `summary-feature`). If the PRD has no project, fall back to a kebab-case of the parent PRD ticket's short title. The branch name is `<project-slug>/<NN>-<issue-id>` — the project-slug namespace prefix, the zero-padded stack number, then this slice's issue id lower-cased: `summary-feature/01-proj-1234` for the skeleton, `summary-feature/02-proj-1290` for the next in stack order, and so on. The `<project-slug>` segment is the shared namespace prefix that groups the stack's branches under one name (and lets you list them with `git ls-remote --heads origin '<project-slug>/*'`); `NN` keeps the stack readable in order; the id suffix ties each branch to its ticket. Rename in place:

```bash
git branch -m "$(git rev-parse --abbrev-ref HEAD)" summary-feature/01-proj-1234
```

The rename is the **only** branch mutation — no new branch, no worktree change. **Leave the Conductor worktree directory name as-is** — renaming the dir breaks any path-keyed local service stack, Conductor's workspace tracking, and the running dev server. Conductor may have already pushed the pre-rename name; the stale remote branch is cleaned up at push time (Step 5).

### Base the branch on its predecessor

Conductor branches the worktree off `<BASE>`, not off the predecessor — so a downstream slice must be **moved onto** its predecessor before any code is written, or the diff and the PR both show the predecessor's commits as this slice's.

- **Skeleton slice** → nothing to do; it is already based on `<BASE>`.
- **Downstream slice** → the renamed branch is still **empty** (zero commits ahead of `<BASE>`), so re-point it at the predecessor rather than rebasing history:

  ```bash
  git fetch origin <predecessor-stack-branch>
  git rev-list --count <BASE>..HEAD               # MUST print 0 — otherwise STOP
  git reset --hard "origin/<predecessor-stack-branch>"
  ```

  The count check is the guard: if the branch already carries commits you are not in a virgin slice worktree — **STOP and tell the user** rather than discarding work.
- **Predecessor already merged** → stay on `<BASE>` and note it; this slice starts a fresh stack.

Verify with `git log --oneline -1` that HEAD is the predecessor's tip. From here every commit in Step 3 is a plain `git commit` on this branch, and Step 5 links the branch's PR into the GitHub stack. Checkpoint: `BRANCH_READY`.

## Step 3 — Implement + targeted review loop (engine CLI)

**Precondition:** Step 2 must have already renamed the branch to its stack name and, for a downstream slice, based it on the predecessor (`git log --oneline -1` shows the predecessor's tip). Every agent in this step commits with plain `git commit` on the current branch — if the base is wrong, every review round reviews the wrong diff.

The loop machinery is the plugin's **engine CLI** — a dependency-free Node CLI. **Loop control is deterministic CLI output, never prose discipline:** run each command from the host repo root, read the JSON it prints, and do exactly what its `action` / `next` field says. Never re-derive reviewer selection, finding suppression, classification thresholds, or stop conditions yourself — the CLI owns them, and its run state lives in the host repo's gitignored `.context/<slice-id>/` (ledger, emitted prompts, findings inbox). Which reviewers exist and when they trigger: `references/reviewer-roster.md` (documentation; `engine/lib/roster.mjs` is the source of truth).

Resolve `<ENGINE>` once — it lives in the **plugin install root**, not the host repo:

```bash
engine="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/engine/cli.mjs}"
[ -n "$engine" ] && [ -f "$engine" ] || engine="$(realpath "<this-skill-dir>/../..")/engine/cli.mjs"  # symlinked install
[ -f "$engine" ] || engine="$(ls -d "$HOME"/.claude/plugins/cache/*/magnus/*/engine/cli.mjs 2>/dev/null | sort -V | tail -1)"
```

### 3.0 Write the run contract

`mkdir -p .context/<slice-id>` and write `.context/<slice-id>/contract.md` — the contract text every prompt in the loop (reviewers, validator, fixer, adjudicator) receives. Include, verbatim where the ticket has it: the slice id + title, its **Kind** with the matching guidance below, the acceptance criteria, the one **novel decision**, "Where to look" (for a delta, prepend the Skeleton map comment's file list — the primary mirror), the **Convention contract** (binding exemplars + must-use libs), the Figma node deep-links, the parent PRD's wider contract, and the commit rule (message starts with the slice id; never `git push`).

- **Skeleton:** this is the stack's WALKING SKELETON — the full end-to-end path with the REAL contract (schema, types, API shape, UI shell, one happy-path behaviour, tests wired) and stubbed/minimal behaviour elsewhere. Every cross-layer decision lands here; downstream deltas mirror this code, so its shape IS the feature's convention. Clone the exemplar's shape; don't invent structure an exemplar settles.
- **Delta:** a BEHAVIOUR DELTA on the walking skeleton — the skeleton (this feature's earlier slices, already on the base branch) is the primary pattern to mirror; sibling features are the fallback. Prefer APPENDING over modifying, introduce at most the ticket's one named novel decision, and **never alter the skeleton's published contract** (contract freeze — a needed contract change stops the slice and escalates).

### 3.1 Implement pass

**Pre-capture the before state first** — user-facing slice (bias true) with `devServerCommand` set: while the tree is still the base, start (or reuse — 3.5 rule 1) the one dev server, pass the secret preflight (3.5 rule 2), and capture the surfaces the acceptance criteria / "where to look" / design links name into `.context/<slice-id>/evidence/media/<scene>-before@2x.png` per `references/pr-evidence.md` (1440 px, 2× scale, the same crop the after shot will use). A brand-new surface has no before. A before you cannot predict or capture now is recorded as `Before not captured — <reason>` at PR time, never manufactured later by switching branches or adding a worktree. Skip entirely, and say so, when the slice is internal-only or `devServerCommand` is empty.

One implementer, the **strongest model**, obtained through the writer-spawn ladder in 3.3 — a freshly spawned agent whenever the runtime has any spawn mechanism, inline only as the disclosed last resort. TDD discipline: one tracer-bullet test → impl per acceptance criterion (vertical slice — never all-tests-then-all-impl), using "Where to look" as the starting map. Binding rules: mirror the convention contract's exemplars (a deviation is allowed only when declared in the provenance table with a concrete reason — silent deviation is a review-blocking offence); no new helper/util/hook/component without first searching `<SRC>` (and the design system, and `repoConfig.libMap`) for an existing equivalent; consolidation is in-scope only within this slice's own new code plus at most ONE existing call site — anything wider is a noted candidate, not a refactor; stay strictly inside this slice's scope and note anything a later slice owns instead of pulling it forward. For UI: fetch the Figma screenshot fresh via the Figma MCP from the slice's node deep-link and reuse design-system tokens/components, not magic numbers. Run tests + lint/typecheck with `<GATE>` and see them pass **in-session** before claiming green. Commit (message starts with the slice id; never push).

Record the result as JSON at `.context/<slice-id>/implement-result.json`:

```json
{"summary": "", "committed": true, "head": "<git rev-parse HEAD>", "testsGreen": true,
 "testEvidence": "<commands + final summary lines>",
 "changedFiles": [], "addedFiles": [], "deletedFiles": [],
 "provenance": [{"file": "", "mirroredFrom": "", "deviation": ""}],
 "touchedAreas": [], "userFacingImpact": true, "diffStat": "", "notes": []}
```

`changedFiles`/`addedFiles`/`deletedFiles` from `git diff --name-only [--diff-filter=A|D] <base>...HEAD`; one provenance row per added file (`mirroredFrom` = the exemplar actually followed, or `deviation` = why none fits — never both blank); `userFacingImpact` biases **true**; `testsGreen=true` only after running the gates in-session — and every gate command run lands as a row in `.context/<slice-id>/evidence/verification.jsonl` (`references/pr-evidence.md`), the implementer's `testEvidence` included; gate-fix and fix passes append their runs the same way. No committed diff → stop and tell the user (nothing to review or PR). Checkpoint: `IMPLEMENTED`.

### 3.2 Start the loop

Extract the provenance array to `.context/<slice-id>/provenance.json`, then:

```bash
node "$engine" init --slice <slice-id> --base <base> \
  --tests-green <bool> --committed <bool>          # gate values from implement-result.json
```

`resumed: true` means a prior run's state exists — run `status` and continue at the phase it names instead of restarting.

### 3.3 Obey the CLI

The cycle (`status` re-prints the pending step any time):

```bash
node "$engine" plan --slice <id> --changed-files <csv> --added-files <csv> --deleted-files <csv> \
  --insertions <n> --user-facing <bool> --declared-areas <csv> \
  --provenance-file .context/<id>/provenance.json --head <head> --commit-rule '<slice-id> …'
# → gate-fix (red gate: run ONE fix implementer with the emitted prompt, then apply-fix), or
# → the round's task manifest: prePass (round 1), reviewers[]
node "$engine" collect --slice <id>
# → validator task when findings survived suppression; run it, then
node "$engine" decide --slice <id> --verdicts <verdicts.json> --commit-rule '<slice-id> …'
# action=fix        → run ONE fresh fix implementer with fix.promptFile → apply-fix --result <fix-result.json>
#                     → plan again with the fix range's files (git diff --name-only <prevHead>..<newHead>, etc.)
# action=adjudicate → adjudicate → run ONE fresh agent with the emitted prompt (never the fix implementer)
#                     → apply-adjudication --rulings <rulings.json>
# action=converged|stalled|hard-stop → the loop is over:
node "$engine" report --slice <id>
```

**Running an emitted task.** Every task names an `agentFile` (the roster file — its body is the agent's system prompt), a `promptFile` (the task), an `outputFile` (the JSON the agent must write — path and schema are in the prompt), and a `model` when the roster file pins one. Mechanism is runtime-dependent; **subagents are an optional accelerator, the loop is sequential-first**:

- **Claude:** spawn each reviewer as a subagent from its agent definition (the definition's `model`/`effort` pins apply); reviewers are read-only, so run a round's reviewers **in parallel**.
- **Codex:** background `codex exec` children, the agent-file body prepended to the task prompt; map the task's `model` alias through `routing.codexModelAliases` and pass it with the task's `effort` as the child's model/effort flags (unmapped alias → session model, disclose once).
- **Neither:** run each reviewer yourself, one at a time, adopting the roster file's persona fresh per reviewer — and disclose the fallback once. Sequential costs wall-clock only; it is **never a licence to drop a reviewer**.

**Writers spawn the same way — one fresh agent per pass.** The ladder applies to every code-editing pass too (3.1's implementer, each gate-fix, each round's fix implementer, the adjudicator, each Playwright fix): Claude → a subagent per pass; Codex → a `codex exec` child per pass; neither → inline, disclosed once. Two rules make the freshness real:

- **Never continue, re-prompt, or resume a previous pass's agent** — no `SendMessage`, no "same subagent, round 2". Round N's fixer is a new agent that has never seen round N-1's reasoning; that is the point of the round.
- **State travels as files, never as a live context** — `contract.md`, the emitted `promptFile`, and the prior result JSONs are the whole handoff. Anything a later pass needs must be written into one of them.
- **Inline fallback:** each pass is still a fresh persona — re-read `contract.md` and the emitted prompt and work from those plus the repo, not from your memory of the pass before. Isolation is degraded (one context holds every pass); say so once, alongside the sequential-reviewer disclosure.

Ground rules, regardless of mechanism:

- **Gut-check runs first** (round 1). If its JSON contains any `"disposition": "block"` observation, skip the reviewers and run `collect` immediately — it hard-stops for the human before any reviewer spend. Otherwise run the reviewers.
- **Every emitted reviewer must report before `collect`.** A missing or invalid `outputFile` is a dead reviewer: re-run it once; still nothing → proceed, but state the degraded coverage explicitly (it rides into the PR notes as such) — zero findings only counts when every reviewer actually reported.
- **Reviewers are read-only** — only the implement/fix agents edit code. Every writer pass is a **freshly spawned agent**: the implement pass, each gate-fix, each round's fix, the adjudicator (never the fix implementer's context), and each Playwright fix.
- **Model roles:** writers (implement, every fix pass) and the adjudicator get the strongest model; reporters (reviewers, gut-check, validator) run leaner. Aliases only, never exact model ids; honor a task's `model` field when present.
- `--head` = the implement pass's commit on the **first** `plan` only; `apply-fix` records each fix head itself, so later `plan` calls omit it. After each `apply-fix`, update the checkpoint's `Head`, and recompute the next `plan`'s file flags from the **fix range** (`<prevHead>..<newHead>`) with the whole-slice provenance from the fix result.
- Never hand-edit `.context/<slice-id>/ledger.json` or a findings file — findings enter through reviewer output files, decisions exit through the CLI.

The stop conditions live in the CLI (convergence, two-round stall, per-fingerprint deferral, hard cap 5 rounds — a safety boundary, not a target). A non-converged stop reports `stalled — shipped with N open findings (CR-…)`, never a silently exhausted cap.

### 3.4 Read out the result

`report` returns the verdict, the ledger report (open / addressed / deferred / disputed entries with `CR-NNN` ids, dispute evidence, adjudication rulings), and the advisory notes. Also gather the `consolidations` arrays from `.context/<slice-id>/round-*/findings/*.json` (reuse-audit follow-up candidates) and the notes from the implement/fix results. Checkpoint: `REVIEWED`, with the verdict verbatim. A `hard-stop` (gut-check block) goes straight to the user — no PR.

### 3.5 Playwright user-story loop (skill-owned, max 3 rounds)

Runs **only after the review loop converged AND the slice is user-facing** — the implementer's `userFacingImpact` flag biases true; skip only pure refactors / internal utils / no-behaviour-change migrations, and say so. A backend-only diff can still change user-facing behaviour — when in doubt, run it. **With `devServerCommand` empty, skip entirely and say so** — never invent a start command. This loop is yours, not the CLI's: track its rounds yourself (max 3). Verify with a lean model (subagent when available — browser transcripts are token-heavy), fix with the strongest.

Each verify round — read `browserGuidePath` first (login steps, seeded users, routes, selectors, fake-media flags):

1. **One dev server per slice run, ever.** First detect a server that already serves the app (a prior round's, or one the user/worktree bootstrap left running — probe the `baseURL`/port the browser guide or `devServerCommand` config implies) and **reuse it**. Only when nothing serves: start the app **once** in the background with `devServerCommand`, wait until it serves, and reuse that instance across every later round. **Never start a second server** — not on another port, not "fresh for this round"; a second instance means port fights, stale-build confusion, and orphan processes. If the port is bound but not serving this app, stop and tell the user instead of stacking another server beside it.
2. **Secret preflight — before any capture.** Screenshots and video go onto the ticket, so anything visible is leaked: URL bars, terminal panes, config screens, network panels. Hard stops (don't capture; escalate or re-plan the evidence): credentials, tokens, API keys, auth headers, cookies or signed URLs on screen; real customer/personal data; a destructive flow (delete/send/publish) exercised outside seeded fixtures. Scan visible text for the classic shapes (`sk-`, `ghp_`, `xoxb-`, `Bearer `, `Authorization:`, `?token=`, `api_key=`, `.env` contents). Rules: authenticate *outside* the recorded flow and show the authenticated result, not the auth step; use the seeded demo users, never real accounts; a secret that slips into a capture means **discard and recapture** — never blur, crop, or edit it out after the fact.
3. Restore the parked spec (`<e2eDir>/test-output/slice-verify.spec.ts.parked`, gitignored) when it exists; otherwise author a throwaway Playwright spec (reuse the `e2eDir` config + its login-spec dev-login pattern) driving isolated headless Chromium, `video: 'on'`, `baseURL` = the running app, plus any fake-media flags the browser guide names.
4. Dev-login as the seeded user matching the slice, then exercise **this slice's acceptance-criterion user stories**, capturing a screenshot for **every** criterion — PASS and FAIL alike, named `ac-<n>-<pass|fail>.png` — plus the run video. These are QA evidence: Step 4 uploads them to the ticket, so each screenshot must actually show the behaviour it proves (or the breakage).
   In the same run, capture the **PR scenes** per `references/pr-evidence.md` — the **fewest that prove the change** (aim 1–3): one `<flow>.webm` per logical group of behaviour criteria, covering several ACs in one walk-through where they chain (GIF for the PR, the `.webm` for the tracker handoff); a still — `<scene>-after@2x.png` matching a 3.1 before, or `<scene>@2x.png` for a new surface — only for appearance changes a video wouldn't show better. Video or still per scene, never both of the same thing. Write `evidence/media/media.json` (surface, route, viewport, caption, files). Scenes go into the PR body, AC shots onto the ticket — one shot may serve as both.
5. **Design-fidelity check** (only when `<FIDELITY>` is configured AND the slice has design deep-links): invoke the repo's `<FIDELITY>` skill/command with the slice's routes, ACs, and design links (I/O contract in the plugin's CONTRACT.md). Its `blocking` deviations are failed acceptance criteria — same treatment, same rounds; `advisory` deviations are recorded for the QA evidence and PR comment, unfixed. No `<FIDELITY>` key → this point doesn't exist; never improvise a design comparison.
6. **Clean up before returning:** nothing untracked may remain in a source dir (the pre-push lint hook fails on it). On a passing or final round, delete the throwaway spec (and any parked copy); on a failing non-final round, park it in the gitignored test-output dir. Only gitignored screenshots/video (and a parked spec) stay.
7. Record PASS/FAIL per criterion (blocking fidelity deviations count as FAIL) with the proving screenshot. "Couldn't verify" is a FAIL, not a pass. **A broken user story = a failed acceptance criterion = a blocking finding**: hand the failures to one **freshly spawned** fix agent (writer-spawn ladder, 3.3 — never the round before's), commit, re-verify with a fresh round. Round 3 still failing → stop and escalate; the failures ride into the PR as outstanding.

Checkpoint: `VERIFIED`. Before Step 4, run the slice's tests + lint/typecheck green with `<GATE>` one final time and append those runs to `evidence/verification.jsonl` — they are the rows the PR's `## Verification` table is rendered from.

## Step 4 — Present the result, then proceed

**No confirmation gate — the draft PR is the review surface, so proceed straight to Step 5.** First print, from the loop's outputs (so the terminal has the record):

- The slice id + one-line summary of what was built.
- The diff stat (and how to see the full diff).
- Acceptance criteria, each ticked or flagged (Playwright proof screenshots where it verified them).
- The loop outcome: the **verdict verbatim**, which reviewers ran, how many review rounds it took, whether the Playwright loop ran and converged (or how many of its 3 rounds it used) — plus the ledger report: open / deferred / disputed entries with their `CR-NNN` ids.
- Any judgement-call findings — advisory notes the relevance gate demoted, and disputed entries with their adjudication rulings (an upheld dispute is back open; a deadlock is yours to adjudicate on the PR).
- The **provenance table** (added file → mirrored exemplar or declared deviation) — the convention audit trail.
- Any **consolidations** the reuse audit surfaced, and any **ratchet candidates**: a convention finding that showed up in 2+ rounds (or that you recognise from earlier slices) is a candidate for a lint rule / Nx module-boundary tag — name it so the human can move it from review into the tests gate.
- The branch + its base (the stack position).

**QA evidence → the slice ticket (when the Playwright loop ran).** Slice tickets are internal — the user and AI only (`references/qa-handoff.md`) — so this stays in dev form; the QA-facing `## QA handoff` on the **parent** is composed by `/feature-goal` after babysit, from the stack's published media. Upload the proof files (per-AC screenshots + video) to the **slice ticket** with `<TRACKER>`'s attachment flow (Linear: `prepare_attachment_upload` → PUT the file to the returned URL → `create_attachment_from_upload`), then post/update a ticket comment starting with `## QA evidence`: one row per acceptance criterion — PASS/FAIL + link to its uploaded screenshot (video linked at the bottom). When the `<FIDELITY>` check ran, append a `### Design fidelity` subsection — one row per deviation (severity, screen, description; blocking ones also appear as FAILed criteria above). Failed criteria stay in the table marked FAIL so QA sees exactly what broke. Idempotent: update an existing `## QA evidence` comment rather than adding a second.

**Consolidation follow-ups → the tracker (when the loop surfaced `consolidations`):** file each as its own ticket on the team (same create flow as `tracker.docPath`): title from the consolidation, body = the detail + targetLib + a link back to this slice's PR, labels = the chore type label + `<SKIP>`. This is the strict boundary that keeps the slice diff small — generalisation happens in its own reviewed change, never by scope-creeping this slice. List the created ticket ids in the terminal summary and in the Step 5 PR comment. Checkpoint: `EVIDENCE_POSTED`.

Then open the draft PR (Step 5) **without asking**. Open it even when the loop stalled — carry the unresolved blocking findings + judgement-call notes into the PR body / a review comment so they surface on the draft. The **only** things that skip Step 5: no committed diff (nothing to PR), or a gut-check `hard-stop` — in either case stop and tell the user.

## Step 5 — Open the stacked draft PR (automatically)

Stacking is **owned by `<STACK>`**, but it does **not** open the PR — `<PR-SKILL>` does. The split:

- **`<PR-SKILL>`** (repo skill, used **verbatim** — never edit it) opens the PR and owns everything it is good at: the `<TITLE-RULE>` title regex, the conflict check, the Summary body, and writing the test plan onto the tracker issue. It opens against `<BASE>`.
- **`gh stack link`** then adopts that already-open PR into the stack: it retargets the base to the predecessor's branch and records the chain server-side.

No `pr.stackTool` and no `skills.createPr`? Then open the PR with `gh pr create --base <BASE> --draft`, title per `<TITLE-RULE>`, and skip the linking entirely.

The mechanism that makes this work: `gh stack link` **only creates a PR for a branch that has none** — a branch whose PR is already open is linked, not duplicated. So `<PR-SKILL>` opens the PR first and `link` reconciles it. Two rules make it safe: **always link by PR number** (never by branch name — a branch name races the "no PR yet → create one" path if the PR lookup lags), and **never pass `--open`** (it would mark the drafts ready for review).

**0. Scrub worktree artifacts first.** The Playwright rounds clean up after themselves, but guard anyway: an untracked throwaway e2e spec left in `<e2eDir>` makes the repo's pre-push lint hook lint it and fail the push. Run `git status --porcelain` — for each `??` line, remove it (the implementer committed its work, so anything still untracked is review scaffolding, never the shipped change). Then confirm the tree is clean. Do **not** touch tracked/committed files.

**1. Clean up the stale remote branch.** Conductor pushed the pre-rename name. If it still exists on the remote, delete it so only the stack branch remains — and **close any PR that was opened against it**. This matters: two open PRs for one slice make the Step 5.3 PR-number lookup ambiguous and leave a zombie PR in the reviewer's queue.

```bash
old=<conductor-branch-name>
git ls-remote --exit-code --heads origin "$old" >/dev/null 2>&1 && git push origin --delete "$old"
gh pr list --head "$old" --state open --json number --jq '.[].number' | xargs -r -n1 gh pr close
```

**2. Push the branch, run `<PR-SKILL>` (verbatim), then make it a draft.** Push first so it has a remote head: `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`. Then `<PR-SKILL>` runs the conflict check, enforces the title, writes the test plan onto the tracker issue, and opens the PR against `<BASE>`. Let it do all of that — for a downstream slice the base (`<BASE>`) and the whole-stack Summary it computes are both "wrong" right now; step 3 fixes the base. (The Summary bullets stay `<PR-SKILL>`'s. The base retarget makes GitHub show the correct per-slice diff regardless — a downstream body that still reads whole-stack is a known cosmetic, not a correctness, issue.)

`<PR-SKILL>` opens a **ready** PR; this skill ships **drafts** (review happens on the draft PR, not before it). It can't be opened as a draft without editing that skill, so convert it immediately after — capture the number and undo-ready:

```bash
pr=$(gh pr view --json number --jq .number)
gh pr ready "$pr" --undo   # ready -> draft
```

**2b. Publish the media and write the evidence sections into the body** — per `references/pr-evidence.md`. Publish `.context/<slice-id>/evidence/media/` to `<MEDIA-BRANCH>` under `pr/<n>/` from a throwaway worktree (commit `media: PR #<n>`, sha-pinned raw URLs); render `## Verification` from `evidence/verification.jsonl` and `## Visual verification` from `media.json`. Hand both to `<PR-SKILL>` as its verification content where it has a slot, then read the body back: markers present → done; absent → exactly **one** `gh pr edit <n> --body-file` inserting the two blocks after the skill's content and before any trailer, leaving every other byte as written. This is the only body write the suite makes, and it happens before any bot is requested. Internal-only slice → the visual section is its one-line form; user-facing but uncapturable → the one-line reason. Never a row for a command not run, never an image not captured.

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

**4. Post the convention audit + finding ledger as a PR comment.** Use a comment, not `gh pr edit --body` (`<PR-SKILL>` owns the body and the stack tool writes its own navigation section into it — the evidence-sections insert of 5.2b is the one sanctioned body write): `gh pr comment <n> --body` with a `## Convention provenance` section (the provenance table: added file → mirrored exemplar or `[deviation: reason]`), an `## Assumptions` section when Step 1 recorded any (HITL decisions made, a routing label not honoured), a `## Review ledger` section when `report` returned a non-empty ledger (the verdict line verbatim, then the open/deferred/disputed entries with their `CR-NNN` ids, dispute evidence, and adjudication rulings — this is the exact record of what survived review), and, when present, a `## Consolidation follow-ups` section linking the tickets filed in Step 4. This is what the human reviews the convention story against. Checkpoint: `STACK_LINKED`.

That is the whole stack bookkeeping — no hand-maintained `### Stack` block. GitHub holds the parent/child chain and renders the navigation into each PR; later slices' `link` calls extend it.

**After the predecessor merges**, restack the remainder onto the new base. With local tracking present (`gh stack view --json` succeeds), `gh stack sync --remote origin` fetches, rebases and pushes the whole stack; add `--prune` only when no sibling branch is checked out in another Conductor worktree. Without local tracking, rebase the branch by hand — `git fetch origin && git rebase --onto origin/<BASE> <old-predecessor-tip> <branch>` — then `git push --force-with-lease`. Either way this handles the squash-merge case, where the predecessor's commits reappear as duplicates. **Ask the user before force-pushing branches other slices are still working on.**

## Step 6 — Advance the pointer & hand off

The PR is open, so this slice is "ready for PR" — hand off:

**If this slice was the skeleton**, first post a **"Skeleton map" comment on every downstream delta ticket**: the list of files the skeleton created/changed, one line each (`path — what it is / which layer`), taken from the final implement/fix result's `changedFiles` + provenance. This refreshes the deltas' "Where to look" with the feature's *actual* shape — a fresh delta agent mirrors these files, not a guess made before the skeleton existed. (Comments only — never edit sibling ticket bodies.) Idempotent: update an existing `Skeleton map` comment rather than adding a second.

**PRD sync-back.** If implementation deviated from the PRD — a disputed finding upheld, a contract clarified, an AC amended in flight — append one line per deviation to an `## Implementation deltas` section of the **`# PRD` comment on the parent ticket** (add the section if missing; extend it, never overwrite the comment's PRD body, and never touch the ticket description — the same additive rule `/to-prd` follows). This keeps `/to-issues` re-runs and `/compliance-check` reading a truthful spec. No deviations → write nothing.

Then advance the work pointer:

- Find the **next slice in the stack** — the earliest slice in the published stack order whose predecessors all have an open or merged PR. Readiness comes from **PR state, never the tracker's blocked flag**: slices aren't marked Done while the stack is in review, so the blocked relation stays formally unresolved for the whole run. With fan-out, several deltas become ready at once — the pointer marks just the earliest, and you tell the user which siblings are also ready for parallel worktrees.
- **If there is a next slice** → add **`<NEXT>`** to it — `<HITL>`-labelled or not (HITL is a decision the next run makes and records, not a reason to hold the pointer). That is the signal the next `/work-slice` run reads to pick it up. Only ever one slice carries `<NEXT>`.
- **If there is no next slice** → do **not** stamp `<NEXT>`; say the stack is complete.

Name the slice that now carries `<NEXT>` (the next `/work-slice <parent-id>` run stacks it on this branch). Checkpoint: `HANDED_OFF`. Then — unless an orchestrator told you to stop here — go straight into Step 7.

## Step 7 — Babysit the PR (no handoff to the human)

The draft PR is the review surface, and this skill stays with it until it is in order. Run **`/babysit-stack <PR number>`** (`<PR number>` = this slice's PR; babysit accepts explicit PR numbers). It is a babysitting mode, not a pass: it gets CI green, requests `<BOT>` and fixes until that bot is satisfied, then summons `<COMMENT-BOT>` by PR comment and fixes until it is satisfied, resolves every review thread, and **waits for each bot round itself** with bounded polls — all on GitHub, with a fresh fix agent per attempt. It returns only with a terminal verdict:

- **GOAL MET** → checkpoint `COMPLETE` (record the verdict). Report: the PR, the babysit table, the assumptions recorded. Done.
- **NOT MET** → nothing actionable is left: only `needs-human` threads, a stuck bot, or a capped fix signature. Record the verdict in the checkpoint (stage stays `HANDED_OFF`), report the blockers verbatim as the stop reason, and end. Re-running `/work-slice <slice-id>` later re-enters at Step 7 (babysit resumes from its own state file) — the human resolves the blockers on the PR first.

When `/feature-goal` (or another orchestrator) says to stop at Step 6, skip this step: it babysits the whole stack bottom → top itself, which is what makes lower-PR fixes restack correctly.

## Boundaries

- One slice per run. Don't batch slices.
- **Never create a worktree or a new branch.** Operate in the current (e.g. Conductor) worktree; you may **rename** the already-checked-out branch to the stack name and `git reset --hard` it onto its predecessor while it is still empty (Step 2), but never create additional branches or worktrees (no `gh stack add`/`gh stack init` — they create and check out branches), and never rename the Conductor worktree directory. If it isn't a clean worktree, stop and tell the user (Step 2).
- **`<STACK>` owns stacking.** Commits are plain `git commit` on the current branch; the stack is linked server-side at PR time (Step 5.3). Every stack call must be non-interactive (`--json`, `--auto`, explicit args) per the `<STACK>` skill. Never `--prune` a sync while sibling stack branches are checked out in other Conductor worktrees.
- **`<PR-SKILL>` is a repo skill — never edit it.** It opens the PR verbatim (title regex, conflict check, Summary, tracker test plan). Then **`gh stack link` adopts that PR** — retargets the base to the predecessor and records the chain (Step 5.3). **Always link by PR number, never by branch name** (a branch name can take `link`'s create-a-PR path and duplicate the PR skill's), and **never pass `--open`** (it marks the drafts ready). Never `gh stack submit` in this flow — it opens its own auto-titled PRs. Post the convention audit as a comment, not `gh pr edit --body` — the suite's only body write is the single evidence-sections insert of Step 5.2b (`references/pr-evidence.md`).
- Never merge, approve, or mark the PR ready — Step 5 opens it as a **draft** (`<PR-SKILL>` opens ready → `gh pr ready --undo`); promoting to ready is the human's call after review.
- **No human gates.** A `<HITL>` label or routing mismatch is disclosed and recorded (Step 1), never waited on; the PR opens without confirmation (Step 4→5); babysit runs to a terminal verdict (Step 7). The only stops are safety stops — dirty/missing worktree, no committed diff, gut-check hard-stop — and babysit's `needs-human` escalations.
- **The CLI owns the loop.** Reviewer selection, suppression, the relevance gate's thresholds, gate injection, stall/cap stops, dispute adjudication flow, and the verdict all come from `<ENGINE>`'s JSON output — never re-derive them in prose, never hand-edit `.context/<slice-id>/ledger.json` or a findings file, and never skip a command because you "know" what it will say.
- **Fan-out is mechanism-agnostic; subagents are an optional accelerator.** Parallel subagents, `codex exec` children, or inline-sequential all satisfy the same contract: every emitted task's `outputFile` written before `collect`. Losing parallelism is never a licence to drop a reviewer; a dead reviewer (missing/invalid output after one re-run) means degraded coverage stated explicitly, never silent convergence.
- **Model roles are fixed, models are aliases:** writers (implement + every fix pass, including Playwright fixes) and the closeout adjudicator get the strongest model; every read-only reporter — gut-check, roster reviewers, validator, Playwright verifier — runs leaner. Never pin exact model ids or effort levels.
- Reviewers are **read-only** — only the implement/fix agents edit code; **every writer pass is a freshly spawned agent** (implement, gate-fix, each round's fix, adjudicator, Playwright fixes), never a previous pass's agent continued. Handoff is files only.
- **Tests + commit gate:** reviewers never see red or uncommitted code — the CLI turns a red gate into a gate-fix pass mechanically, and implementers must prove green with `testEvidence` (commands + summary lines run in-session), never assert it.
- Playwright runs as a **skill-owned loop, only after the CLI's loop converges**, and only on user-facing slices (max 3 rounds). A broken user story is a **blocking** finding (failed AC), not advisory — with the screenshot kept as proof.
- **One dev server per slice run** — reuse whatever already serves; never start a second instance. All evidence capture passes the secret preflight; a secret in a capture means discard + recapture, never blur/crop/edit.
- **PR evidence is factual.** `## Verification` rows come from `evidence/verification.jsonl` — commands actually run in-session, results from their output; `## Visual verification` shows only captures made in this run — before shots taken at the base in 3.1, after shots in the final Playwright round, published to `<MEDIA-BRANCH>` by sha. A missing before, an uncapturable surface, or a check left to CI is written down, never omitted or faked.
- **`<FIDELITY>` is a repo extension point** — run it only when configured (blocking deviations = failed ACs); with no key, never improvise a design comparison.
- **Routing disclosure:** with `<AGENT:>` configured, a slice labelled for a different agent is still worked when invoked here, with the mismatch stated in the terminal and the PR comment.
- TDD discipline is carried in the implement/fix prompts (red-green per criterion); loop agents don't load the `tdd` skill directly.
- **Checkpoint every stage boundary** (`## Workflow State`, full OIDs). On re-invocation resume from it — but durable markers (branch, ledger, PR state) always win over the checkpoint file.
- Don't apply `labels.agentReady` to anything — this skill speaks `<NEXT>`, never the autonomous-loop trigger.
- Don't modify the parent PRD ticket's description or sibling slices' bodies. The only writes beyond this slice's own ticket: moving the `<NEXT>` pointer, posting/updating the "Skeleton map" comment on downstream deltas, and appending to the `## Implementation deltas` section of the parent's `# PRD` comment (Step 6).
- **Conventions are binding, not advisory:** exemplar mirroring per the slice's Convention contract; every added file carries a provenance row (`mirroredFrom` or a declared `[deviation: reason]`) — silent deviation is a blocking finding; no new helper without a `<SRC>` search.
- **Contract freeze:** a delta never alters the skeleton's published contract (schema/types/API shape). A needed contract change stops the slice and escalates — the stack gets restructured, not quietly edited.
- **Consolidation never widens a slice:** in-slice extraction only within this slice's own new code + at most one existing call site; everything wider becomes a filed follow-up ticket (Step 4), linked from the PR comment (Step 5).
- **No pre-PR confirmation gate.** Once the loop finishes, open the draft PR automatically (Step 4→5); the only skips are "no committed diff" and a gut-check hard-stop. Never promote it to ready or merge — that stays the human's call on the draft.
- **Babysit is part of the slice** (Step 7) unless an orchestrator owns the stack's babysit. Bot reviews happen on GitHub only — never run a review CLI.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow

## Workflow Boundaries

**This skill drives exactly one PRD slice to a stacked draft PR.**

- **DOES**: claim the `<NEXT>` slice (recording HITL decisions as assumptions), rename/base the existing branch, implement test-first, drive the engine-CLI review loop, run the Playwright user-story loop, post QA evidence + consolidation tickets, open the draft PR with `## Verification` + `## Visual verification` in its body, stack-link it, advance `<NEXT>`, then run `/babysit-stack` on its PR to a terminal verdict.
- **DOES NOT**: ask the human anything, create worktrees or branches (Conductor owns them), own CI/bot/thread mechanics (`/babysit-stack` does — this skill only invokes it), re-derive loop decisions (the engine CLI owns rounds, suppression, verdicts), merge or mark ready (the human's call on the draft), batch slices.

## Red Flags — STOP

- About to create a worktree or a new branch — stop: rename/reset the existing checkout only (Step 2); a dirty or missing worktree goes back to the user.
- About to stop for a `<HITL>` label, a "needs a human decision" line, or an `<AGENT:><other-agent>` label — stop stopping: decide + record under `## Assumptions` / disclose the routing mismatch, and proceed.
- About to end the run after Step 6 with no orchestrator having claimed the babysit — stop: Step 7 runs `/babysit-stack <PR>` to its terminal verdict.
- About to wait for a bot review yourself, or run a review CLI — stop: babysit owns the waiting and bot reviews happen on GitHub.
- About to skip an engine command, re-derive its verdict, or hand-edit `.context/<slice-id>/ledger.json` / a findings file — stop: the CLI owns the loop.
- About to re-prompt or continue a previous pass's writer agent (implement, fix, adjudicator, Playwright fix) — stop: spawn a fresh one and hand it the files.
- About to start a second dev server for a Playwright round — stop: reuse the instance already serving; a bound-but-wrong port goes to the user.
- About to add a `## Verification` row for a command you did not run, present an image you did not capture as current, or check out the base / add a worktree to manufacture a before shot — stop: record `not-run` / `Before not captured — <reason>` instead.
- A capture shows a secret shape (`sk-`, `ghp_`, `Bearer `, `?token=`) or real customer data — discard and recapture; never blur/crop/edit.
- About to `gh stack link` by branch name, pass `--open`, or run `gh stack submit` — stop: link by PR number only, never `--open`, never `submit`.
- A delta needs the skeleton's published contract changed — stop and escalate (contract freeze); the stack gets restructured, not quietly edited.

## Verification

Before reporting done:

- [ ] `.context/<slice-id>/workflow-state.md` reads `COMPLETE` (babysit GOAL MET) — or `HANDED_OFF` with the babysit NOT MET reason / the orchestrator's stop-here instruction named — with full OIDs and the loop verdict verbatim.
- [ ] No question was put to the human: HITL decisions and routing mismatches are recorded under `## Assumptions` (ticket comment + PR comment), not waited on.
- [ ] `gh pr view <n> --json baseRefName,isDraft` shows the predecessor's branch (`<BASE>` for the skeleton) and `isDraft: true`.
- [ ] The `## Convention provenance` (+ `## Assumptions`, + `## Review ledger`, + consolidation links) landed as a PR **comment**, not a body edit.
- [ ] The PR body carries `## Verification` (every row backed by `evidence/verification.jsonl`) and `## Visual verification` (scenes published to `<MEDIA-BRANCH>` by sha, or the one-line internal-only / uncapturable form) — inserted with a single body write, before any bot request.
- [ ] User-facing slice: `## QA evidence` comment on the **slice** ticket — one PASS/FAIL row + uploaded screenshot per acceptance criterion; nothing suite-authored was written on the parent ticket (its `## QA handoff` is `/feature-goal`'s).
- [ ] User-facing slice: `evidence/media/` holds the fewest scenes that prove the change (video for behaviour, still for appearance, none duplicated), each listing the criteria it covers in `media.json`, published with the media.
- [ ] Skeleton slice: "Skeleton map" comment posted/updated on every downstream delta ticket.
- [ ] Exactly one slice carries `<NEXT>` — or the report says the stack is complete.
- [ ] `git status --porcelain` is clean — no review scaffolding left to trip the pre-push hook.
