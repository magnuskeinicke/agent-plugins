---
name: work-slice
description: Pick up the slice:next sub-issue from a PRD, implement it test-first inside a bounded review-fix loop, then open a stacked draft PR for later review. Use when the user says "work the next slice", "start the next ticket", "implement slice X", "pick up SER-xxxx", or wants to work through PRD slices created by /to-issues.
---

# Work Slice

Drive **one** slice from a PRD to a stacked **draft PR**. The slices were produced by `/to-issues` as sub-issues of a parent PRD ticket, ordered into a stack. This skill picks the next one up, implements it test-first inside a bounded **targeted review ⇄ fix loop**, and then **opens a stacked draft PR automatically** — no confirmation gate; the draft PR itself is the later review surface. Run it once per slice; the next run stacks on the last.

Read `docs/agents/issue-tracker.md` (how to fetch issues, read blocked-by relations, mark state), `docs/agents/triage-labels.md` (the `slice:next` work pointer vs `agent:ready`), and `docs/agents/repo-config.md` (the repo-specific values — integration branch, dev-server command, e2e dir, browser guide, area→path map — passed to the workflow as `repoConfig`). If the first two are missing, the checkout is broken (they are committed with this skill — see `docs/agents/README.md`); stop and tell the user. If `repo-config.md` is missing, the workflow falls back to its built-in Seranote defaults.

## Step 1 — Select the slice

**Preflight (before you claim anything):** confirm you're in a clean, dedicated worktree per Step 2. If you're not in a git worktree, or it has uncommitted changes, **STOP and tell the user** — do not claim the slice and do not create a worktree yourself.

Input is a parent PRD ticket id, a specific slice id, or nothing.

- **Specific slice id given** → use it.
- **Parent id given (or inferable from context)** → list its sub-issues and pick the slice carrying **`slice:next`** — the single work pointer that `/to-issues` (skeleton) or a previous `/work-slice` run placed on the slice that is up. That is the one to work. **Fallback** if no slice carries `slice:next` (e.g. it was cleared by hand): take the earliest slice in stack order that is **ready** (every predecessor has an open or merged PR — PR state, not Linear's blocked flag; see Step 6) and **not-`needs:human`, not-done, not-in-progress**.
- **Nothing** → ask for the parent id or slice id.

If the chosen slice is **HITL / `needs:human`**, stop and tell the user what decision it needs — don't implement it unattended.

Fetch the chosen slice AND its parent PRD (the PRD lives in the parent's `# PRD` comment — read it from there). Read, verbatim: the slice's **Kind** (skeleton vs delta), **Novel decision**, acceptance criteria, "Where to look" code-layer pointers, the **"Convention contract"** section (binding exemplars + must-use libs), "Design" Figma nodes/tokens, and "Stacked on" predecessor. For a **delta**, also read the ticket's **"Skeleton map" comment** (posted by the skeleton's `/work-slice` run — the actual files the skeleton created; the primary mirror). Read the parent PRD for the wider contract.

**Claim the slice.** Remove its `slice:next` label and set its status to **Dev in progress** (`docs/agents/issue-tracker.md`) so it reads as actively worked and no parallel run grabs it. The pointer only moves on to the next slice after the draft PR is opened (Step 6). When removing/adding `slice:next`, write back the issue's full existing label set minus/plus only that label — never drop `type:*`, `manager:skip`, or any product label (`save_issue.labels` replaces the whole set; see `docs/agents/triage-labels.md`).

## Step 2 — Confirm the worktree & resolve the branch base

**This skill does NOT create a worktree or branch.** It trusts that one is already set up — e.g. the Conductor session's worktree — so the work lands in the same checkout you're watching. (Conductor's `setup` script runs `init-worktree.sh`, so a Conductor workspace is already bootstrapped: env config, Docker stack, migrations, seed.)

**Confirm the working tree** (this is the Step 1 preflight — do it before the claim):

- It is inside a git worktree — `git rev-parse --is-inside-work-tree` returns `true`.
- It is clean — `git status --porcelain` is empty (no uncommitted changes).
- If either fails — **not in a worktree, or there are pending changes** — **STOP and tell the user.** Ask them to open the slice's dedicated worktree (let Conductor create + bootstrap it), or to commit/stash pending work first. **Never create a worktree or switch branches yourself.**

**Confirm the stacking tool.** Stacking is driven by **`gh stack`** (the `github/gh-stack` CLI extension) — Aviator (`av`) is decommissioned and must not be used. Load the **`gh-stack`** skill before any `gh stack` command; every invocation must be non-interactive (`--json`, `--auto`, explicit branch args) or it hangs. Two one-time git settings keep it prompt-free:

```bash
gh extension list | grep -q gh-stack || gh extension install github/gh-stack
git config rerere.enabled true
git config remote.pushDefault origin
```

`gh stack` keeps **no local tracking state until PRs exist** in this flow — the branch is plain git here, and Step 5 links it into the GitHub stack after `create-pr` opens the PR. That is deliberate: it makes the flow safe across Conductor's one-worktree-per-slice layout, where the predecessor's branch is checked out in a *different* worktree and cannot be checked out here.

The slice's branch is **whatever Conductor checked out** (a `start-work` slug like `ser-1234-…`, or a Conductor-generated name) — you will **rename it in place** to the stack branch name below. `git branch -m` only renames the branch already checked out; it does not create a branch or a worktree. Before renaming, sanity-check you're in the slice's intended worktree (HEAD should be fresh off the base, not carrying another slice's commits).

**Resolve the base branch and the stack position** — base feeds the reviewers' `git diff <base>...HEAD` and the stacked PR; the position gives the branch its number:

- **Skeleton slice** (first in the stack) → base = the repo's integration branch — `repoConfig.integrationBranch` from `docs/agents/repo-config.md`, `development` in this repo (every later mention of `development` in this skill means that branch); stack position **`01`**.
- **Downstream slice** → base = the **predecessor slice's stack branch** (the blocked-by ticket — the skeleton for fanned-out deltas, the chained predecessor otherwise) — the renamed `<project-slug>/NN-ser-xxxx` branch a previous `/work-slice` run created. Find it on the remote by the predecessor's Linear id: `git ls-remote --heads origin '<project-slug>/*'` (match `*-ser-<predecessor-n>`), or read the predecessor's open PR head with `gh pr list --state open --json number,headRefName,baseRefName`. This slice's position `NN` is its **index in the PRD's published stack order** (the `/to-issues` numbering) — NOT predecessor+1: with fan-out, several deltas share the skeleton as predecessor, and only the stack-order index stays unique. If the predecessor has already merged, base off `development` instead and note it.

### Rename the branch to the stack name

Derive `<project-slug>` once per stack: kebab-case the parent PRD's **Linear project name** (e.g. project "Summary feature" → `summary-feature`). If the PRD has no Linear project, fall back to a kebab-case of the parent PRD ticket's short title. The branch name is `<project-slug>/<NN>-<ser-id>` — the project-slug namespace prefix, the zero-padded stack number, then this slice's Linear id lower-cased: `summary-feature/01-ser-1234` for the skeleton, `summary-feature/02-ser-1290` for the next in stack order, and so on. The `<project-slug>` segment is the shared namespace prefix that groups the stack's branches under one name (and lets you list them with `git ls-remote --heads origin '<project-slug>/*'`); `NN` keeps the stack readable in order; `ser-xxxx` ties each branch to its ticket. Rename in place:

```bash
git branch -m "$(git rev-parse --abbrev-ref HEAD)" summary-feature/01-ser-1234
```

The rename is the **only** branch mutation — no new branch, no worktree change. **Leave the Conductor worktree directory name as-is** — renaming the dir breaks the path-keyed docker stack (`vtt-<root>-*`), Conductor's workspace tracking, and the running dev server. Conductor may have already pushed the pre-rename name; the stale remote branch is cleaned up at push time (Step 5).

### Base the branch on its predecessor

Conductor branches the worktree off `development`, not off the predecessor — so a downstream slice must be **moved onto** its predecessor before any code is written, or the diff and the PR both show the predecessor's commits as this slice's.

- **Skeleton slice** → nothing to do; it is already based on `development`.
- **Downstream slice** → the renamed branch is still **empty** (zero commits ahead of `development`), so re-point it at the predecessor rather than rebasing history:

  ```bash
  git fetch origin <predecessor-stack-branch>
  git rev-list --count development..HEAD          # MUST print 0 — otherwise STOP
  git reset --hard "origin/<predecessor-stack-branch>"
  ```

  The count check is the guard: if the branch already carries commits you are not in a virgin slice worktree — **STOP and tell the user** rather than discarding work.
- **Predecessor already merged** → stay on `development` and note it; this slice starts a fresh stack.

Verify with `git log --oneline -1` that HEAD is the predecessor's tip. From here every commit in Step 3 is a plain `git commit` on this branch, and Step 5 links the branch's PR into the GitHub stack.

## Step 3 — Implement + targeted review loop (Workflow)

**Precondition:** Step 2 must have already renamed the branch to its stack name and, for a downstream slice, based it on the predecessor (`git log --oneline -1` shows the predecessor's tip). The workflow's agents commit with plain `git commit` on the current branch — if the base is wrong, every review round reviews the wrong diff.

This step runs as a **single `Workflow` call** — invoking it here is the sanctioned opt-in. The workflow is the orchestrator: it implements the slice, detects what changed, fans out **only the relevant reviewers in parallel**, aggregates their structured summaries into a finding ledger, and loops fix ⇄ review until the ledger converges or stalls (hard cap 5 as a safety boundary). Once that code-review loop converges it runs a **separate Playwright user-story loop** (verify ⇄ fix, its own smaller cap) on user-facing slices. The main session invokes the workflow, waits, and reads back the returned summary for the Step 4 result presentation. **Do not implement or review in the main session** — the workflow owns it.

`scriptPath` must be an **absolute** path into this plugin's install root — the
script ships with the plugin, not with the host repo, so a repo-relative path
resolves to nothing. Resolve it first: use `$CLAUDE_PLUGIN_ROOT/skills/work-slice/work-slice-loop.workflow.js`
when that variable is set, otherwise
`ls -d "$HOME"/.claude/plugins/cache/*/magnus/*/skills/work-slice/work-slice-loop.workflow.js | sort -V | tail -1`.
Below, `<PLUGIN_ROOT>` stands for the resolved root — substitute the real path.

```
Workflow({
  scriptPath: "<PLUGIN_ROOT>/skills/work-slice/work-slice-loop.workflow.js",
  args: {
    sliceId,             // e.g. "SER-1234"
    sliceKind,           // "skeleton" | "delta" — the ticket's Kind section (defaults to delta)
    acceptanceCriteria,  // verbatim, array or string
    whereToLook,         // the slice's "Where to look" pointers — for a delta, prepend the
                         // "Skeleton map" comment's file list (the primary mirror)
    conventionContract,  // the slice's "Convention contract" section, verbatim (binding
                         // exemplars per layer + must-use libs)
    figma,               // Figma node deep-links + recorded tokens (UI slices)
    baseBranch,          // resolved in Step 2 (predecessor stack branch, or `development`)
    prdContract,         // the parent PRD's wider contract
    repoConfig           // the JSON block from docs/agents/repo-config.md (integration branch,
                         // dev-server command, e2e dir, browser-guide path, area→path map, goldenPaths,
                         // libMap). Omit if the file is missing — the workflow falls back to built-in defaults.
  }
})
```

The script body encodes everything below (registry, model pinning, the loop, the schemas) — the sections that follow document its behaviour. To tune the workflow, edit `work-slice-loop.workflow.js` and re-run with the same `scriptPath`.

### Model roles (aliases, never exact pins)

Models are role-based and use aliases (`opus` / `sonnet`) so they track the latest model tier — never pin exact model ids or effort levels:

- **Implementers write, so they get the strongest model:** implement + every fix round (code-review and Playwright) → `opus`. The **closeout adjudicator** also runs `opus` — it overrules reviewers and implementers, so it gets the strongest judgement.
- **Reviewers report, so they run leaner:** the gut-check pre-pass, baseline + lane + reuse + scope reviewers, the relevance validator, AND the read-only Playwright verifier → `sonnet` (browser-driving transcripts are token-heavy; the Playwright *fix* passes stay `opus`).

### Reviewer registry — area → anchor skill → trigger paths

The workflow detects **areas** by matching the changed files against the trigger column, then **consolidates the triggered areas into two composite review lanes** so a round runs at most **baseline + 2 lane reviewers + reuse + scope**: **web** = frontend + i18n + performance, **server** = backend + database + security. A lane reviewer's prompt merges only its *triggered* member areas' skills + focus — same coverage, fewer agents, less finding churn. Defensive enrichment: a triggered `frontend` area always pulls the `performance` lens into the web lane, and a triggered `backend` area always pulls `security` into the server lane (those two rarely trigger by path alone). **Baseline always runs.** The **reuse reviewer** is its own agent, gated not on paths but on the diff **adding or modifying files** (the implementer reports `changedFiles`/`addedFiles`; modified files are in scope for intra-diff DRY + YAGNI): it hunts duplicates of existing lib/design-system code (blocking) and verifies the implementer's **provenance table** — every added file must cite the exemplar it mirrors or declare a `[deviation: reason]`; missing or false rows block. Generalizable-new-code goes into `consolidations` (never blocking — Step 4 files it as follow-up tickets). The **scope-fidelity reviewer** is another gated agent — it runs when the diff adds new files or >~150 inserted lines: a loose finder lists everything in the diff not traceable to the slice's acceptance criteria (full recall, no threshold), then a strict justifier keeps a finding only by citing a specific AC, a documented repo rule, or a concrete failure path the extra code prevents ("peer code does it too" alone is a note, never blocking). Necessity comes from the ticket's frozen AC as written — never inferred from the diff. The **CodeRabbit reviewer** is one more agent in the round — a read-only wrapper that runs the CodeRabbit CLI (`coderabbit review --agent`), verifies its findings against the code, and reports bugs/security/leak risks as blocking, nits as notes; it runs **once per workflow run, in the first reviewer round only** (rate-limited external service) — fix rounds re-run only our own lanes. The **gut-check pre-pass** (the `gut-check` skill) also runs once per run, opening the first reviewer round *before* the lanes: a rubric-free first read whose `route`d observations enter the ledger and whose `block` (work outside the ticket's requirements) hard-stops the run for the human. Playwright is a per-slice judgement call (below). The trigger paths below are the built-in defaults — `repoConfig.areaPaths` from `docs/agents/repo-config.md` overrides them per repo, and the registry itself lives once in the host repo's `.claude/skills/_shared/reviewer-registry.js` (synced into the workflow scripts by the plugin's `shared/sync.sh --host <repo>`). The table is a snapshot for orientation — on any mismatch, the registry is authoritative.

| Area (lane) | Anchor skill(s) | Fires when the diff touches |
|---|---|---|
| **Baseline** (always, own agent) | `CLAUDE.md` conventions + the slice acceptance criteria | every run — correctness, missed AC, convention/reuse, test quality |
| **Reuse** (own agent, gated on added/modified files) | `CLAUDE.md` conventions + `repoConfig.libMap` | the diff ADDS or MODIFIES files — duplicate-of-lib (blocking), provenance audit (blocking), intra-diff DRY/YAGNI, generalizable-code → `consolidations` (follow-up tickets, never blocking) |
| **Scope fidelity** (own agent, gated on size) | the slice's frozen acceptance criteria | the diff adds new files or >~150 inserted lines — loose finder (everything not traceable to AC) + strict justifier (survives only via a cited AC / repo rule / concrete failure path) |
| Frontend / UI (`web`) | `frontend-implementation`, `tailwind-predefined-values`, `web-design-guidelines`, `figma-implement-design` | `libs/ui/web/**`, `apps/seranote-web/**/*.tsx`, `*.stories.tsx` |
| Backend (`server`) | `backend-action-service-split` | `libs/backend/**` (dal / service / action) |
| Database (`server`) | `CLAUDE.md` DB conventions (`createBaseRepo`, Drizzle schema/relations/migrations) | `drizzle/**`, `libs/backend/db/**/schemas/**`, `**/relations/**`, `drizzle.config.ts` |
| i18n / translations (`web`) | `i18n` | `apps/seranote-web/src/i18n/**`, `libs/shared/util/translations/**`, added/changed `t(` / `useTranslations(` / `getTranslations(` |
| Security (`server`) | `security-review` | server actions, auth, secrets/env, authz, input/upload handling — plus always when `backend` triggers |
| Performance (React/Next) (`web`) | `vercel-react-best-practices` | declared by the implementer — plus always when `frontend` triggers |

The `performance` area is the **client/React lens only**. Server-side performance — N+1 query patterns, sequential awaits where `Promise.all` fits, over-fetching, missing indexes, join cost — is baked directly into the **backend** and **database** focus definitions, where the queries live. No extra agent; the server lane always carries it.

A reviewer is told to apply its anchor skill's rules against the slice's diff and report **correctness / missed-AC / convention-reuse** problems — not style nits. Reviewers are **read-only**; they only report.

### Playwright user-story loop (after the code-review loop converges)

Playwright is **not** part of the per-round code review — it runs as its own loop **after** that loop converges, and only when the change warrants it. Whether to run it is the orchestrator's judgement per slice — **lean toward running it.** Skip only when the slice clearly has no user-facing impact (pure refactor, internal util, a migration with no behaviour change). A backend-only diff can still change user-facing behaviour — when in doubt, run it. (The workflow gates this on the implement/fix agent's `userFacingImpact` flag, which biases to `true`.)

It mirrors the repo's existing browser-verification mechanism — **read `.claude/skills/dev-loop/browser-guide.md` first** for login steps, seeded users, routes, the core SOAP flow, selectors, and the microphone fake-media flags. (The guide path, dev-server command, and e2e dir below are the built-in defaults; `repo-config.md` overrides them.) Each round it must:

1. Reuse a still-running dev server from a prior round when one serves; otherwise start the app in the background and capture its URL: `DEV_LOGIN_ENABLED_SERVER=true pnpm nx portless seranote-web` (wait until it serves).
2. Restore the parked spec from a prior round (`<e2eDir>/test-output/slice-verify.spec.ts.parked`, gitignored) when it exists; otherwise author a throwaway Playwright spec (reuse `apps/seranote-web-e2e/` config + the `login.spec.ts` dev-login pattern) driving **isolated headless Chromium** with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, `video: 'on'`, `baseURL` = the running app.
3. Dev-login as the seeded user matching the slice, then **exercise this slice's acceptance-criteria user stories**, capturing a screenshot for **every** criterion — PASS and FAIL alike, named `ac-<n>-<pass|fail>.png` — plus the run video. These are **QA evidence**: Step 4 uploads them to the slice ticket, so each screenshot must actually show the behaviour it proves (or the breakage).
4. **Clean up before returning:** nothing untracked may remain in a source dir — an untracked spec fails the pre-push `nx affected -t lint` hook at PR time and would be swept into the next fix commit by `git add -A`. On a passing or final round, delete the throwaway spec (and any parked copy); on a failing non-final round, park it in the gitignored test-output dir for the next round to reuse. Only the gitignored screenshots/video (and a parked spec) stay.
5. Return a PASS/FAIL per criterion with the proving screenshot. **A broken user story = a failed acceptance criterion = a blocking finding** that triggers a fix round; keep the screenshot as proof. The workflow returns the last round's per-criterion verdicts as `playwrightCriteria`.

### The loop (inside the workflow)

1. **Implement** — one Opus agent, TDD discipline (one test → impl per acceptance criterion — never all-tests-then-all-impl). Use the "Where to look" pointers as the starting map. **Mirroring is binding**: a skeleton clones the exemplar's shape (it makes every cross-layer decision the deltas inherit); a delta mirrors the skeleton first, appends rather than modifies, never alters the skeleton's contract (contract freeze — a needed contract change is a stop-and-escalate, not an edit), and introduces at most the ticket's one named novel decision. No new helper without a `libs/**` search; consolidation is in-scope only within the slice's own new code + at most one existing call site. The agent returns a **provenance table** (added file → `mirroredFrom` exemplar, or `[deviation: reason]` — silent deviation forbidden). For UI: fetch the Figma screenshot fresh via the Figma MCP from the slice's node deep-link and reuse design-system tokens/components, not magic numbers. Stay inside this slice's scope — if you discover it needs something a later slice owns, note it, don't pull future work forward. Commit. → GREEN slice.
2. **Code-review loop**, starting from the GREEN slice — **baseline + area reviewers only, no Playwright**. Its lifecycle runs on a **finding ledger**: every validated finding gets a stable `CR-NNN` id (monotonic, never recycled), a fingerprint (reviewer lane + file + root cause — never line numbers, lines shift across fix commits), and a status `open | addressed | deferred | disputed | dropped`. `addressed` records the fix commit hash; the final ledger goes onto the PR so the human sees exactly what survived. The first reviewer round opens with a **gut-check pre-pass** (once per run, before any lane — the `gut-check` skill's rubric-free first read): `route`d observations enter the round's findings and the ledger like any reviewer's, `reject`ed ones die, and a `block` — work outside the ticket's requirements — hard-stops the loop for the human before any reviewer spend.
   0. **Tests + commit gate** — reviewers never see red or uncommitted code (they inspect `git diff <base>...HEAD`). If the latest implement/fix pass reports `testsGreen=false` or `committed=false`, the round is spent on a dedicated fix pass instead of reviewers. Every implement/fix agent must set `testsGreen=true` only after actually running tests + lint/typecheck in-session and must return the commands + summary lines as `testEvidence`, plus its post-commit `head` sha — the `verify-before-done` iron law applied in-loop: no completion claim without fresh in-session evidence. A previously-failing gate clearing counts as material progress.
   1. **Detect changed areas** — `git diff --name-only <base>...HEAD`, match each path against the registry trigger column, then group the triggered areas into the **web/server lanes** → the active reviewer set (baseline always; at most baseline + 2 lanes; plus the **reuse reviewer** whenever the diff adds or modifies files; plus the **scope-fidelity reviewer** when the diff adds new files or >~150 inserted lines; plus the **CodeRabbit reviewer** in the first reviewer round only).
   2. **Review** — spawn the selected reviewers **in parallel** (each Sonnet, fresh), each returning a structured summary `{ area, blockingFindings[], notes[] }` (each finding carries a `rootCause` slug for its cross-round identity). From round 2 on, every reviewer receives the **ledger** (ids + statuses): verify `addressed` fixes (a re-raise reopens the same id), never re-raise `disputed`/`deferred` items — such re-raises are **auto-suppressed** by fingerprint before they reach anyone — and report only NEW problems introduced by the fix diff.
   3. **Validate (relevance + confidence gate)** — one Sonnet validator receives the surviving raw findings + the diff and classifies each: (a) caused by this diff or pre-existing/out-of-scope, (b) confidence 0–100 that it is real and correctly located. It classifies only — it may NOT add findings. Confidence ≥80 AND diff-caused → eligible for the fix pass. 60–79, or ≥80-but-pre-existing → demoted to **advisory** (a PR note; pre-existing ones become `consolidations` follow-ups) — never fixed in-slice. <60 → **dropped as UNVERIFIED**, recorded in the ledger so a repeat is visible.
   4. **Aggregate (deterministic) + stop conditions, first hit wins.** The ledger is scored each round (open blocking = 4, suggestion = 1, advisory = 0.25; deferred/disputed/dropped = 0); a round makes **material progress** only if the score drops ≥1, an open blocking finding dies, or a failing test gate clears. Then: (1) zero open blocking findings AND every reviewer lane reported (a round with dead reviewers never converges) → **converged**, go to the Playwright loop; (2) two consecutive rounds without material progress → **stalled**, stop; (3) a fingerprint that survives 2 fix attempts → marked `deferred`, no longer targeted; (4) hard cap at 5 rounds — a safety boundary, not a target. Otherwise → fix.
   5. **Fix** — hand the open blocking findings (by `CR-NNN` id) to a single fresh Opus agent to resolve test-first (RED→GREEN where behaviour changes). The fixer may **dispute** a finding instead of fixing it — only with concrete evidence (file:line, test output, spec text); everything else must be resolved and is marked `addressed` with the fix commit hash. Commit. The next round re-runs the triggered lanes + baseline with the **fix's commit range as their primary diff** (the full slice diff stays available as context). The reuse reviewer is skipped when the added-file set + provenance are unchanged since its last clean pass. Return to step 1 with fresh reviewers.
   6. **Closeout adjudication** — if the loop ends with `disputed` entries, ONE fresh Opus adjudicator rules each on **evidence only**: it sees the final diff, the reviewer's original evidence, and the implementer's dispute evidence — never the fix agent's free-text justifications. `upheld` reopens the finding as `open` (reported in the stalled verdict); `dismissed` closes it. Adjudicator/reviewer deadlock is never re-looped — the disagreement is reported on the PR for the human.
   - **On stop without convergence** the verdict is explicit — `stalled — shipped with N open findings (CR-…)` — never a silently exhausted cap. The main session still opens the draft PR (Step 4→5) and carries the open findings into it. Pure judgement-call / debatable findings never block; they ride back as notes.
3. **Playwright user-story loop, max 3 rounds** — runs **only after the code-review loop converged AND the slice is user-facing** (the case-by-case judgement above; skip pure refactors / internal utils / no-behaviour-change migrations):
   1. **Verify** — one fresh Sonnet Playwright reviewer drives the running app and returns PASS/FAIL per acceptance-criterion user story with proving screenshots. It cleans up (or parks, on a failing non-final round) its throwaway spec before returning — only gitignored files remain.
   2. **Aggregate.** No broken user stories → the Playwright loop **converges**; done. Otherwise → fix.
   3. **Fix** — hand the broken user stories (each a failed AC = blocking) to a single fresh Opus agent to resolve test-first. Commit. Re-verify with a fresh Playwright reviewer.
   - **Cap at 3 rounds.** If round 3 still has broken user stories, **stop** and return them as outstanding — escalate to the human.
4. Before returning, run the slice's tests + lint/typecheck green (`pnpm nx`).

The workflow **returns** to the main session: the **verdict** (`converged`, or `stalled — shipped with N open findings (CR-…)`), the **finding ledger** (`ledger` + preformatted `ledgerText`: open/deferred/disputed entries with dispute evidence and adjudication rulings), the debt score, code-review rounds + Playwright rounds used, any outstanding blocking findings, the carried notes, the final **provenance table**, the **consolidations** list (reuse follow-up candidates + relevance-gate demotions), the diff stat, and the Playwright proof paths. That summary feeds Step 4.

## Step 4 — Present the result, then proceed

**No confirmation gate — the draft PR is the review surface, so proceed straight to Step 5.** First print, from the workflow's returned summary (so the terminal has the record):

- The slice id + one-line summary of what was built.
- The diff stat (and how to see the full diff).
- Acceptance criteria, each ticked or flagged (Playwright proof screenshots where it verified them).
- The loop outcome: the **verdict verbatim** (`converged`, or `stalled — shipped with N open findings (CR-…)`), which reviewers ran, how many code-review rounds it took, whether the Playwright loop ran and converged (or how many of its 3 rounds it used) — plus the **ledger** (`ledgerText`): open / deferred / disputed entries with their `CR-NNN` ids.
- Any judgement-call findings — `[advisory:…]` notes the relevance gate demoted, and `[disputed:…]` entries with their adjudication rulings (an upheld dispute is back open; a deadlock is yours to adjudicate on the PR).
- The **provenance table** (added file → mirrored exemplar or declared deviation) — the convention audit trail.
- Any **consolidations** the reuse reviewer surfaced, and any **ratchet candidates**: a convention finding that showed up in 2+ rounds (or that you recognise from earlier slices) is a candidate for a lint rule / Nx module-boundary tag — name it so the human can move it from review into the tests gate.
- The branch + its base (the stack position).

**QA evidence → Linear (when the Playwright loop ran):** the workflow returns `playwrightCriteria` (per-AC PASS/FAIL + screenshot path) and `playwrightProof` (screenshots + video). Upload the proof files to the **slice ticket** via the Linear MCP attachment flow (`prepare_attachment_upload` → PUT the file to the returned URL → `create_attachment_from_upload`), then post/update a ticket comment starting with `## QA evidence`: one row per acceptance criterion — PASS/FAIL + link to its uploaded screenshot (video linked at the bottom). Failed criteria stay in the table marked FAIL so QA sees exactly what broke. Idempotent: update an existing `## QA evidence` comment rather than adding a second.

**Consolidation follow-ups → Linear (when the workflow returned `consolidations`):** file each as its own ticket on the team (same create flow as `docs/agents/issue-tracker.md`): title from the consolidation, body = the detail + targetLib + a link back to this slice's PR, labels `type:chore` + `manager:skip`. This is the strict boundary that keeps the slice diff small — generalisation happens in its own reviewed change, never by scope-creeping this slice. List the created ticket ids in the terminal summary and in the Step 5 PR comment.

Then open the draft PR (Step 5) **without asking**. Open it even when a loop hit its cap — carry the unresolved blocking findings + judgement-call notes into the PR body / a review comment so they surface on the draft. The **only** thing that skips Step 5 is the implement agent having produced no committed diff (nothing to PR) — in that case stop and tell the user.

## Step 5 — Open the stacked draft PR (automatically)

Stacking is **owned by `gh stack`**, but it does **not** open the PR — `create-pr` does. The split:

- **`create-pr`** (repo skill, used **verbatim** — never edit it) opens the PR and owns everything it is good at: the `<type>[(scope)]: SER-XX <subject>` title regex, the conflict check, the Summary body, and **writing the test plan onto the Linear issue**. It opens against `development`.
- **`gh stack link`** then adopts that already-open PR into the GitHub stack: it retargets the base to the predecessor's branch and records the chain server-side.

The mechanism that makes this work: `gh stack link` **only creates a PR for a branch that has none** — a branch whose PR is already open is linked, not duplicated. So `create-pr` opens the PR first and `link` reconciles it, which is exactly the split the old `av sync` step had. Two rules make it safe: **always link by PR number** (never by branch name — a branch name races the "no PR yet → create one" path if the PR lookup lags), and **never pass `--open`** (it would mark the drafts ready for review).

**0. Scrub worktree artifacts first.** The Playwright reviewer cleans up after itself, but guard anyway: an untracked throwaway e2e spec (e.g. `apps/seranote-web-e2e/e2e/*.spec.ts`) left in the worktree makes the pre-push `nx affected -t lint` hook lint it and fail the push. Run `git status --porcelain` — for each `??` line, remove it (the implementer committed its work, so anything still untracked is review scaffolding, never the shipped change). Then confirm the tree is clean. Do **not** touch tracked/committed files.

**1. Clean up the stale remote branch.** Conductor pushed the pre-rename name. If it still exists on the remote, delete it so only the stack branch remains — and **close any PR that was opened against it**. This matters: two open PRs for one slice make the Step 5.3 PR-number lookup ambiguous and leave a zombie PR in the reviewer's queue.

```bash
old=<conductor-branch-name>
git ls-remote --exit-code --heads origin "$old" >/dev/null 2>&1 && git push origin --delete "$old"
gh pr list --head "$old" --state open --json number --jq '.[].number' | xargs -r -n1 gh pr close
```

**2. Push the branch, run `create-pr` (verbatim), then make it a draft.** Push first so `create-pr` has a remote head: `git push -u origin "$(git rev-parse --abbrev-ref HEAD)"`. Then `create-pr` runs the conflict check, enforces the title, writes the test plan onto the Linear issue, and opens the PR against `development`. Let it do all of that — for a downstream slice the base (`development`) and the whole-stack Summary it computes are both "wrong" right now; step 3 fixes the base. (The Summary bullets stay create-pr's. The base retarget makes GitHub show the correct per-slice diff regardless — a downstream body that still reads whole-stack is a known cosmetic, not a correctness, issue.)

`create-pr` opens a **ready** PR; this skill ships **drafts** (review happens on the draft PR, not before it). It can't be opened as a draft without editing `create-pr`, so convert it immediately after — capture the number and undo-ready:

```bash
pr=$(gh pr view --json number --jq .number)
gh pr ready "$pr" --undo   # ready -> draft
```

**3. Link the PR into the GitHub stack.** Load the `gh-stack` skill first. Which form to use depends on what already exists — resolve it from `gh stack view --json` (run it while checked out on the branch; a `not part of a stack` error just means "no stack yet"), or list the predecessor's PR number with `gh pr list --state open --search "SER-<predecessor-n>" --json number,headRefName`:

- **Skeleton slice** → **nothing to link yet.** A stack needs ≥2 PRs; the skeleton's PR simply stays based on `development`. It becomes the bottom of the stack when the next slice links onto it.
- **Second and later slices** → re-list the **whole stack, bottom → top, by PR number**:
  ```bash
  gh stack link --base development <pr-slice-01> <pr-slice-02> … <this-pr>
  ```
  Re-listing is correct and idempotent: "if some of the PRs are already in a stack, the existing stack is updated to include the new PRs (existing PRs are never removed)". There is a stack-number shortcut (`gh stack link <stack-number> <this-pr>`) but **no CLI command lists stack numbers**, so re-listing the PRs is the form that always works from a cold session. Get the list with `gh pr list --state open --search "<project-slug>" --json number,headRefName` and order it by the `NN` in each head branch.
- **Predecessor already merged** → don't link; the base correctly stays `development` and this slice starts a fresh stack.

Then verify: `gh pr view <n> --json baseRefName,isDraft` must show the **predecessor's branch** and `true`. If `isDraft` came back `false`, `--open` leaked in — re-run `gh pr ready <n> --undo`.

**4. Post the convention audit + finding ledger as a PR comment.** Use a comment, not `gh pr edit --body` (create-pr owns the body and `gh stack` writes its own navigation section into it): `gh pr comment <n> --body` with a `## Convention provenance` section (the provenance table: added file → mirrored exemplar or `[deviation: reason]`), a `## Review ledger` section when the workflow returned a non-empty `ledgerText` (the verdict line verbatim, then the open/deferred/disputed entries with their `CR-NNN` ids, dispute evidence, and adjudication rulings — this is the exact record of what survived review), and, when present, a `## Consolidation follow-ups` section linking the tickets filed in Step 4. This is what the human reviews the convention story against.

That is the whole stack bookkeeping — no hand-maintained `### Stack` block. GitHub holds the parent/child chain and renders the navigation into each PR; later slices' `link` calls extend it.

**After the predecessor merges**, restack the remainder onto the new base. With local tracking present (`gh stack view --json` succeeds), `gh stack sync --remote origin` fetches, rebases and pushes the whole stack; add `--prune` only when no sibling branch is checked out in another Conductor worktree. Without local tracking, rebase the branch by hand — `git fetch origin && git rebase --onto origin/development <old-predecessor-tip> <branch>` — then `git push --force-with-lease`. Either way this handles the squash-merge case, where the predecessor's commits reappear as duplicates. **Ask the user before force-pushing branches other slices are still working on.**

## Step 6 — Advance the pointer & hand off

The PR is open, so this slice is "ready for PR" — hand off:

**If this slice was the skeleton**, first post a **"Skeleton map" comment on every downstream delta ticket**: the list of files the skeleton created/changed, one line each (`path — what it is / which layer`), taken from the workflow's `changedFiles` + provenance. This refreshes the deltas' "Where to look" with the feature's *actual* shape — a fresh delta agent mirrors these files, not a guess made before the skeleton existed. (Comments only — never edit sibling ticket bodies.) Idempotent: update an existing `Skeleton map` comment rather than adding a second.

**PRD sync-back.** If implementation deviated from the PRD — a disputed finding upheld, a contract clarified, an AC amended in flight — append one line per deviation to an `## Implementation deltas` section of the **`# PRD` comment on the parent ticket** (add the section if missing; extend it, never overwrite the comment's PRD body, and never touch the ticket description — the same additive rule `/to-prd` follows). This keeps `/to-issues` re-runs and `/compliance-check` reading a truthful spec. No deviations → write nothing.

Then advance the work pointer:

- Find the **next slice in the stack** — the earliest slice in the published stack order whose predecessors all have an open or merged PR. Readiness comes from **PR state, never Linear's blocked flag**: slices aren't marked Done while the stack is in review, so `blockedBy` stays formally unresolved for the whole run. With fan-out, several deltas become ready at once — the pointer marks just the earliest, and you tell the user which siblings are also ready for parallel worktrees.
- **If it is AFK** (not `needs:human`) → add **`slice:next`** to it. That is the signal the next `/work-slice` run (or, later, an autonomous loop) reads to pick it up. Only ever one slice carries `slice:next`.
- **If it is HITL / `needs:human`, or there is no next slice** → do **not** stamp `slice:next`. Tell the user the stack needs a human decision next (name the slice), or that the stack is complete.

Then tell the user this slice is up for review and that the next `/work-slice <parent-id>` run will pick up whatever now carries `slice:next` and stack it on this branch. Name that slice.

## Boundaries

- One slice per run. Don't batch slices.
- **Never create a worktree or a new branch.** Operate in the current (e.g. Conductor) worktree; you may **rename** the already-checked-out branch to the stack name and `git reset --hard` it onto its predecessor while it is still empty (Step 2), but never create additional branches or worktrees (no `gh stack add`/`gh stack init` — they create and check out branches), and never rename the Conductor worktree directory. If it isn't a clean worktree, stop and tell the user (Step 2).
- **`gh stack` owns stacking; `av` is decommissioned — never run an `av` command.** Commits are plain `git commit` on the current branch; the stack is linked server-side at PR time (Step 5.3). Every `gh stack` call must be non-interactive (`--json`, `--auto`, explicit args) per the `gh-stack` skill. Never `--prune` a sync while sibling stack branches are checked out in other Conductor worktrees.
- **`create-pr` is a repo skill — never edit it.** It opens the PR verbatim (title regex, conflict check, Summary, Linear test plan). Then **`gh stack link` adopts that PR** — retargets the base to the predecessor and records the chain (Step 5.3). **Always link by PR number, never by branch name** (a branch name can take `link`'s create-a-PR path and duplicate create-pr's), and **never pass `--open`** (it marks the drafts ready). Never `gh stack submit` in this flow — it opens its own auto-titled PRs. Post the convention audit as a comment, not `gh pr edit --body`.
- Never merge, approve, or mark the PR ready — Step 5 opens it as a **draft** (create-pr opens ready → `gh pr ready --undo`); promoting to ready is the human's call after review.
- Never implement a needs-human/HITL slice unattended (Step 1).
- **Model roles are fixed, models are aliases:** implementers (implement + every fix round, including Playwright fixes) and the closeout adjudicator are **Opus**; every read-only reviewer — the gut-check pre-pass + baseline + lanes + reuse + scope + the relevance validator + the CodeRabbit wrapper + the Playwright verifier — is **Sonnet**. Never pin exact model ids or effort levels. Not the orchestrator's discretion.
- Reviewers are **read-only** — only the implement/fix agent edits code (Step 3).
- Reviewers run **in parallel**; the workflow aggregates their structured summaries and decides fix vs done vs escalate deterministically.
- **Re-review is focused:** after a code-review fix, reviewers get the fix's commit range as their primary diff (full slice diff as context only), and the reuse reviewer skips when nothing it audits changed since its last clean pass. The always-on baseline is the net against a fix regressing an already-passed area. Playwright is no longer part of the per-round review — it's the dedicated post-convergence loop below.
- **Reviews have memory — the finding ledger:** stable `CR-NNN` ids, fingerprints (lane + file + root cause, never line numbers), statuses `open|addressed|deferred|disputed|dropped`. Reviewers verify `addressed` fixes and hunt fix-introduced problems; re-raises of `disputed`/`deferred` fingerprints are auto-suppressed and never score.
- **Findings pass a relevance gate before any fix:** a validator classifies each finding (diff-caused? confidence 0–100) — only ≥80-confidence diff-caused findings reach the fix pass; 60–79 or pre-existing demote to advisory (note / consolidation follow-up, never fixed in-slice); <60 drop as UNVERIFIED. The validator classifies only — it never adds findings.
- **Disputes exit the loop, then get adjudicated:** the fixer may reject a factually-wrong finding with concrete evidence; at loop end an independent Opus adjudicator rules each dispute on evidence only (never the fixer's rhetoric) — upheld reopens it into the stalled verdict, deadlock is reported to the human, never re-looped.
- **The loop stops on measured progress, not just a cap.** First hit wins: converged (zero open blocking + every lane reported) / two consecutive rounds without material progress (debt score drop ≥1, a blocking finding dying, or a gate clearing) / a fingerprint surviving 2 fix attempts is deferred / the hard cap (5 code-review rounds, 3 Playwright) — a safety boundary, not a target. A non-converged stop reports `stalled — shipped with N open findings (CR-…)`, never a silently exhausted cap.
- **Tests + commit gate before every review/verify round:** reviewers and the Playwright agent never see red or uncommitted code. A `testsGreen=false` or `committed=false` result routes back to a dedicated implementer fix pass (consuming a round of the same cap), and implementers must prove green with `testEvidence` (commands + summary lines run in-session), never assert it.
- **A round with dead reviewers never converges:** if any spawned reviewer returns null (agent died) and no blocking findings came back, the loop escalates to the human instead of reporting convergence — zero findings only counts when every reviewer actually reported.
- Playwright runs as a **dedicated loop, only after the code-review loop converges**, and only on user-facing slices. A broken user story is a **blocking** finding (failed AC), not advisory — it triggers a fix round inside that loop (max 3), with the screenshot kept as proof.
- TDD discipline is carried in the implement/fix agent's prompt (red-green per criterion); workflow subagents don't load the `tdd` skill directly.
- Don't apply `agent:ready` to anything — this skill speaks `slice:next`, never the autonomous-loop trigger.
- Don't modify the parent PRD ticket's description or sibling slices' bodies. The only writes beyond this slice's own ticket: moving the `slice:next` pointer, posting/updating the "Skeleton map" comment on downstream deltas, and appending to the `## Implementation deltas` section of the parent's `# PRD` comment (Step 6).
- **Conventions are binding, not advisory:** exemplar mirroring per the slice's Convention contract; every added file carries a provenance row (`mirroredFrom` or a declared `[deviation: reason]`) — silent deviation is a blocking finding; no new helper without a `libs/**` search; the reuse reviewer runs whenever the diff adds or modifies files.
- **Contract freeze:** a delta never alters the skeleton's published contract (schema/types/API shape). A needed contract change stops the slice and escalates — the stack gets restructured, not quietly edited.
- **Consolidation never widens a slice:** in-slice extraction only within this slice's own new code + at most one existing call site; everything wider becomes a filed follow-up ticket (Step 4), linked from the PR comment (Step 5).
- **No pre-PR confirmation gate.** Once the loop finishes, open the draft PR automatically (Step 4→5); the only skip is "no committed diff". Never promote it to ready or merge — that stays the human's call on the draft.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
