---
name: init-repo
description: >
  Scaffold the host-repo half of the magnus plugin contract into a repository
  that does not have it yet — docs/agents/repo-config.md (the one required
  file), plus the optional issue-tracker / triage-label prose docs, CONTEXT.md
  and docs/adr/. Discovers the repo's real values (integration branch, gate
  commands, source roots, tracker, PR title rule, layering exemplars) instead of
  asking, confirms them, and writes them. Use when I say "init this repo for the
  suite", "set up the agent contract here", "scaffold repo-config", "make the
  magnus skills work in this repo", or run `/init-repo` — and whenever a suite
  skill reports that docs/agents/repo-config.md is missing.
argument-hint: "[dry-run|apply]"
---

# Init Repo

Every skill in this plugin reads one host file: **`docs/agents/repo-config.md`**.
This skill creates it — filled in with *this* repo's actual values, not a
template full of TODOs. Read `CONTRACT.md` at the plugin root for the full key
reference; this skill is its scaffolder.

**Mode:** `dry-run` prints the file it would write and stops. `apply` writes it.
Default is **`apply` for a repo that has no `docs/agents/repo-config.md`**
(there is nothing to lose) and **`dry-run` when the file already exists** — an
existing config is hand-curated; never overwrite it silently.

## Step 1 — Is there already a contract?

- `docs/agents/repo-config.md` exists → this is a **gap-fill** run, not a
  scaffold. Parse its `## Config` block, list which keys are missing or empty
  against `CONTRACT.md`, and offer to fill only those. Never rewrite a key that
  already has a value.
- It doesn't exist → full scaffold, below.

## Step 2 — Discover the values (never ask what you can read)

Work through the keys in `CONTRACT.md` order. Each one: find the evidence, then
record the value **plus the evidence** so Step 4 can show its work. A key you
genuinely cannot determine stays empty — an empty key degrades to a documented
generic default, which is always better than a wrong guess.

| Key | Where to look |
| --- | --- |
| `integrationBranch` | `git symbolic-ref --short refs/remotes/origin/HEAD`; cross-check what open PRs target (`gh pr list --json baseRefName`) — the common base wins over the repo default when they differ |
| `sourceDirs` | top-level dirs holding source (`src/`, `libs/`, `apps/`, `packages/`), from the tree + any workspace globs in the package manifest |
| `conventionsFile` | `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.cursorrules` — first one present |
| `gates.*` | the conventions file's "before you push" section first; then package-manifest scripts, the pre-push hook config, and the CI workflow. Prefer the command a human is told to run over one you infer |
| `gates.traps` | search the conventions file and any agent docs for warnings about those commands (flags that must be set, pipes that mask exit codes, caches that lie). Empty is fine |
| `tracker.*` | is there a Linear/Jira MCP connected, or does the repo use GitHub Issues? Recent PR titles and branch names reveal the `issuePrefix`. Resolve team + id from the tracker itself |
| `labels.*` | list the tracker's labels and match them to the roles in `CONTRACT.md` (agent-ready, needs-human, slice pointer, triage opt-out, type/risk prefixes). **Do not create labels here** — record only what exists; the owning skill creates what it needs |
| `pr.titleRule` / `pr.scopes` | the CI title-check regex, or the shape of the last ~20 merged PR titles |
| `pr.stackTool` | `gh extension list`; a `.git/av` or similar tool dir; else empty |
| `pr.botReviewer` / `pr.cliReviewer` | which bot has reviewed recent PRs; which review CLI is installed |
| `skills.*` | `ls .claude/skills/` (and `.codex/skills/`) — map each role to a skill that actually exists; leave empty otherwise |
| `devServerCommand` / `e2eDir` / `browserGuidePath` | the dev script in the package manifest; a Playwright/Cypress project dir; any existing browser-testing guide |
| `areaPaths` | the repo's real layout — replace the generic patterns wholesale rather than appending to them |
| `reviewers` | an **additive focus overlay**, not a lane list — the plugin's vendored roster is the lane source. For each area, name the repo skills that own it (`skills.*` and anything else under `.claude/skills/`) and write a focus line in the repo's own vocabulary; the engine appends it to the prompts of the roster reviewers covering that area. Leave an area empty to keep the generic lens |
| `goldenPaths` | leave **empty** on a first run and say so — pinning an exemplar is a deliberate choice `/magnus:to-issues` makes and writes back. Guessing here is worse than leaving it blank |
| `libMap` | one line per lib/package: its import name and one-sentence purpose. On a large repo, do the top level first and note that it is partial |

Delegate the breadth (lib map, area paths, exemplars) to a read-only Explore
subagent if that is cheaper than reading the tree yourself.

## Step 3 — Confirm the load-bearing few

Do **not** quiz the user key by key. Show only the values where a wrong guess
would be actively harmful, one line each with its evidence, and ask for a single
confirmation:

- `integrationBranch` — everything diffs and stacks against it.
- `gates.all` — the definition of done every implementer must satisfy.
- `tracker.kind` + `tracker.issuePrefix` — decides which tool the suite talks to.
- `labels.agentReady` — if this is wrong, an autonomous loop drains the wrong queue.

Everything else is written as discovered and is trivially editable afterwards.

## Step 4 — Write the file

Write `docs/agents/repo-config.md` with:

1. A short intro naming this repo, stating that this file is the host half of
   the plugin contract, and that every key has a generic fallback in the plugin.
2. A `## Keys` section — one line per key, what it means **in this repo**.
3. A `## Config` section with a single fenced ```json block containing the
   values. It must parse: skills read this block and pass it verbatim as
   `repoConfig`.
4. A short "Discovered by /magnus:init-repo on <date> — edit freely" line, and,
   where a key was left empty, one line saying why.

Then run the repo's own formatter over the file if it has one.

## Step 5 — Offer the optional docs

These are optional; the suite degrades gracefully without them. Offer, don't
create unasked:

- **`docs/agents/issue-tracker.md`** (`tracker.docPath`) — the prose rules: how
  to create/update/link issues, the parent↔child convention, body conventions.
- **`docs/agents/triage-labels.md`** (`labels.docPath`) — who owns which label
  and what each one triggers. Worth writing as soon as more than one skill
  writes labels.
- **`docs/agents/README.md`** — an index pointing at the above, noting the suite
  ships as the private `magnus` plugin and that this repo supplies only knowledge.
- **`CONTEXT.md`** and **`docs/adr/`** — created lazily by `/magnus:grill-with-docs`
  when a term or decision actually gets resolved. **Never scaffold them empty.**

## Step 6 — Verify and report

Prove the file works before claiming it does:

1. Parse the `## Config` block as JSON — a parse error means the contract is dead.
2. Check every key name against `CONTRACT.md`; a typo'd key is silently ignored
   at runtime, which is the worst failure mode here.
3. Confirm each referenced path exists (`conventionsFile`, `e2eDir`,
   `browserGuidePath`, every `goldenPaths` entry, every `libMap` key).

Report: the file written, a table of key → value → evidence, the keys left empty
and why, and what to do next (`/magnus:grill-with-docs` for `CONTEXT.md`,
`/magnus:to-issues` to start pinning `goldenPaths`).

## Boundaries

- Writes `docs/agents/**` only. Never touches source, config, CI, or hooks.
- **Never creates tracker labels, issues, branches, or PRs** — it records what
  exists; the owning skills create what they need.
- Never overwrites an existing `docs/agents/repo-config.md` — gap-fill only
  (Step 1), and never rewrites a key that already carries a value.
- A key it cannot determine stays **empty**, with the reason reported. An empty
  key is a documented generic default; a guessed key is a silent wrong answer.
- `goldenPaths` starts empty by design — exemplars are pinned deliberately by
  `/magnus:to-issues`, not guessed here.
- Doesn't commit or push; the user reviews the diff.
