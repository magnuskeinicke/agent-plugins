---
name: split-pr
description: Split a too-big branch or existing PR into a stacked chain of small reviewable PRs. Plans layers by import direction, carves file-level layer branches off the base, validates each layer green, opens the PRs bottom→top with the repo's PR skill and links them into a GitHub stack. Use when the user says "split this PR", "break this into a stack", "this PR is too big", when the repo's PR skill redirects here on its size gate, or when a review complains a PR is unreviewably large.
argument-hint: "[PR number | nothing = current branch]"
---

# Split PR

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `split-pr`; supporting skills inherit the caller’s resolved role.

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
| `<BASE>` | `integrationBranch` | `$CONDUCTOR_DEFAULT_BRANCH` (the local Conductor repo's base branch), else `git symbolic-ref --short refs/remotes/origin/HEAD` |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<PR-SKILL>` | `skills.createPr` | write the PR title/body inline, following `pr.titleRule` |
| `<MEDIA-BRANCH>` | `pr.mediaBranch` | `pr-media` — only used when the top layer inherits an existing PR's visual section |
| `<TITLE-RULE>` | `pr.titleRule` | `<type>: <subject>` |
| `<COMMIT-RULE>` | `commit.format` / `commit.pattern` — resolved by the engine (`node "$engine" commit-rule`, `engine` per `../work-slice/references/runtime.md`) | the `pr.titleRule` / `pr.scopes` shape, else `<type>: <subject>` |
| `<BOT>` | `pr.botReviewer` | babysit skips the review-request bot phase |
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
git add -A && git commit -m "<layer 1 subject per <COMMIT-RULE>>"

git checkout -b <issue-slug>/02-<layer>                # off layer 01
git checkout <original-branch> -- <layer-2 paths>
...
```

Each layer is one commit, so a host that squash-merges a single-commit PR under its commit subject lands exactly that subject. Render it with `node "$engine" commit-rule --issue <ISSUE> --type <type> --scope <scope> --subject "<layer subject>"` (its `subject` field; with a prose-only format, write it by hand from `format`) — never "issue id first" unless the rule says so.

The **top layer** takes every remaining path. Safety net (mandatory): `git diff <original-branch> <top-layer> --stat` must be **empty** — the stack reproduces the original tree exactly. Not empty → a path was missed; fix before validating. Then, before anything is pushed, `node "$engine" commit-check --range origin/<BASE>..<top-layer>` must print `ok: true` — it covers every layer's commit at once. A listed subject → reword that layer's commit (`git commit --amend -m`) and rebase the layers above it, then re-check.

**Validate every layer, bottom → top** (checked out per layer):

Run `<GATE>` against the predecessor branch as the base, plus whatever narrower
typecheck the repo needs for the files this layer touched. Apply `gates.traps`
first — they name the ways these commands lie (stale build caches, exit codes
masked by a pipe, interactive test runners). Record every command + result per
layer in `.context/<issue-slug>/evidence/<NN>-verification.jsonl` (row format in
`../work-slice/references/pr-evidence.md`) — Step 3 renders it into that
layer's `## Verification` table.

A red layer means the plan violated import direction — move the offending file down (amend the lower layer, rebase the ones above) rather than patching around it.

## Step 3 — Open the PRs and link the stack

Bottom → top, per layer: `git push -u origin <branch>` → **`<PR-SKILL>`** verbatim (each layer gets its own title per `<TITLE-RULE>`, with the layer's subject; the same issue id across the stack is fine) → `gh pr ready <n> --undo` (the suite ships drafts) → the evidence sections per `../work-slice/references/pr-evidence.md`: `## Verification` rendered from that layer's own validation rows, `## Visual verification` as one line (`Split layer — code identical to <original-branch>; no new surface captured`); the top layer in existing-PR mode keeps the original PR's visual section instead. One body write per PR, before any bot is requested. Never `gh stack submit` — its auto-titles glitch and `<PR-SKILL>` owns titles.

Then link, by PR number, never `--open`:

```bash
gh stack link --base <BASE> <pr-01> <pr-02> … <pr-top>
```

**Existing-PR mode:** the original PR becomes the top of the stack. After the empty-diff check, point its branch at the top layer's tip — `git push --force-with-lease origin <top-layer>:<original-branch>` — so the PR keeps its number and threads while its history becomes stack-shaped, then link with the original PR number on top and refresh its body with `<PR-SKILL>` (the Summary now covers only the remainder). In pre-PR mode there is nothing to replace — preserve existing remote branches and PRs as `/work-slice` Step 5.1 requires and end checked out on the top layer.

## Step 4 — Report, then drive to "in order"

Report: the layer table (PR number, branch, purpose, diff stat), the empty-diff verification line, and per-layer validation results.

Same finish as the rest of the suite: run **`/babysit-stack <pr-01> … <pr-top>`**. It babysits the stack to a terminal verdict itself — CI green, the GitHub review bots satisfied in order, threads resolved, waiting for each bot round with bounded polls. GOAL MET → done. NOT MET → only `needs-human` items remain (judgement-call threads, a stuck bot, a capped fix); report them as the stop reason and end — re-invoking `/babysit-stack <pr-01> … <pr-top>` resumes once the human has acted.

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

## Workflow Boundaries

**This skill re-cuts one oversized branch or PR into a validated stack of small draft PRs — the combined diff never changes.**

- **DOES**: gate the split decision (Step 0), plan file-level layers by import direction, carve layer branches, validate each layer with `<GATE>`, verify the empty-diff safety net, open draft PRs via `<PR-SKILL>` bottom→top, link the stack, drive `/babysit-stack` to GOAL MET
- **DOES NOT**: alter or "improve" the original code (findings go to `/iterate-pr` or a ticket), merge/approve/mark ready, do hunk-level surgery on shared files, re-split slices already sized by `/work-slice`, `/work-issue`, or `/to-issues`, or fork `<PR-SKILL>`'s title/body logic

## Red Flags — STOP

- No `<STACK>` tool configured — stop; splitting into a stack needs a stack tool, say so.
- The change is large-but-atomic (rename sweep, one migration + consumers, lockfile bump, whole deletion) or factors into one layer — stop; no split, back to `<PR-SKILL>` in pre-PR mode.
- The branch is a `/work-slice`, `/work-issue`, or `/to-issues` slice — stop; already sized, never re-split.
- Tempted to fix code while carving — stop; the stack must reproduce the original tree byte-for-byte; route findings to `/iterate-pr` or a ticket.
- `git diff <original-branch> <top-layer> --stat` is not empty — stop; a path was missed, fix before validating.
- About to run `gh stack submit` or link with `--open` — stop; link by PR number, `<PR-SKILL>` owns titles.
- About to force-push over a PR with review activity — stop; ask first, and only `--force-with-lease`.
- About to mark a stack PR ready or merge it — stop; the suite ships drafts.

## Verification

Before reporting done:

- [ ] Empty-diff check ran and returned empty: the top layer reproduces the original tree exactly.
- [ ] Every layer validated green bottom→top with `<GATE>` against its predecessor base, `gates.traps` applied first.
- [ ] Each layer is a draft PR with its own `<TITLE-RULE>` title, opened via `<PR-SKILL>` verbatim.
- [ ] Each layer PR body carries `## Verification` from its own validation rows and the one-line `## Visual verification` (the top layer keeps the original's in existing-PR mode).
- [ ] Stack linked by PR number: `gh stack link --base <BASE> <pr-01> … <pr-top>`.
- [ ] Existing-PR mode: original PR retargeted to the top layer with number/threads intact and body refreshed. Pre-PR mode: existing remote branches/PRs preserved, checked out on the top layer.
- [ ] Report shows the layer table, the empty-diff verification line, and per-layer validation results.
- [ ] `/babysit-stack` ran to GOAL MET, or the `needs-human` stop reason is named.
