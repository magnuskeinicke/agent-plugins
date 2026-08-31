---
description: |
    Manage stacked branches and pull requests with the gh-stack GitHub CLI extension. Use when the user wants to create, push, rebase, sync, navigate, or view stacks of dependent PRs. Triggers on tasks involving stacked diffs, dependent pull requests, branch chains, or incremental code review workflows.
metadata:
    author: github
    github-path: skills/gh-stack
    github-ref: refs/tags/v0.1.0
    github-repo: https://github.com/github/gh-stack
    github-tree-sha: c95c8b5b4dd850f3fef007b304428f5684f2fb87
    version: 0.0.9
name: gh-stack
---
# gh-stack

`gh stack` is a [GitHub CLI](https://cli.github.com/) extension for managing **stacked branches and pull requests**. A stack is an ordered list of branches where each branch builds on the one below it, rooted on a trunk branch (typically the repo's default branch). Each branch maps to one PR whose base is the branch below it, so reviewers see only the diff for that layer.

```
main (trunk)
 └── auth-layer     → PR #1 (base: main)            - bottom (closest to trunk)
  └── api-endpoints → PR #2 (base: auth-layer)
   └── frontend     → PR #3 (base: api-endpoints)   - top (furthest from trunk)
```

The **bottom** of the stack is the branch closest to the trunk, and the **top** is the branch furthest from the trunk. Each branch inherits from the one below it. Navigation commands (`up`, `down`, `top`, `bottom`) follow this model: `up` moves away from trunk, `down` moves toward it.

## When to use this skill

Use this skill when the user wants to:

- Break a large change into a chain of small, reviewable PRs
- Create, rebase, push, or sync a stack of dependent branches
- Navigate between layers of a branch stack
- View the status of stacked PRs
- Tear down and rebuild a stack to remove, reorder, or rename branches

## Prerequisites

The GitHub CLI (`gh`) v2.0+ must be installed and authenticated. Install the extension with:

```bash
gh extension install github/gh-stack
```

Before using `gh stack`, configure git to prevent interactive prompts:

```bash
git config rerere.enabled true           # remember conflict resolutions (skips prompt on init)
git config remote.pushDefault origin     # if multiple remotes exist (skips remote picker)
```

## Agent rules

**All `gh stack` commands must be run non-interactively.** Every command invocation must include the flags and positional arguments needed to avoid prompts, TUIs, and interactive menus. If a command would prompt for input, it will hang indefinitely.

1. **Always supply branch names as positional arguments** to `init`, `add`, and `checkout`. Running these commands without arguments triggers interactive prompts. Branch names are used exactly as given — a name is never prefixed or transformed, so `gh stack add refactor/foo` creates a branch named `refactor/foo`.
2. **Always use `--auto` with `gh stack submit`** to auto-generate PR titles. Without `--auto`, `submit` prompts for a title for each new PR.
3. **Always use `--json` with `gh stack view`.** Without `--json`, the command launches an interactive TUI that cannot be operated by agents. There is no other appropriate flag — always pass `--json`.
4. **Handle multiple remotes.** If more than one remote is configured, pre-configure `git config remote.pushDefault origin`, or pass `--remote <name>` to the commands that accept it: `push`, `submit`, `sync`, `rebase`, and `link`. `checkout`, `modify`, and `trunk` resolve a remote but have **no `--remote` flag** — they rely on `remote.pushDefault`. With multiple remotes and no configured default, these commands exit with an error in non-interactive mode.
5. **Avoid branches shared across multiple stacks.** If a branch belongs to multiple stacks, commands exit with code 6. Check out a non-shared branch first.
6. **Plan your stack layers by dependency order before writing code.** Foundational changes (models, APIs, shared utilities) go in lower branches; dependent changes (UI, consumers) go in higher branches. Think through the dependency chain before running `gh stack init`.
7. **Use standard `git add` and `git commit` for staging and committing.** This gives you full control over which changes go into each branch. The `-Am` shortcut is available but should not be the default approach—stacked PRs are most effective when each branch contains a deliberate, logical set of changes.
8. **Navigate down the stack when you need to change a lower layer.** If you're working on a frontend branch and realize you need API changes, don't hack around it at the current layer. Navigate to the appropriate branch (`gh stack down`, `gh stack checkout`, or `gh stack bottom`), make and commit the changes there, run `gh stack rebase --upstack`, then navigate back up to continue.
9. **Use `gh stack link` for external tool workflows.** When branches are managed by an external tool (jj, Sapling, etc.), use `gh stack link branch-a branch-b`. `link` does not rely on local tracking state and is intended for API-driven PR and stack management. Provide at least two branches/PRs to create or update a stack, or a stack number followed by the new branches/PRs to append them to the top of an existing stack (e.g. `gh stack link 7 branch-c`).
10. **Use `gh stack merge --yes` to merge stacked PRs.** `gh pr merge` does not work with stacked PRs. In a non-interactive terminal `gh stack merge` runs without prompting and merges the entire stack (bottom to top) atomically; pass `--yes` to be explicit. Scope the merge by passing a pull request number (`gh stack merge 42 --yes` merges everything up to and including PR #42) or a stack number (`gh stack merge 7 --yes`, which needs no local checkout). Choose the method with `--squash`, `--rebase`, `--merge`, or `--merge-method <method>`; without one, the last-used method is used. The merge is all-or-nothing — if any PR can't be merged, none are, and the failure reason is reported. Only basic pull request state is checked before merging (open and not a draft); bypassing merge requirements is not supported for stacks. If the base branch uses a merge queue, the stack is added to the queue instead of merging directly: the queue chooses the merge method (any method you pass is ignored with a warning), and the pull requests are added to the queue together but merge as the queue processes them, so they may land in separate groups rather than all at once.

**Never do any of the following — each triggers an interactive prompt or TUI that will hang:**
- ❌ `gh stack view` or `gh stack view --short` — always use `gh stack view --json`
- ❌ `gh stack submit` without `--auto` — always use `gh stack submit --auto`
- ❌ `gh stack init` without branch arguments — always provide branch names
- ❌ `gh stack add` without a branch name — always provide a branch name
- ❌ `gh stack checkout` without an argument — always provide a PR number or branch name
- ❌ `gh stack checkout <pr-number>` when a different local stack already exists on those branches — this triggers an unbypassable conflict resolution prompt; use `gh stack unstack --local` first to remove the local tracking state (this keeps the stack on GitHub intact), then retry the checkout

## Thinking about stack structure

Each branch in a stack should represent a **discrete, logical unit of work** that can be reviewed independently. The changes within a branch should be cohesive—they belong together and make sense as a single PR.

### Dependency chain

Stacked branches form a dependency chain: each branch builds on the one below it. This means **foundational changes must go in lower (earlier) branches**, and code that depends on them goes in higher (later) branches.

**Plan your layers before writing code.** For example, a full-stack feature might be structured like this (use branch names relevant to your actual task, not these generic ones):

```
main (trunk)
 └── data-models    ← shared types, database schema
  └── api-endpoints ← API routes that use the models
   └── frontend-ui  ← UI components that call the APIs
    └── integration ← tests that exercise the full stack
```

This is illustrative — choose branch names and layer boundaries that reflect the specific work you're doing. The key principle is: if code in one layer depends on code in another, the dependency must be in the same branch or a lower one.

### Branch naming

Choose a clear, descriptive branch name for each layer that reflects the concern it contains (e.g., `auth`, `api-routes`, `frontend`). Branch names are used exactly as you provide them to `init` and `add` — nothing is prepended or transformed. Slashes are allowed and are treated as part of the name (e.g., `gh stack add refactor/foo` creates a branch named `refactor/foo`).

### Staging changes deliberately

The main reason to use `git add` and `git commit` directly is to control **which changes go into which branch**. When you have multiple files in your working tree, you can stage a subset for the current branch, commit them, then create a new branch and stage the rest there:

```bash
# You're on data-models with several new files in your working tree.
# Stage only the model files for this branch:
git add internal/models/user.go internal/models/session.go
git commit -m "Add user and session models"

git add db/migrations/001_create_users.sql
git commit -m "Add user table migration"

# Now create a new branch for the API layer and stage the API files there:
gh stack add api-routes # created & switched to the api-routes branch
git add internal/api/routes.go internal/api/handlers.go
git commit -m "Add user API routes"
```

This keeps each branch focused on one concern. Multiple commits per branch are fine — the key is that all commits in a branch relate to the same logical concern, and changes that belong to a different concern go in a different branch.

### When to create a new branch

Create a new branch (`gh stack add`) when you're starting a **different concern** that depends on what you've built so far. Signs it's time for a new branch:

- You're switching from backend to frontend work
- You're moving from core logic to tests or documentation
- The next set of changes has a different reviewer audience
- The current branch's PR is already large enough to review

### One stack, one story

Think of a stack from the reviewer's perspective: the stack of PRs should **tell a cohesive story** about a feature or project. A reviewer should be able to read the PRs in sequence and understand the progression of changes, with each PR being a small, logical piece of the whole.

**When to use a single stack:** All the branches are part of the same feature, project, or closely related effort. Even if the work spans multiple concerns (models, API, frontend), they're all building toward the same goal.

**When to create a separate stack:** The work is unrelated to your current stack — a different feature, a bug fix in an unrelated area, or an independent refactor. Don't mix unrelated work into a single stack just because you happen to be working on both. Start a new stack with `gh stack init` or switch to an existing stack with `gh stack checkout` for each distinct effort.

Small, incidental fixes (e.g., fixing a typo you noticed) can go in the current stack if they're trivial. But if a change grows into its own project, it deserves its own stack.

## Quick reference

| Task | Command |
|------|---------|
| Create a stack | `gh stack init auth` |
| Create a stack of multiple branches | `gh stack init auth api frontend` |
| Adopt existing branches | `gh stack init existing-branch-a existing-branch-b` |
| Set custom trunk | `gh stack init --base develop branch-a` |
| Add a branch to stack | `gh stack add api-routes` |
| Add branch + stage all + commit | `gh stack add -Am "message" api-routes` |
| Push branches to remote | `gh stack push` |
| Push to specific remote | `gh stack push --remote origin` |
| Push branches + create draft PRs | `gh stack submit --auto` |
| Create PRs as ready for review | `gh stack submit --auto --open` |
| Sync (fetch, rebase, push) | `gh stack sync` |
| Sync with specific remote | `gh stack sync --remote origin` |
| Sync and prune merged branches | `gh stack sync --prune` |
| Rebase entire stack | `gh stack rebase` |
| Rebase upstack only | `gh stack rebase --upstack` |
| Rebase without trunk | `gh stack rebase --no-trunk` |
| Continue after conflict | `gh stack rebase --continue` |
| Abort rebase | `gh stack rebase --abort` |
| View stack details (JSON) | `gh stack view --json` |
| Switch branches up/down in stack | `gh stack up [n]` / `gh stack down [n]` |
| Switch to top/bottom branch | `gh stack top` / `gh stack bottom` |
| Check out by stack number | `gh stack checkout 7` |
| Check out by PR | `gh stack checkout 42` |
| Check out by branch (local only) | `gh stack checkout feature-auth` |
| Tear down the current stack to restructure it | `gh stack unstack` |
| Tear down a specific stack by number | `gh stack unstack 7` |
| Merge the whole current stack | `gh stack merge --yes` |
| Merge a stack by number | `gh stack merge 7 --yes` |
| Merge up to a specific PR | `gh stack merge 42 --yes` |
| Merge with a specific method | `gh stack merge --yes --squash` |

---

## Workflows

### End-to-end: create a stack from scratch

```bash
# 1. Initialize a stack with the first branch
gh stack init auth
# → creates auth and checks it out

# 2. Write code for the first layer (auth)
cat > auth.go << 'EOF'
package auth

func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // verify token
        next.ServeHTTP(w, r)
    })
}
EOF

# 3. Stage and commit using standard git commands
git add auth.go
git commit -m "Add auth middleware"

# You can make multiple commits on the same branch
cat > auth_test.go << 'EOF'
package auth

func TestMiddleware(t *testing.T) {
    // test auth middleware
}
EOF
git add auth_test.go
git commit -m "Add auth middleware tests"

# 4. When you're ready for a new concern, add the next branch
gh stack add api-routes
# → creates api-routes

# 5. Write code for the API layer
cat > api.go << 'EOF'
package api

func RegisterRoutes(mux *http.ServeMux) {
    mux.HandleFunc("/users", handleUsers)
}
EOF
git add api.go
git commit -m "Add API routes"

# 6. Add a third layer for frontend
gh stack add frontend
# → creates frontend

cat > frontend.go << 'EOF'
package frontend

func RenderDashboard(w http.ResponseWriter) {
    // calls the API endpoints from the layer below
}
EOF
git add frontend.go
git commit -m "Add frontend dashboard"

# ── Stack complete: auth → api-routes → frontend ──

# 7. Push everything and create PRs (drafts by default)
gh stack submit --auto

# 8. Verify the stack
gh stack view --json
```

> **Shortcut:** If you prefer a faster flow, `gh stack add -Am "message" branch-name` combines staging, committing, and branch creation into one command. This is useful for single-commit layers but bypasses deliberate staging.

### Making mid-stack changes

This is a critical workflow for agents. When you're working on a higher layer and realize you need to change something in a lower layer (e.g., you're building frontend components but need to add an API endpoint), **navigate down to the correct branch, make the change there, and rebase**.

```bash
# You're on frontend but need to add an API endpoint

# 1. Navigate to the API branch
gh stack down
# or: gh stack checkout api-routes

# 2. Make the change where it belongs
cat > users_api.go << 'EOF'
package api

func handleGetUser(w http.ResponseWriter, r *http.Request) {
    // new endpoint the frontend needs
}
EOF
git add users_api.go
git commit -m "Add get-user endpoint"

# 3. Rebase everything above to pick up the change
gh stack rebase --upstack

# 4. Navigate back to where you were working
gh stack top
# or: gh stack checkout frontend

# 5. Continue working — the API changes are now available
```

**Why this matters:** If you make API changes on the frontend branch, those changes will end up in the wrong PR. The API PR won't include them, and the frontend PR will have unrelated API diffs mixed in. Always put changes in the branch where they logically belong.

### Modify a mid-stack branch and sync

When you need to revisit a branch after the initial creation (e.g., responding to review feedback):

```bash
# 1. Navigate to the branch that needs changes
gh stack bottom
# or: gh stack checkout auth
# or: gh stack checkout 42  (by PR number)

# 2. Make changes and commit
cat > auth.go << 'EOF'
package auth
// updated implementation
EOF
git add auth.go
git commit -m "Fix auth token validation"

# 3. Rebase everything above this branch
gh stack rebase --upstack

# 4. Push the updated stack
gh stack push
```

### Routine sync after merges

```bash
# Single command: fetch, rebase, push, sync PR and stack state
gh stack sync

# Sync and automatically clean up local branches for merged PRs
gh stack sync --prune
```

> **Note for agents:** In non-interactive environments, the prune prompt is not shown. Use `--prune` explicitly to delete local branches for merged PRs.

> **Note for agents:** `sync` also mirrors the stack on GitHub locally. If PRs were added to the stack on github.com, their branches are pulled down and appended to the local stack automatically. If the local and remote stacks have **diverged** (you changed the local stack while the remote stack changed differently), sync can only prompt to resolve it in an interactive terminal — in non-interactive environments it aborts the sync (nothing is pushed or updated) and exits successfully with `ℹ Sync aborted`. Resolve a divergence by unstacking and recreating the stack.

### Squash-merge recovery

When a PR is squash-merged on GitHub, the original branch's commits no longer exist in the trunk history. `gh stack` detects this automatically and uses `git rebase --onto` to correctly replay remaining commits.

```bash
# After PR #1 (auth) is squash-merged on GitHub:
gh stack sync
# → fetches latest, detects the merge, fast-forwards trunk
# → rebases api-routes onto updated trunk (skips merged branch)
# → rebases frontend onto api-routes
# → pushes updated branches
# → reports: "Merged: #1"

# Verify the result
gh stack view --json
# → auth shows "isMerged": true, "state": "MERGED"
# → api-routes and frontend show updated heads
```

If `sync` hits a conflict during this process, it restores all branches to their pre-rebase state and exits with code 3. See [Handle rebase conflicts](#handle-rebase-conflicts-agent-workflow) for the resolution workflow.

### Handle rebase conflicts (agent workflow)

```bash
# 1. Start the rebase
gh stack rebase

# 2. If exit code 3 (conflict):
#    - Parse stderr for conflicted file paths
#    - Read those files to find <<<<<<< / ======= / >>>>>>> markers
#    - Edit files to resolve conflicts
#    - Stage resolved files:
git add path/to/resolved-file.go

# 3. Continue the rebase
gh stack rebase --continue

# 4. If another conflict occurs, repeat steps 2-3

# 5. If unable to resolve, abort to restore everything
gh stack rebase --abort
```

### Parsing `--json` output

```bash
# Get stack state as JSON
output=$(gh stack view --json)

# Check if any branch needs a rebase, and rebase if so
needs_rebase=$(echo "$output" | jq '[.branches[] | select(.needsRebase == true)] | length')
if [ "$needs_rebase" -gt 0 ]; then
  echo "Branches need rebase, rebasing stack..."
  gh stack rebase
fi

# Get all open PR URLs
echo "$output" | jq -r '.branches[] | select(.pr.state == "OPEN") | .pr.url'

# Find merged branches
echo "$output" | jq -r '.branches[] | select(.isMerged == true) | .name'

# Get the current branch
echo "$output" | jq -r '.currentBranch'

# Check if the stack is fully merged (all branches merged)
echo "$output" | jq '[.branches[] | .isMerged] | all'
```

### Restructure a stack (remove a branch, reorder, or rename)

Use `unstack` to tear down the stack, make structural changes, then re-init:

```bash
# 1. Remove the local tracking and the GitHub stack grouping (PRs are NOT deleted)
gh stack unstack

# 2. Make structural changes — e.g. delete a branch, reorder, rename
git branch -m old-branch-1 new-branch-1

# 3. Re-create the stack with the new structure
gh stack init --base main new-branch-1 new-branch-2 new-branch-3
```

---

## Command reference

Per-command documentation — flags, behavior notes, JSON output shapes, and
stderr conventions for `init`, `add`, `push`, `submit`, `link`, `sync`,
`rebase`, `view`, navigation, `checkout`, and `unstack` — lives in
[`references/commands.md`](./references/commands.md). Read it before using a
command not already covered by the workflows above.

## Output conventions

- **Status messages** go to **stderr** with emoji prefixes: `✓` (success), `✗` (error), `⚠` (warning), `ℹ` (info).
- **Data output** (e.g., `view --json`) goes to **stdout**.
- When piping output, use `2>/dev/null` to suppress status messages if only data output is needed.

## Exit codes and error recovery

| Code | Meaning | Agent action |
|------|---------|-------------|
| 0 | Success | Proceed normally |
| 1 | Generic error | Read stderr for details; may indicate commit/push failure |
| 2 | Not in a stack | Run `gh stack init` to create a stack first |
| 3 | Rebase conflict | Parse stderr for conflicted file paths, resolve conflicts, run `gh stack rebase --continue` |
| 4 | GitHub API failure | Check `gh auth status`, retry the command |
| 5 | Invalid arguments | Fix the command invocation (check flags and arguments) |
| 6 | Disambiguation required | A branch belongs to multiple stacks. Run `gh stack checkout <specific-branch>` to switch to a non-shared branch first |
| 7 | Rebase already in progress | Run `gh stack rebase --continue` (after resolving conflicts) or `gh stack rebase --abort` to start over |
| 8 | Stack is locked | Another `gh stack` process is writing the stack file. Wait and retry — the lock times out after 5 seconds |
| 9 | Stacked PRs unavailable | The repository does not have stacked PRs enabled. Tell the user that stacks must be enabled on the repository first |
| 10 | Modify recovery required | A `gh stack modify` session was interrupted. This skill does not use `modify`, so agents should not produce this; if the repo is left in this state, run `gh stack modify --abort` to restore the pre-modify state |

## Known limitations

1. **Stacks are strictly linear.** Branching stacks (multiple children on a single parent) are not supported. Each branch has exactly one parent and at most one child. If you need parallel workstreams, use separate stacks.
2. **Stack disambiguation cannot be bypassed.** If the current branch is the trunk of multiple stacks, commands error with code 6. Check out a non-shared branch first.
3. **Multiple remotes require `--remote` or config.** If more than one remote is configured, set `remote.pushDefault` in git config, or pass `--remote <name>` to the commands that accept it (`push`, `submit`, `sync`, `rebase`, `link`). `checkout`, `modify`, and `trunk` have no `--remote` flag and rely on `remote.pushDefault`.
4. **Remote stack checkout requires a stack or PR number.** `checkout` with a branch name only works with locally tracked stacks. Use a stack number or PR number (e.g. `gh stack checkout 7` or `gh stack checkout 123`) to pull a stack from GitHub.
5. **PR title and body are auto-generated.** There is no flag to set a custom PR title or body during `submit`. The title and body are generated from commit messages plus a footer. Use `gh pr edit` to modify PR title and body after creation.

## Workflow Boundaries

**This skill manages stacked branches and their PRs with the `gh stack` CLI extension.**

- **DOES**: plan layer boundaries by dependency order, create/extend stacks (`init`, `add`, `link`), navigate layers, commit changes into the branch they belong to, rebase/sync/push, submit PRs, resolve rebase conflicts, merge whole stacks (`gh stack merge --yes`)
- **DOES NOT**: babysit CI or review threads on the resulting PRs (that is `babysit-stack`), review the code itself (`review-code`), write PR bodies beyond the auto-generated ones (use `gh pr edit` after `submit`), or manage branches outside a stack

## Red Flags — STOP

- About to run `gh stack view` without `--json`, `submit` without `--auto`, or a bare `init`/`add`/`checkout` — these open prompts or TUIs that hang forever.
- About to `gh stack checkout <pr-number>` while a different local stack exists on those branches — unbypassable conflict prompt; run `gh stack unstack --local` first, then retry.
- About to merge a stacked PR with `gh pr merge` — it does not work on stacks; use `gh stack merge --yes` with an explicit PR or stack number target.
- Editing a lower layer's code from a higher branch — the diff lands in the wrong PR. Navigate down, commit there, `gh stack rebase --upstack`, come back up.
- Exit code 9 — the repo doesn't have stacked PRs enabled. Report it; don't retry.
- Exit code 6 — the branch is shared across stacks; check out a non-shared branch before anything else.
- Multiple remotes and no `remote.pushDefault` — `checkout`/`trunk` have no `--remote` flag and will error; configure the default first.
- Stacking unrelated work into one chain because both happen to be in progress — separate stacks.

## Verification

Before reporting done:

- [ ] `gh stack view --json` shows the expected branch order and no branch has `needsRebase: true`.
- [ ] Every branch holds one concern, and each change sits in the layer it logically belongs to.
- [ ] Every PR's base is the branch below it (bottom PR's base is the trunk).
- [ ] Any lower-layer change was followed by `gh stack rebase --upstack` and a push, so upper branches include it.
- [ ] After upstream merges, `gh stack sync` ran clean (no aborted divergence), and pruning was explicit (`--prune`), not assumed.
