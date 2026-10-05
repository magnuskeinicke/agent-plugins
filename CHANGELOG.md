# Changelog

## 0.12.2 — 2026-10-05

### Fixed

- **Cloud workspaces are cut from the local repo's base branch.** Conductor's `create_workspace`
  API ignores the project's cloud base-branch setting and cuts from the remote's default branch
  unless `branch` is passed. `/feature-goal` and `/solve-ready-tickets` now always pass it.
- The engine `snapshot` resolves the base (`integrationBranch`, else `$CONDUCTOR_DEFAULT_BRANCH`,
  else `origin/HEAD`), pins it as `integrationBranch` so cloud sessions inherit it, and prints it
  as `base`.
- `<BASE>` fallbacks across skills and `CONTRACT.md` consult `$CONDUCTOR_DEFAULT_BRANCH` before
  `origin/HEAD`.

## 0.12.1 — 2026-10-05

### Changed

- **Every worker runs on Opus 5.5 / GPT-6.1 Sol at high effort.** All roles in
  `engine/lib/models.mjs` resolve to `opus` (cloud `opus-5-5-1m`) on Claude and `gpt-6.1-sol` on
  Codex, effort `high`. `gpt-5.6-terra`, `gpt-6-luna` and the split babysitter profile are gone.
- All review agents (`agents/*.md`) run on `opus` at `high`, including the former Sonnet lanes and
  the `xhigh` architecture-strategist / design-iterator.
- Defaults: `routing.cloudModels` uses `high` with Codex `gpt-6.1-sol`; `routing.codexModelAliases`
  maps both `sonnet` and `opus` to `gpt-6.1-sol`.

## 0.12.0 — 2026-09-29

### Changed

- **Commit subjects follow the repo's commit rule, or the PR title rule, instead of starting with
  the issue id.** Skills no longer tell agents to write `SER-1633 feat(web): …`; a host whose
  ruleset enforces a `commit_message_pattern` and squash-merges with `COMMIT_OR_PR_TITLE` rejected
  those subjects at merge time. The rule resolves from the new `commit.format` / `commit.pattern`
  keys, else `pr.titleRule` / `pr.scopes`, else a plain `<type>: <subject>`. The push ban is a
  separate instruction.
- The engine renders the resolved rule (format, a concrete example, the checked range) into every
  fix and gate-fix prompt. `--commit-rule` on `plan` / `decide` is gone.

### Added

- Repo-config keys `commit.format` and `commit.pattern` (`CONTRACT.md`, `engine/lib/defaults.mjs`).
  An invalid `commit.pattern` fails config loading.
- Deterministic enforcement: `init` turns non-matching implement-pass subjects into a gate-fix;
  `apply-fix` refuses a fix range with a non-matching subject and names each sha and subject.
- `engine commit-rule` (the rendered rule, an example, or a finished subject) and
  `engine commit-check` (pre-push gate, exits 1 on any offender), used by work-slice Step 5,
  work-issue, iterate-pr, split-pr, babysit-stack and the runtime contract's parent-owned commits.
- `init` options `--commit-type`, `--commit-scope`, `--issue` and `--commits-since`.
- `engine snapshot` pins the resolved `commit` key, so `/feature-goal` relay sessions and the final
  babysit session read the same rule.
- `/init-repo` discovers the rule from branch rulesets, then commitlint / lefthook / husky
  `commit-msg` config, then recent integration-branch subjects, and records why it matters when
  `squash_merge_commit_title` is `COMMIT_OR_PR_TITLE`.

### Host action

Add the rule to `docs/agents/repo-config.md`, e.g. for voice-to-text:

```json
"commit": {
  "format": "<type>[(<scope>)]: SER-XX <subject>",
  "pattern": "^(feat|fix|perf|build|refactor|chore|docs|test|ci|tool)(\\([a-zA-Z0-9\\-]+\\))?: .+"
}
```

Pinned `/feature-goal` snapshots from before 0.12.0 carry no `commit` key; re-snapshot them.
