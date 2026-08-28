---
name: split-pr
description: Split a too-big branch or existing PR into a stacked chain of small reviewable PRs. Plans layers by import direction, carves file-level layer branches off the base, validates each layer green, opens the PRs bottom→top with the repo's PR skill and links them into a GitHub stack. Use when the user says "split this PR", "break this into a stack", "this PR is too big", when the repo's PR skill redirects here on its size gate, or when a review complains a PR is unreviewably large.
argument-hint: "[PR number | nothing = current branch]"
---

# Split PR

Turn one oversized change into a **stack of small reviewable PRs**. The original diff is never altered — it is re-cut into layers, each layer a branch based on the one below, each independently green, together tree-identical to the original. Stacking follows the `<STACK>` skill's rules — load it before any stack command.

Two entry modes:

- **Pre-PR** — `<PR-SKILL>`'s size gate (or the user) decided the current branch is too big before any PR exists.
- **Existing PR** — an open PR turned out unreviewably large; the stack replaces it, reusing the PR as the top layer.

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block); the placeholders
below stand for its values. Missing file or empty key → use the fallback and say
so once.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<BASE>` | `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<PR-SKILL>` | `skills.createPr` | write the PR title/body inline, following `pr.titleRule` |
| `<TITLE-RULE>` | `pr.titleRule` | `<type>: <subject>` |
| `<BOT>` | `pr.botReviewer` | no bot review round |
| `<STACK>` | `pr.stackTool` | **stop** — splitting into a stack needs a stack tool; say so |
| `<GATE>` | `gates.all` | discover the repo's build/lint commands and name which you used |

## Step 0 — Should it split at all?

Splitting must **reduce review cost, not shuffle it**. Measure the meaningful diff — `git diff --stat <base>...HEAD` minus generated noise (lockfiles, migration snapshots, generated types, binary assets):

- **Split** when the meaningful diff would take **>~20 minutes of careful review — roughly >300 changed source lines** — AND it factors into ≥2 coherent layers (distinct levels of the import graph — e.g. schema+dal, actions, UI, e2e). Review *time* is the test, not LOC: mechanical bulk (renames, generated files, lockfiles) is exempt from the line count. Each resulting layer targets **~50–200 lines, ~10–15 minutes of review** — the same sizing `/to-issues` slices to up front, so rescue splitting and up-front slicing agree.
- **Don't split** a large-but-atomic change: a rename/format sweep, one generated migration plus its consumers, a lockfile bump, a deletion that must land whole. Layer count of 1 = no split — say so and stop (back to `<PR-SKILL>` in pre-PR mode).
- A stack slice produced by `/work-slice`, `/work-issue` or `/to-issues` is already sized — never re-split those.

## Step 1 — Plan the layers (import direction, bottom → top)

`git diff --name-only <base>...HEAD` (+ `--diff-filter=A/D` for adds/deletes). **First build a per-file intent table** — one row per file, one *intent* per file (the single purpose its change serves); the layer seams fall out of the table. Then group **by import direction**: a file goes in the lowest layer where everything it imports already exists. Typical order follows the repo's own layering (`goldenPaths` names it): data schema/migrations → data access → service/actions → shared utils → UI components → routes/pages → e2e/tests/docs. Hard-won rules:

- **File-level split only** — a file lives entirely in its lowest layer; no hunk surgery. A file two layers both need goes in the lower one.
- **Export removals ride with ALL their direct consumers** — or every layer between breaks the build.
- **Deletions**: leaf files (routes) can be deleted in an early layer typecheck-safe; deleting a whole module keeps its path alias/registration until the deletion layer.
- **Tiny hand-crafted intermediates are OK** — e.g. a one-layer stub of a function whose real body lands above — but keep them small and note them in that layer's PR body.
- **Lockfiles**: any layer touching a manifest regenerates the lockfile for that layer alone; the **final** layer takes the original branch's lockfile verbatim.
- 2–4 layers is the sweet spot; each must read as one reviewable idea with a one-line purpose. Hard cap **4–5 PRs per stack** (same as `/to-issues`) — above that, in order: (1) merge adjacent layers, (2) carve the tail into a second stack behind the first, (3) base a file-disjoint layer directly off `<BASE>` as an independent PR outside the chain, (4) question the scope with the user. Only then accept a long stack.

Print the plan — `NN | branch suffix | purpose | files` — then proceed (drafts are reversible; no confirmation gate). The one exception: **existing-PR mode where the PR already has review activity** — replacing its branch is a history rewrite over reviewed code, so ask before continuing.

## Step 2 — Carve the layer branches

Preflight: clean worktree, branch pushed nowhere it shouldn't be, `git fetch origin <base>`. Branch names: `<issue-slug>/NN-<layer-slug>` (e.g. `proj-1268/01-remove-legacy-service`); resolve the issue id the way `<PR-SKILL>` does.

```bash
git checkout -b <issue-slug>/01-<layer> origin/<BASE>
git checkout <original-branch> -- <layer-1 paths>     # file states, not patches
# files the original DELETED that belong to this layer: git rm <path>
git add -A && git commit -m "<ISSUE> <layer 1 subject>"

git checkout -b <issue-slug>/02-<layer>                # off layer 01
git checkout <original-branch> -- <layer-2 paths>
...
```

The **top layer** takes every remaining path. Safety net (mandatory): `git diff <original-branch> <top-layer> --stat` must be **empty** — the stack reproduces the original tree exactly. Not empty → a path was missed; fix before validating.

**Validate every layer, bottom → top** (checked out per layer):

Run `<GATE>` against the predecessor branch as the base, plus whatever narrower
typecheck the repo needs for the files this layer touched. Apply `gates.traps`
first — they name the ways these commands lie (stale build caches, exit codes
masked by a pipe, interactive test runners).

A red layer means the plan violated import direction — move the offending file down (amend the lower layer, rebase the ones above) rather than patching around it.

## Step 3 — Open the PRs and link the stack

Bottom → top, per layer: `git push -u origin <branch>` → **`<PR-SKILL>`** verbatim (each layer gets its own title per `<TITLE-RULE>`, with the layer's subject; the same issue id across the stack is fine) → `gh pr ready <n> --undo` (the suite ships drafts). Never `gh stack submit` — its auto-titles glitch and `<PR-SKILL>` owns titles.

Then link, by PR number, never `--open`:

```bash
gh stack link --base <BASE> <pr-01> <pr-02> … <pr-top>
```

**Existing-PR mode:** the original PR becomes the top of the stack. After the empty-diff check, point its branch at the top layer's tip — `git push --force-with-lease origin <top-layer>:<original-branch>` — so the PR keeps its number and threads while its history becomes stack-shaped, then link with the original PR number on top and refresh its body with `<PR-SKILL>` (the Summary now covers only the remainder). In pre-PR mode there is nothing to replace — clean up a stale Conductor-pushed remote branch the same way `/work-slice` Step 5.1 does (delete it, close any PR on it) and end checked out on the top layer.

## Step 4 — Report, then drive to "in order"

Report: the layer table (PR number, branch, purpose, diff stat), the empty-diff verification line, and per-layer validation results.

Same finish as the rest of the suite: run **`/babysit-stack <pr-01> … <pr-top>`** passes until the verdict reads GOAL MET (CI green, `<BOT>` requested, threads resolved), handling verdicts exactly like `/feature-goal`'s BABYSIT stage — actionable items → another pass now; only pending CI / an awaited `<BOT>` review → end the invocation naming what's pending (re-invoking `/babysit-stack <pr-01> … <pr-top>` resumes; `/loop` or a scheduler paces unattended re-checks); `needs-human` blockers → report them as the stop reason.

## Boundaries

- **The original tree is sacred:** the stack must reproduce it byte-for-byte (the empty-diff check is mandatory) — splitting never "improves" code along the way; findings go to `/iterate-pr` or a ticket.
- Never merge, approve, or mark ready; the stack ships as drafts.
- File-level layering only; no hunk-level rewrites of shared files.
- With `gh-stack`: link by PR number, never `--open`, never `gh stack submit`.
- Force-push only the branch replacement in existing-PR mode, only with `--force-with-lease`, and only after asking when the PR has review activity. Never force-push branches other worktrees hold.
- Don't split atomic changes or already-sliced pipeline branches (Step 0).
- `<PR-SKILL>` is used verbatim per layer — never fork its title/body logic here.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow
