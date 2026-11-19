# Changelog

## 0.23.1 — 2026-11-19

### Changed

- **Codex workers and reviewers run on GPT-6.2 Sol.** Every Codex role in `engine/lib/models.mjs`,
  `routing.cloudModels.codex`, and the `routing.codexModelAliases` defaults (`sonnet`, `opus`) now
  resolve to `gpt-6.2-sol` instead of `gpt-6.1-sol`. Efforts are unchanged. This includes the
  `reviewer` role, so `/adversarial-review` (Gate 5) on a Claude host reviews with `gpt-6.2-sol` at
  `high` by default.

## 0.23.0 — 2026-11-17

### Changed

- **The QA handoff's test plan is walked by us before QA gets it.** After babysit GOAL MET,
  `/work-issue` and `/feature-goal` now draft the test plan first, then perform every step
  themselves in the running app, exactly as written: a throwaway Playwright spec with one
  `test.step` per plan step, locators only from the words the plan quotes, no routes or
  code-derived selectors after sign-in, every Expected asserted on screen. A step that cannot be
  done as written is fixed in the plan and walked again; an Expected the screen does not show is a
  regression (Blocked, nothing posted). Only then does the cold reader read it, and only then is it
  posted. The walk is recorded in `evidence/qa-walk.json` against the head it ran on; a head change
  invalidates it. A plan with steps is never posted unwalked — when the app cannot run in the
  workspace, the run ends Blocked with the reason.
- **`/work-issue` Step 7 is reordered:** 7a draft the plan → 7b walk it, which is the one capture
  run (publish + `## Visual verification`) → 7c cold read + post → 7d finalize the tracker.
- **`/feature-goal` QA-HANDOFF** walks the plan on the top branch of the stack after the
  stack-wide babysit. The walk records no media; the handoff still embeds the PR captures.

## 0.22.0 — 2026-11-16

### Changed

- **`/qa-or-release` sends an issue back to QA when QA sent it back.** It reads the issue's status
  history and comments. When the issue was in QA before the in-scope PRs were opened, and then
  went back to development or got a comment (other than a `## QA handoff`), the PRs answer QA's
  feedback. The issue goes to QA again, with no cold reader, even when it has no usable steps,
  says `No QA needed`, or already sits in Ready to be released. A QA round that ended cleanly
  (QA → Ready to be released, no comments) does not count. The PR query now reads `createdAt`.

## 0.21.0 — 2026-11-16

### Changed

- **`/qa-or-release` works on the checked-out PR, not on issue ids.** It takes the PR of the
  current branch, or every PR of its stack (`gh stack view --json`, else the PRs' base chain), and
  routes the human issues those PRs link. It takes no ids; `dry-run` stays.
- **It routes an issue only after its PRs are merged or in the merge queue.** It checks each PR
  through GraphQL (`merged`, `isInMergeQueue`). An issue with a PR that is neither is skipped and
  named in the report; the rest of the run continues.

### Added

- **`/qa-or-release` deletes the remote branch of each merged PR.** It keeps the branch of a
  queued or unmerged PR, a cross-repository PR, the integration or default branch, and a branch an
  open PR still uses as its base. A branch already gone is a no-op. A failed delete is reported
  and never stops the run. Local branches are never deleted.

## 0.20.0 — 2026-11-16

### Added

- **`/qa-or-release` routes a finished issue to QA or Ready to be released.** It moves the issue to
  QA when the issue (its description or its `## QA handoff` comment) has clear steps a designer or
  PM can follow in the product's own screens to check the acceptance criteria. Otherwise, including
  a `No QA needed` handoff, it moves the issue to Ready to be released. One fresh
  `magnus:cold-reader` per issue judges the steps as a non-technical tester, using only the issue's
  text. The skill writes the status only, never a comment. It skips issues that are not started,
  already closed or generated (PRD and slice tickets). It flags a visible change that had no usable
  steps. With no id it takes the issue the current branch's PR links. `dry-run` previews.
  `/work-issue` and `/feature-goal` never call it: their PRs are still drafts awaiting human review
  when they hand off. They keep moving the human ticket to Dev technical review.
- **`tracker.statuses.qa` and `tracker.statuses.readyForRelease`** name those two statuses. When
  empty, the skill looks for the team's one status named `QA` and one named like
  `Ready to be released`. It stops when it finds none or several.

## 0.19.0 — 2026-11-16

### Fixed

- **Cloud adversarial review reads the result from a file, not only the transcript.** The Codex
  reviewer session in the current workspace now writes its JSON result to a gitignored handoff
  file, `.context/adversarial-review/result-<token>.json`, and the runner reads that first. The
  transcript stays the fallback and now accepts a reply wrapped in a ```json fence. When `.context`
  is not gitignored, the runner asks for no file and uses the transcript.
- **A failed reviewer turn names its cause.** An expired Codex login in the cloud used to end as
  "Conductor completed without an assistant review result". The runner now reports
  `the codex reviewer session failed: <provider error>`.
- **The skill says who runs the review.** The host runs the runner itself, and only the runner
  starts the reviewer: a session with the *other* provider's agent in the current workspace. Hosts
  had started a Claude session to "hand the review to Codex", hand-written their own
  `conductor session create` and told the user to run the skill. All of that is now ruled out in
  the skill, and asking for "a Codex review" counts as an explicit request. (The "cannot be used
  with Skill tool" refusal came from 0.15.1, where the skill still had
  `disable-model-invocation: true`; 0.16.0 already lifted it.)

### Added

- **Gate 5 outcomes are kept on disk, like the roster rounds' findings files.** A blocked Gate 5
  writes `.context/<slice>/round-<N>/adversarial-blocked.json` with its errors and the runner's
  stderr. A passing one already wrote `adversarial-result.json`. A passing retry removes the stale
  blocked file. The standalone `/adversarial-review` writes its report to
  `.context/adversarial-review/<HEAD>.md`.

## 0.18.0 — 2026-11-13

### Changed

- **Claude reviewers run Opus 5.5 at medium effort.** Cloud review rounds were running on Fable,
  which is meant only for grilling and wayfinder. The engine never asked for Fable: a spawn that
  passed no `model`, and other plugins' `model: inherit` reviewers, inherited the session's model.
  - The engine's Claude `reviewer` role is now `opus` at `medium`. Every vendored read-only agent
    pins `model: opus` + `effort: medium`; `design-iterator`, a writer, keeps `high`. The Codex
    reviewer, also used by Gate 5, keeps `gpt-6.1-sol` at `high`.
  - Reviewer and validator tasks take effort from the role, not the agent file. A test keeps the
    frontmatter in step with the role.
  - The runtime contract and the engine's next-step text pass `model` = `execution.claude.model`
    on every Claude native spawn, so no worker inherits the session's model.

### Fixed

- **Review rounds spawn this plugin's reviewers, not another plugin's.** In cloud workspaces the
  team's `dev@melatech` plugin is installed too, and its reviewers share names and descriptions with
  ours. The engine named each reviewer task by its bare roster id (`code-reviewer`), so the main
  agent often spawned melatech's reviewer instead.
  - Every task with a persona now carries `subagentType` (`magnus:<id>`). The runtime contract and
    the `work-slice`, `iterate-pr` and `review-code` task instructions spawn exactly that subagent.
  - The 14 roster agents and the relevance validator end with a marked persona-proof section.
    Their reports carry `"persona": "magnus:<id>"`. `collect` treats a reviewer report without it
    as invalid, and `decide` refuses validator verdicts without it. The round then re-runs the task
    instead of counting another agent's review as coverage.
  - Neither the melatech plugin nor the cloud image changes.

## 0.17.0 — 2026-11-13

### Changed

- **QA handoffs are written for designers and PMs.** Handoffs still came out too technical.
  `qa-handoff.md` now sorts every acceptance criterion first: only what a non-technical person
  can check in the product's own screens becomes a QA step. Everything else is proven by the
  automated tests shipped with the PR, and no human is asked to check it.
  - The implement step must prove every criterion that a non-technical person cannot check
    with an automated test (unit, integration or end-to-end).
  - A change with nothing for QA to test gets a one-sentence `No QA needed` handoff with no
    steps and no media.
  - Before posting, one fresh `cold-reader` reads the draft as a designer. Every word, step or
    expected result it does not understand is rewritten or dropped.
  - Template headings name what the user does or sees, never criterion numbers. Routes, URL
    paths and more developer words are banned.

## 0.16.1 — 2026-11-13

### Fixed

- **Local Gate 5 reviews work in repos that link skills.** The local adversarial-review runner
  refused any tracked symlink, so every review of a repo exposing `.claude/skills` to Codex
  through `.agents/skills/<name>` links stopped before the reviewer ran. The snapshot now
  recreates a symlink whose target resolves inside `HEAD`'s tree as the same relative link, so
  the reviewer can read every skill. Absolute, escaping and dangling links still block the review.

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
