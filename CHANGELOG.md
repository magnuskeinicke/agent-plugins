# Changelog

## 0.16.0 — 2026-11-13

### Added

- **Gate 5: the other provider reviews the final tree.** The engine review loop ran only Claude
  reviewers over Claude's own code. It now ports trackbed's (formerly kramme-cc-workflow)
  `pr:review-convergence` Gate 5: once the magnus reviewer rounds converge, the vendored
  `adversarial-review` runner sends the committed branch to the other provider (Codex
  `gpt-6.1-sol` for a Claude run, Claude `opus` for a Codex run). Locally it runs the provider CLI
  on a read-only `HEAD` snapshot; in a Conductor cloud workspace it starts a session with the
  other provider in the current workspace.
  - Its findings are untrusted: the validator re-checks them, the host's fresh fixer fixes the
    accepted ones, the next round checks the fix, and Gate 5 runs again until it attests the
    final tree. Fix cycles are capped at 3 (`adversarial.maxCycles`).
  - A finding the validator rejects or demotes for any reason other than "pre-existing" is a
    disagreement. Upstream asks the user; here the adjudicator rules on it.
  - Gate 5 fails closed. A missing CLI, a timeout, a bad result or a changed tree blocks the run
    with a `blocked — adversarial review (Gate 5)` verdict. It never falls back to a
    same-provider review.
  - `init` takes `--host claude|codex`. The new `adversarial` config key (default on) is the
    repo's consent to send the code to the other provider. `review-code` runs Gate 5 only with
    `--adversarial`.
  - `report` returns upstream's Independent Review Record line, which the PR body's
    `## Verification` now ends with.

### Changed

- **Reviewer agents refreshed to trackbed 1.0.1.** Each agent is now read-only
  (`disallowedTools: Write, Edit, NotebookEdit`). `silent-failure-hunter` checks for checks that
  can pass while broken, `pr-relevance-validator` keeps findings the change makes reachable, and
  `codebase-pattern-reviewer` verifies a spec's current-state claims. `cold-reader` is new but
  not used yet. The magnus additions are kept.
- **`adversarial-review` refreshed to trackbed 1.0.1.** The runner now restricts `PATH`, marks
  prompt regions with a per-run token and isolates Codex harder. The other vendored review
  skills and their shared scripts stay at kramme 0.88.0 for now.

### Fixed

- **Cloud Gate 5 can read Codex's reply.** Found by a test in a Conductor cloud workspace: the
  runner matched only `assistant` messages, but a Codex session answers with an `agentMessage`
  item, so every cloud Codex review blocked. Both reply shapes are read now.
- **A cloud Codex reviewer reads the repository.** Upstream's cloud prompt forbade every command,
  and Codex reads files by running commands, so it judged only the patch text. It may now run
  read-only inspection commands; the tree-integrity check still rejects any write.
- **Failures say why.** A blocked Gate 5 keeps the runner's stderr, and a failed CLI worker
  reports the reason it printed on stdout (in a cloud sandbox `claude -p` prints
  `Not logged in`). Claude-hosted cloud runs use native subagents (`runtime.md`).

## 0.15.1 — 2026-11-11

### Fixed

- **Unattended runs no longer stop to ask questions.** Three cloud `/work-issue` runs (SER-1820,
  SER-1821 and SER-1822) asked the user four questions between them. Most came from the team's
  `dev@melatech` plugin: its PR gate forced an extra `mt-code-review`, and that review handed its
  "user's call" rulings and "owner actions" back to the user.
  - The cloud bootstrap checklist (step 3) now turns off other plugins' interactive gates for the
    workspace only. It writes `"MT_GATES": "off"` into the gitignored `.claude/settings.local.json`
    when `dev@melatech` is installed. The manual bootstrap message in `conductor-workspace` and the
    wayfinder dispatch do the same.
  - If such a gate still fires, `work-issue` meets the gate's demand and decides any question
    itself. It records each decision as a `## Notes` bullet and never repeats the gate's jargon to
    the user.
- **Verified out-of-diff defects are filed without asking.** A reviewer can find a pre-existing
  production bug or a test gap that belongs to shipped code or a sibling ticket. These used to end
  the run with "your call". `followups.md` now has a `## Discoveries` section: verify each defect,
  then file at most one bug ticket and one test-gap ticket per run, deduped by a
  `magnus:discovery:` marker. Other tickets are never edited. `work-issue` and `work-slice` follow
  it.
- **The cloud bootstrap updates a stale preinstalled plugin.** The cloud image ships its own copy
  of the plugin, and `marketplace add` fails on it. Step 2 now runs `marketplace update` +
  `plugin update` (with a `git pull` first when the marketplace is a local directory). A version
  that stays older than the dispatcher's makes the bootstrap report `BOOTSTRAP FAILED`.
- **`work-issue` no longer ends a turn between steps.** A new red flag stops it ending the turn
  after a fix or before the next review round when nothing is blocking.

## 0.15.0 — 2026-10-20

### Added

- **`/github-review` reviews someone else's PR.** It is vendored near-verbatim from kramme's
  `kramme:pr:github-review` (MIT, provenance in `agents/sources.yaml`), with the skills it delegates
  to: `pr-code-review`, `pr-product-review`, `linear-review-pr` and `humanize`. It fetches the PR
  into a throwaway worktree pinned to its head. It runs the code pass, adds the product/UX pass when
  UI files changed, and traces every linked Linear issue's requirements against the diff in both
  directions. It checks the existing threads against the live code and writes
  `GITHUB_PR_REVIEW_OVERVIEW.md`. After your OK (or with `--draft-review`), it creates one
  unsubmitted pending GitHub review. It never submits, approves or requests changes.
- **`/adversarial-review` and `/github-review --adversarial`.** Vendored from
  `kramme:pr:adversarial-review`, it sends the clean committed branch to the other provider (Codex
  from Claude, Claude from Codex) in an isolated read-only snapshot. It then validates each returned
  finding against the diff.
- Review subagents in the vendored skills run the engine's `reviewer` role: Claude `opus` (Opus 5.5)
  and Codex `gpt-6.1-sol`, both at high effort. They no longer inherit the session model.

### Changed

- **Reviewer agents refreshed to kramme v0.88.0.** Upstream merged seven agents into two.
  `security-reviewer` replaces `injection-reviewer`, `auth-reviewer`, `data-reviewer` and
  `logic-reviewer`, running all four lenses in one invocation. `cleanup-reviewer` replaces
  `lean-reviewer`, `code-simplifier` and `removal-planner`. The engine roster follows: cleanup runs
  in round 1 and re-runs on a fix round that deletes files. Security runs when the `security` area
  triggers. Agents now report every finding with its confidence and leave filtering to the caller.
  The engine's copy-review contract carries the 75-confidence threshold that left the rubric.

## 0.14.1 — 2026-10-19

### Fixed

- **Only the driver decides on a wayfinder map.** A HITL ticket's decider used to be "the person
  who must answer", so charting named colleagues as deciders. The driver (the user who charted the
  map) is now the only decider on a map. A ticket's `## Decider` is `driver` or `agent`, never
  another person. Claims assign only the driver. A colleague's or another team's knowledge counts as
  input or research. A session whose user is not the driver stops at the HITL check. Resolutions
  read `Confirmed by <driver>`.

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
