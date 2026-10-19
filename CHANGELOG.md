# Changelog

## 0.14.0 — 2026-10-19

### Added

- **`/wayfinder` charts initiatives too big for one grill.** It is adapted from Matt Pocock's
  `wayfinder` and kramme's `kramme:discovery:wayfinder`, both MIT, with sources in
  `skills/wayfinder/references/sources.yaml`. A seed becomes a `Wayfinder: …` map issue. The seed
  can be a ticket, an idea, or a whole Linear project (`project:<name>`, URL or `P-…` id). A
  project seed reads every issue, milestone and document in the project. Its map lives in the
  project with no parent issue. The map is labelled `wayfinder:map`. Its research, prototype,
  grilling and task decision tickets are sub-issues with native blocking. Every session claims and resolves one
  frontier ticket: assignee plus a claim comment, rechecked against competing sessions. It then
  records a resolution comment, gists it on the map and graduates fog. Research tickets fan out as
  subagents at chart time. Grilling tickets run `/grill-with-docs` scoped to one question and push
  `CONTEXT.md`/ADR changes to the map's `wayfinder/<map>` docs branch, so the state travels between
  local and cloud workspaces. A clear map ends in a `## Handoff` table of features in build order.
- `/feature-goal` reads that handoff. Under a CLEAR map, it merges the docs branch and runs a delta
  grill covering only what the map left open. Under an ACTIVE map, it stops before claiming the
  parent.
- The engine maps the `wayfinder` skill to the `planner` role.

## 0.13.1 — 2026-10-15

### Fixed

- **Babysitting no longer blocks on unavailable AI reviewers.** `babysit-stack` still runs Copilot
  and CodeRabbit whenever they can review, but a bot that is rate-limited, out of quota, erroring,
  not enabled, or never delivers is now marked `unavailable` and skipped. It is no longer
  `needs-human` and no longer makes the verdict NOT MET. Babysit never waits for a rate limit to
  lift: the first rate-limit notice skips the bot. The last available bot becomes the terminal
  reviewer. When no bot is available, CI and threads alone decide.
- Every bounded wait is now at most 10 minutes (was 20), so a stuck event is called after two
  empty waits, about 20 minutes (was 40).
- A skipped bot is disclosed: as `unavailable (<reason>)` in the verdict table, in the VERDICT line,
  and as a `## Notes` bullet on the PR body.
- The engine verdict check (`engine/github.mjs <pr> <state>`) accepts
  `bots.<login>.unavailable` and reports the skipped bots as `skippedBots`. A skipped bot never
  waives CI or unresolved threads.
- `work-slice`, `work-issue`, `iterate-pr`, `feature-goal` and `CONTRACT.md` no longer list a stuck
  bot as a blocker.

## 0.13.0 — 2026-10-15

### Changed

- **Far fewer follow-up tickets.** The new engine `followups` command decides what gets filed, so
  skills no longer turn every `consolidations` entry into its own ticket. It reads candidates from
  the reuse audit only, ignoring other lanes. It dedupes them across rounds by fingerprint and
  checks every claimed call site against the work tree. A candidate needs two existing sites
  outside the diff to qualify. At most one becomes its own ticket. The rest are appended to a
  single rolling `Follow-ups:` ticket, and everything else is demoted to the terminal summary.
- `consolidations` gain `rootCause` and `existingCallSites`. The reuse audit is told that
  speculative generalisation and duplication inside the diff are never consolidations. In later
  rounds it also receives the already-recorded candidates so it does not re-emit them.
- `work-slice` / `work-issue` file only what `followups` returns, deduped by a
  `magnus:followup:<fingerprint>` marker against open tickets
  (`skills/work-slice/references/followups.md`). `iterate-pr` and `review-code` list the same
  selection.
- Advisory findings are a PR note at most, never a ticket.
- `babysit-stack` Phase D gains an **out of scope** outcome: decline on the thread, resolve, and
  never file a ticket.

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
