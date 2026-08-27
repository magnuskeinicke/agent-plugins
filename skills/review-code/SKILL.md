---
name: review-code
description: Fan out the shared feature-dev reviewer lanes (baseline + web/server + reuse + CodeRabbit CLI) on any code, any time — uncommitted changes, a branch diff, or a PR. One read-only parallel review round, findings report back; no fix loop, no ticket needed. Use when the user says "review this code", "spawn the review agents", "run the reviewer lanes", "review my diff/working tree/branch", or wants the work-slice reviewers on ad-hoc code.
---

# Review Code

Run the **same review agents** the feature-dev workflows (`/work-slice`, `/solve-ready-tickets`) use — baseline + diff-matched **web/server lanes** + the **reuse reviewer** + the **scope-fidelity reviewer** (when context provides acceptance criteria and the diff is sizeable) + the **CodeRabbit reviewer** (a wrapper around the CodeRabbit CLI) — on **any** code, standalone. One parallel read-only round; a **relevance validator** then classifies every raw finding (diff-caused? confidence 0–100?) before it reaches the report, so the human sees blocking (≥80 confidence, diff-caused), advisory (60–79 or pre-existing), and unverified (<60) findings separately, each under a stable `CR-NNN` id. No implementer, no fix loop, no Playwright, no ticket: the human decides what to do with the findings.

The reviewer definitions live once in `.claude/skills/_shared/reviewer-registry.js` (synced into the workflow script via `.claude/skills/_shared/sync.sh`), so this skill always reviews with the current registry — tune the registry, and this skill picks it up.

Read `docs/agents/repo-config.md` if present (the repo-specific values — integration branch, area→path map, `libMap` — passed to the workflow as `repoConfig`). If it's missing, the workflow falls back to its built-in Seranote defaults.

## Step 1 — Resolve the review target

Input is optional: a base ref/branch, a PR number, or nothing.

- **Nothing given, dirty worktree** (`git status --porcelain` non-empty) → review the **uncommitted work**: `inspect = "git diff HEAD"`, changed = `git diff --name-only HEAD`, added = `git diff --name-only --diff-filter=A HEAD`, untracked = the `??` paths from `git status --porcelain` (source files only — skip build artifacts/screenshots).
- **Nothing given, clean worktree** → review the **branch vs its base**: `inspect = "git diff <base>...HEAD"` where `<base>` = `repoConfig.integrationBranch` (fallback `development`, or `origin/main` if that branch doesn't exist). Changed/added via `--name-only` / `--diff-filter=A` on the same range.
- **Base ref given** ("review against X", "review vs development") → same as above with that base.
- **PR number given** → don't check anything out: `inspect = "gh pr diff <n>"`, changed = `gh pr diff <n> --name-only`, added = paths whose diff hunk starts from `/dev/null` (parse `gh pr diff <n>` for `new file mode` entries). Note in `context` that reviewers see only the diff, not a checkout.
- **Specific files given** → `inspect = "git diff HEAD -- <paths>"` (or, for files with no diff, list them as `untrackedFiles` so reviewers read them in full).

If there is nothing to review (clean tree AND no commits past base), stop and tell the user.

Also capture `insertions` — the inserted-line count from `git diff --shortstat` on the same range (0 when unknown). Together with added files it gates the scope-fidelity lane.

Optionally set `declaredAreas` (from `frontend|backend|database|i18n|security|performance`) when you know the change touches an area its paths don't reveal — e.g. an auth-relevant change in a neutral path → declare `security`.

Build `coderabbitCmd` — the exact CodeRabbit CLI invocation matching the review target (the workflow passes it verbatim to the CodeRabbit reviewer agent; empty/absent = that reviewer is skipped):

- Uncommitted work → `coderabbit review --agent --uncommitted -c CLAUDE.md` (append `--include-untracked` when `untrackedFiles` is non-empty).
- Branch vs base → `coderabbit review --agent --committed --base-commit "$(git merge-base <base> HEAD)" -c CLAUDE.md`.
- PR reviewed diff-only (no local checkout) → omit `coderabbitCmd`; the CLI needs a checkout.

## Step 2 — Run the review round (Workflow)

This step runs as a **single `Workflow` call** — invoking it here is the sanctioned opt-in. The workflow selects the reviewer set from the changed paths (baseline always; at most 2 lanes; reuse when the diff adds or modifies files; scope-fidelity when `hasAcceptanceCriteria` is set and the diff is sizeable; CodeRabbit when `coderabbitCmd` is given), spawns them **in parallel**, and returns the aggregated findings.

```
Workflow({
  scriptPath: ".claude/skills/review-code/review-code.workflow.js",
  args: {
    inspect,        // the command reviewers run to see the code (Step 1)
    context,        // optional: what the change is / what to judge it against
                    // (acceptance criteria, a ticket description, "pre-commit check")
    changedFiles,   // repo-relative paths under review (Step 1)
    addedFiles,     // added-vs-base paths — with changedFiles, gates the reuse reviewer
    untrackedFiles, // new files not in any diff — reviewers read them in full
    declaredAreas,  // optional area hints beyond the path map
    coderabbitCmd,  // Step 1's CodeRabbit CLI command; omit to skip that reviewer
    insertions,     // Step 1's inserted-line count — gates the scope-fidelity lane
    hasAcceptanceCriteria, // true ONLY when `context` carries real AC — gates the scope-fidelity lane
    repoConfig      // the JSON block from docs/agents/repo-config.md, if present
  }
})
```

**Do not review in the main session** — the workflow owns it. Reviewers and the relevance validator are **Sonnet** (role-based aliases, never exact pins — same policy as the other feature-dev workflows) and **read-only**: they only report. The scope-fidelity lane runs only when `hasAcceptanceCriteria` is set (pass it as true ONLY when the `context` you built actually contains acceptance criteria — a bare "pre-commit check" doesn't count) AND the diff adds files or >~150 inserted lines — necessity is judged against the stated AC, never inferred from the diff.

## Step 3 — Present the report

Print, from the returned summary:

- **Verdict**: clean, or N blocking findings. `clean` is only true when every spawned reviewer reported — a round with dead reviewers (`reviewersDied > 0`) is NOT clean even with zero blocking findings.
- Which reviewers ran (`reviewers`) — and flag any that died (`reviewersDied` / `reviewersSpawned` vs `reviewersReturned`).
- **Blocking findings** (`blockingFindings` — validator-confirmed: confidence ≥80 and diff-caused): one block each — `CR-NNN [area] title (file:line)`, detail, suggested fix, confidence.
- **Advisory findings** (`advisoryFindings` — 60–79 confidence, or confident-but-pre-existing, flagged `preExisting`): worth a glance, never "fix before ship".
- **Unverified** (`unverified` — confidence <60): listed so nothing dies silently; treat as noise unless something rings true.
- **Notes**: judgement-call points, grouped by area.
- **Consolidations**: generalizable-code candidates the reuse reviewer surfaced (these would become follow-up tickets in the workflow skills; here just list them).

Then **stop** — findings are the deliverable. Do not fix anything unless the user asks; if they do, fixing happens in the main session as a normal task (there is no fix loop in this skill).

## Boundaries

- **Read-only, always.** No edits, no commits, no branch changes, no tickets. The only side effect is the report.
- One round. No fix ⇄ review loop, no convergence cap — that machinery belongs to `/work-slice` / `/solve-ready-tickets`.
- No Playwright — user-story verification needs acceptance criteria and a runnable slice; out of scope here.
- Reviewer definitions come from the shared registry — to change focus/lanes/paths, edit `.claude/skills/_shared/reviewer-registry.js` in THIS repo and run `.claude/skills/_shared/sync.sh`; never fork them inline here.
- Model roles are fixed, models are aliases: reviewers and the relevance validator are **Sonnet**. Never pin exact model ids or effort levels.
- The relevance validator classifies findings — it never adds its own; a dead validator means findings pass through unclassified (reported as blocking), never silently dropped.
- The reuse reviewer runs without a provenance table here (ad-hoc code has none) — it hunts lib duplicates and consolidation candidates only.
- The CodeRabbit reviewer only relays **verified** CLI findings (bugs/security/leaks blocking; nits as notes); if the CLI is unavailable it reports that as a note instead of reviewing itself. This skill is single-round, so the once-only rule is trivially satisfied.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
