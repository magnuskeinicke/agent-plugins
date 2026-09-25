# Host-repo contract

**This plugin is HOW** — loops, gates, review machinery, stack mechanics, ticket
choreography. **The host repo is WHAT** — its branch, tracker, labels, gate
commands, conventions, reviewer lenses, exemplars, domain language.

Skills read well-known paths in the host repo and degrade gracefully when a file
or key is absent. Nothing host-shaped is ever baked into the plugin: the
built-in fallbacks in `engine/lib/defaults.mjs` are deliberately generic,
so a missing key costs you sharpness, never correctness-in-another-repo's-terms.

Scaffold a fresh repo's half of this contract with **`/magnus:init-repo`**.

## Files a host repo provides

| Path | Purpose | Absent → |
| --- | --- | --- |
| `docs/agents/repo-config.md` | **the one required file** — its `## Config` JSON block supplies every key below | absent file/empty values use defaults; existing malformed config is a blocking error |
| `CONTEXT.md` | domain glossary; extended by `magnus:grill-with-docs` | skills skip domain-language checks |
| `docs/adr/` | architecture decision records (`0001-slug.md`, …) | no ADR cross-checks, no ADR writes |
| `docs/agents/issue-tracker.md` | prose rules for the tracker (`tracker.docPath`) | skills work from the `tracker` key alone |
| `docs/agents/triage-labels.md` | prose ownership rules for the managed labels (`labels.docPath`) | skills work from the `labels` key alone |
| the file named by `conventionsFile` | the repo's written conventions, cited by every reviewer | reviewers fall back to the diff's own idiom |

`docs/agents/repo-config.md` must contain a fenced ```json block under a
`## Config` heading. The engine CLI reads that file itself (`--config`,
defaulting to `docs/agents/repo-config.md` in the working directory); skills
apply the same values directly wherever they act without the CLI.

## Config keys

Every key is optional. The **Default** column is what `engine/lib/defaults.mjs`
supplies; `resolveRepoConfig()` in `engine/lib/config.mjs` merges the host's
values over it two levels deep, so partial objects are fine (set
`reviewers.database` and the other five lanes keep the generic lens).

### Repo shape

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `integrationBranch` | string | `''` → `origin/HEAD` | branch PRs merge into and stacks base off |
| `sourceDirs` | string[] | `[]` → whole tree | roots a reuse search starts from; dirs that must be free of untracked files before a push |
| `conventionsFile` | string | `CLAUDE.md` | the repo's written conventions |

### `gates`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `gates.all` | string | `''` → discover | the definition-of-done command (lint + test + build) |
| `gates.format` | string | `''` | formatting check |
| `gates.test` | string | `''` | narrow per-project test form |
| `gates.traps` | string[] | `[]` | repo-specific ways these commands lie; shown verbatim to implementers and reviewers |

With `gates.all` empty, a skill discovers the commands (package manifest, CI
config) and **names which it used** rather than guessing silently.

### `tracker`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tracker.kind` | `'linear' \| 'github' \| ''` | `''` → GitHub Issues via `gh` | which tracker to talk to |
| `tracker.team` / `tracker.teamId` | string | `''` | team scope for tracker queries |
| `tracker.issuePrefix` | string | `''` | issue-id prefix (`SER` → `SER-1234`); also the PR-title prefix |
| `tracker.docPath` | string | `docs/agents/issue-tracker.md` | prose rules |
| `tracker.statuses` | `{readyForDev, inProgress, inReview, done}` | all `''` → discover from tracker | workflow status names: `inProgress` = Dev in progress, `inReview` = Dev technical review for the human parent, `done` = Done for generated internal descendants |

### `labels`

`agentReady`, `needsHuman`, `sliceNext`, `managerSkip`, `typePrefix`,
`riskPrefix`, `docPath`. Default: all `''` except `typePrefix: 'type:'` and
`riskPrefix: 'risk:'`.

Empty labels generally disable the machinery that uses them; for example,
without `sliceNext` the user supplies the next slice. `solve-ready-tickets`
uses `agent:ready` when `labels.agentReady` is empty, and supplies the resolved
trigger in each worker's separate pinned dispatch config. A configured value
overrides that trigger. Standalone `work-issue` keeps its existing behavior:
without `labels.agentReady`, it judges leanness itself and infers no claim label.

### `pr`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pr.titleRule` | string | `''` | title format, e.g. `<type>[(<scope>)]: SER-XX <subject>` |
| `pr.scopes` | string[] | `[]` | allowed scopes in that rule |
| `pr.stackTool` | string | `''` → plain branches | stacking CLI (`gh-stack`) |
| `pr.botReviewer` | string | `''` → phase skipped | the **review-request** bot (e.g. `Copilot`); `magnus:babysit-stack` requests it and runs request → wait → fix → re-request rounds until it is satisfied (cap 5 rounds per PR) |
| `pr.commentReviewer` | `{login, command}` | both `''` → phase skipped | the **comment-summoned terminal reviewer**, run after `botReviewer` is satisfied — e.g. `{"login": "coderabbitai[bot]", "command": "@coderabbitai review"}`; babysit posts `command` as a PR comment, waits for a review by `login`, fixes, and re-summons that bot without returning to `botReviewer`, until satisfied (same cap) |
| `pr.mediaBranch` | string | `'pr-media'` | orphan branch the suite commits PR evidence media to (`pr/<n>/…`), referenced from PR bodies by commit sha; created on first publish, never merged, carries no workflows |

Bot reviews happen **on GitHub only**. There is no review-CLI lane in the review
loop; a bot's findings reach the suite as PR review threads, which
`magnus:babysit-stack` addresses with fresh fix agents.

### PR evidence

The PR **body** is the suite's only voice on a PR — it posts **no comments** on
its own PRs (bar the machinery `magnus:babysit-stack` needs: the
`pr.commentReviewer` summon and the one-line replies that resolve bot threads).
The body is written for a human reviewer only. Its sections, after the PR
skill's own summary and before any trailer — the spec is
`skills/work-slice/references/pr-evidence.md`:

- **`## Verification`** — a `Check | Result` table of every terminal check run
  against the head (tests, builds, typecheck, lint, manual runs), commands
  verbatim, results from the actual output; a second table lists checks left to
  CI. Rows are appended to `.context/<run-id>/evidence/verification.jsonl` as
  the gates run — a row exists only for a command that ran.
- **`## Visual verification`** — written **only after `/babysit-stack` reports
  GOAL MET**, by the capture stage: one sentence on how the captures were made
  (stack, Playwright, viewport, seeded user), then the fewest scenes that prove
  the change (1–3): a still for appearance, a GIF for a flow, each captioned
  with surface, route and viewport dimensions. All evidence uses a complete
  `1920 × 1080` desktop viewport at 1× scale, including video/GIF frames; no
  mobile variants, other resolutions, or element crops. Scenes show the **finished state** —
  there are no before shots, and nothing visual is captured before the verdict.
  Media is committed to `pr.mediaBranch` under `pr/<n>/`, referenced by commit
  sha, and re-used verbatim by the tracker's `## QA handoff` — one capture per
  PR, two places, never a third. Internal-only changes and uncapturable surfaces
  get a one-line section saying so — never an omission, never a substitute image
  presented as the real surface.

- **`## Notes`** — omitted unless a human must act on something. At most five
  one-line bullets: an assumption taken where the ticket left a decision open, a
  finding shipped unfixed, a leanness concern, a follow-up ticket filed instead
  of widening the diff.

The host's `skills.createPr` receives the rendered sections as its
verification content; when it has no slot for them the suite makes exactly one
`gh pr edit --body-file` insert before any bot is requested. `magnus:iterate-pr`
and `magnus:babysit-stack` refresh the `## Verification` block for the head they
push. The convention provenance table, the review ledger (`CR-NNN` entries,
dispute evidence, adjudication rulings), reviewer rosters and routing
disclosures never reach the PR at all — they stay in `.context/<run-id>/` and
the run's terminal report.

### `skills`

Which of the *host repo's own* skills the suite hands off to:
`createIssue`, `createPr`, `startWork`, `migrations`, `i18n`, `e2e`,
`prototype`. Default `''` each — an empty value means "no handoff, do it
inline". The plugin never assumes a repo skill exists.

### Browser verification

`devServerCommand`, `e2eDir`, `browserGuidePath` — all `''` by default. Inside
Conductor, the repo's `.conductor/settings.toml` run script for the current
environment (`available_in` matching `CONDUCTOR_IS_LOCAL`) starts the app and
wins over `devServerCommand`, which is the fallback outside Conductor
([run-app.md](skills/work-slice/references/run-app.md)). With neither, the
Playwright user-story reviewer is **skipped** and the run says so rather than
inventing a start command. `e2eDir` supplies the dev-login pattern only: the
suite never lets the e2e Playwright config (its `webServer`, e2e build or env
files) start or configure the app it verifies or captures.

### `design` — fidelity extension point

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `design.fidelityCheck` | string | `''` → the step doesn't exist | a **repo-local** skill (or command) that judges implemented UI against the design source |

Design-fidelity mechanics live in the **host repo**, never the plugin — Figma
(or any design tool) is not guaranteed anywhere, and the screen↔route mapping
is repo data by nature. When the key is set, `magnus:work-slice` invokes it
during the Playwright verify rounds on UI slices. The contract:

- **Input:** the slice's routes/screens under verification, its acceptance
  criteria, and the design deep-links from the slice ticket.
- **Output:** JSON `{"deviations": [{"screen", "designRef", "severity":
  "blocking"|"advisory", "description", "screenshot"}]}` — an empty array means
  fidelity holds. Comparison should be model judgment, never pixel diffing
  (seeded data differs from design content by construction).
- **Semantics:** a `blocking` deviation is treated exactly like a failed
  acceptance criterion (same fix rounds, same caps); `advisory` deviations ride
  into the QA evidence and, once the capture stage runs, the PR body's
  `## Visual verification`, unfixed.

### `routing` — slice agent routing

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `routing.labelPrefix` | string | `''` → routing disabled | tracker-label prefix for reserving a slice to an agent (`agent:` → `agent:claude`) |
| `routing.frontendAgent` | string | `''` → no stamping | agent name `magnus:to-issues` stamps on frontend-dominant slices (paths judged by `areaPaths.frontend`) |
| `routing.delegate` | runtime → command template | `{}` → disclosed current-runtime fallback | local full-slice delegation; prepare the branch first, pass the complete bounded handoff via stdin/message file and explicit resolved model/effort; preflight tools and never interpolate prompt text into shell code |
| `routing.dispatch` | string | `'cloud'` | where `magnus:feature-goal` runs everything after planning (slice loop + babysit): `cloud` → **one** Conductor cloud pipeline workspace for the stack and a **fresh session per PR** (a relay: each session works one slice to a linked draft PR, babysits that PR to GOAL MET, starts the next session and ends; the last starts the stack-wide babysit session), created via the Conductor MCP or the `conductor` CLI (falls back to `local` when neither is reachable); `local` (opt-in) → the sequential single-worktree loop, one fresh subagent per slice |
| `routing.models` | role → runtime → profile | `engine/lib/models.mjs` | explicit model/effort/access/timeout for every worker; profile may override `model`, `effort`, `cloudModel`, `access`, `timeoutMs`; see [runtime contract](skills/work-slice/references/runtime.md) |
| `routing.cloudModels` | runtime → `{model, effort}` | Claude `opus-5-5-1m`/`xhigh`; Codex `gpt-6-sol`/`xhigh` | legacy planner/implementer/fixer cloud overrides; explicit role profiles take precedence; `{}` retains registry defaults |
| `routing.codexModelAliases` | alias → Codex model | `sonnet` → `gpt-5.6-terra`, `opus` → `gpt-6-sol` | preserves roster Claude pins while translating Codex workers; unmapped aliases fail instead of silently inheriting |

Routing labels select a runtime when the dispatcher creates a session. A direct
`work-slice` invocation in a different runtime proceeds with the mismatch
recorded on the slice, provided its required tools are available. Local pipeline
`routing.delegate` can select a different runtime for the full slice; without a
delegate, disclose the fallback. Models within either runtime come from the
shared role registry. Durable checkpoints and result files allow either runtime
to resume work.

`routing.dispatch` decides the venue, not the agent: by default (`cloud`)
`magnus:feature-goal` moves implementation to the pipeline workspace after planning and the caller then stops —
**one** Conductor cloud pipeline workspace for the stack (Conductor MCP
`create_workspace`, or the workspace the grilling session was handed off to),
then a **relay of fresh sessions**: each session works exactly one slice to a
stacked draft PR (`gh stack` branch on the predecessor, PR by the repo's PR
skill, `gh stack link` by number — one linear GitHub stack in stack order),
babysits that PR to GOAL MET (`/babysit-stack <PR>`: CI, `pr.botReviewer`
rounds, `pr.commentReviewer` rounds, threads — so the next layer is cut on a
reviewed PR; NOT MET blocks the relay), starts the next session
(`create_session` / `conductor session create`, the `<AGENT:>` label picking
that session's agent) and ends; the last PR session starts the stack-wide
babysit session in the same workspace. No PR worker handles more than one PR. The relay is self-propelling: the caller ends its run once a worker is confirmed working, and a later invocation reconciles the relay in one step (crash recovery, queued tracker writes, terminal verdict). Nothing runs locally while the cloud works. Opting into `local` runs the sequential single-worktree loop with a
fresh subagent per slice and consults `routing.delegate` for slices reserved
for another agent (no delegate → it works the slice itself and discloses that
on the PR — the pipeline never waits on a human after the grill).
The pipeline workspace bootstraps once: its first session installs this
plugin for every selected runtime and `gh-stack` in the fresh sandbox, checks actual tools in fresh sessions, and transfers the immutable planning config (skills load only at session
start), then the relay sessions run `/feature-goal <ISSUE>` and re-detect the
stage. The host repo's shared Conductor settings are never touched, so the
plugin stays personal to the dispatching user.
`solve-ready-tickets` dispatches by default; `dry-run` previews and optional
`max N` caps new workspaces. It selects the repo's unclaimed `agent:ready` issues
(or configured `labels.agentReady`), without implicit assignee or ready-for-dev
filters, then triages them. It creates one workspace per eligible ticket, named `<ISSUE> <slug>`
(the name is the ownership marker — there is no dispatch comment on a
human-facing ticket), bootstrap session, then one session whose entire prompt is
`/work-issue <ISSUE>`. It confirms each session started, reports the deep links and ends; a later run adopts the same supervisor state, recovering one silent crash per worker and flushing denied tracker writes.
The trigger label never selects a runtime, even when routing uses the `agent:`
prefix. `work-issue` owns the claim and the full development/review/QA loop.
`work-issue` and `daily-ticket-manager` stay venue-neutral and run wherever the
user starts them.

### Tracker audiences

`skills/work-slice/references/issue-lifecycle.md` owns the shared lifecycle:
`feature-goal` claims the human parent at entry (or creation), and `work-issue`
claims it after preflight. Preserve/resolve the assignee, remove `agentReady`,
and move it to `tracker.statuses.inProgress`. Every PR body links the human
parent and its corresponding generated issue; each stack PR names its own
slice plus the PRD. Use non-closing references so merging cannot auto-close the
parent. After the entire deliverable is babysat green and its QA handoff is
published, move all workflow-generated descendants (including the PRD) to
`done`, then the human parent to `inReview`. Generated tickets need no human
review. Preserve unrelated human children and unfinished follow-up tickets.
Read back statuses and PR links before declaring completion; denied writes
stay pending across cloud handoffs and re-entry.

The tracker is documentation for the user + AI **and** the handoff surface for
QA, who has no code access — never a dev log
(`skills/work-slice/references/qa-handoff.md`):

- **Feature ticket** — the human's ticket (PM, designers, QA): the suite
  writes claim/assignee fields, status, labels and, **only once the stack is GOAL MET**, exactly one
  **`## QA handoff`** comment: per acceptance criterion (grouped where one
  walk-through covers several) the steps in user terms, the expected
  result, and one embedded visual per group — under ~150 words of prose.
  No other suite comment, and no comment before the PRs are done (a
  handoff written earlier goes stale on the next bot round). Re-runs **edit
  that comment by id**; a second suite comment is a defect.
- **PRD ticket** — a `PRD: <feature title>` sub-issue of the feature ticket
  created by `magnus:to-prd`; its description is the PRD, its
  `## Implementation deltas` comment amends it; every slice is its
  sub-issue. Dev-owned.
- **Slice sub-issues** — children of the PRD ticket, internal to the user + AI; the machinery writes what
  it needs there (skeleton map, dispatch markers, assumptions, dev-form QA
  evidence).
- **Standalone tickets** (`magnus:work-issue`, and whatever
  `magnus:solve-ready-tickets` dispatches into a cloud workspace) — QA-visible:
  the same single `## QA handoff`, written by the `work-issue` run after it has
  babysat its own PR to GOAL MET. The one exception to the single-comment rule is
  the dispatcher's three-line decline note on a ticket it refused to dispatch,
  which `magnus:daily-ticket-manager` re-triages on. The dispatcher writes
  nothing else on a ticket and never claims one; `magnus:daily-ticket-manager`
  writes labels only. Assumptions, leanness concerns, verdicts, provenance,
  verification and consolidation lists never touch the tracker.

Evidence on the tracker is **visual only and embedded inline** (video for
behaviour, a still for appearance, never both of the same thing, 1–3 per
handoff): upload the file and put the returned asset URL in the comment
markdown. Never file it as a tracker attachment (Linear:
`create_attachment_from_upload`) — a resource in the attachments panel is a
download, not evidence — and never a GitHub raw URL. Test runs and gate output
are developer evidence and live in the PR body's `## Verification`.

### Human gates

The pipeline has exactly **one** human gate: the grilling session at the top
of `magnus:feature-goal`. `magnus:to-prd` and `magnus:to-issues` run in
*pipeline mode* under it (no seam confirmation, no breakdown quiz, no `<HITL>`
slices — undecided points become `## Assumptions` on the PRD / slice / PR).
`magnus:work-slice` and `magnus:work-issue` have no human gates at all: a
`labels.needsHuman` label is a decision to make and record, not a stop. Every
PR-producing skill ends by running `magnus:babysit-stack` to a terminal
verdict; the only things that end a run early are safety stops (dirty
worktree, no diff, gut-check hard-stop) and `needs-human` escalations —
judgement-call review threads, a stuck bot, an exhausted fix cap.

### Review targeting

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `areaPaths` | area → (regex source \| `{re, flags}`)[] | language-generic patterns | which risk areas a diff triggers (feeds reviewer selection + the overlay) |
| `reviewers` | area → `{skills, focus}` | generic lens per area, naming no framework/path/skill | an **additive focus overlay** appended to the prompts of the roster reviewers covering that area |

**The reviewer roster in `agents/` is the lane source, not this key.** The
engine (`engine/lib/roster.mjs`) selects reviewers from the vendored
kramme-cc-workflow roster — an always-on tier (code-reviewer,
silent-failure-hunter, deslop-reviewer), a round-1 tier (lean-reviewer,
code-simplifier, comment-analyzer, codebase-pattern-reviewer in diff reuse
audit mode), and mechanically-triggered conditionals (tests, types, removals,
conventions, overengineering, performance, the four-agent security bundle,
a11y/copy).
Whatever a host writes under `reviewers.<area>` sharpens the prompts of the
reviewers covering that area; it never adds, removes, or replaces a lane.

Areas: `frontend`, `backend`, `database`, `i18n`, `security`, `performance`.
`performance` has no path triggers (it is force-added whenever `frontend`
triggers); `security` is force-added whenever `backend` triggers.

### Exemplars

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `goldenPaths` | layer → file | `{}` | canonical "mirror this" exemplar per layer; **binding** for implementers, deviations declared in the PR provenance table. `magnus:to-issues` writes back entries it pins. |
| `libMap` | lib path → one-line purpose | `{}` | the reuse reviewer's search index; empty means it searches `sourceDirs` blind |

## The engine CLI

The review machinery is a dependency-free Node CLI at `engine/cli.mjs`
(config resolution, area mapping, roster selection, finding schemas, the
finding ledger, prompt emission, classification thresholds, stall/cap stop
conditions, the closeout adjudicator). **Loop control is deterministic CLI
output, never prose discipline**: the orchestrating agent runs
`node <plugin-root>/engine/cli.mjs <command>` from the host repo root and obeys
the JSON it prints.

```
init → plan → (run pre-pass + reviewers) → collect → (run validator)
     → decide → [fix → apply-fix → plan …] → adjudicate? → report
```

`init` takes three loop-shaping options: `--review-only` (one classified
round, no fix pass — `decide` ends the run with a `clean` / `N blocking
finding(s)` verdict; magnus:review-code), `--max-rounds <1..5>` (a
user-supplied cap under the hard cap; magnus:iterate-pr), and
`--inspect '<cmd>'` (the diff command every prompt cites when the target is
not a committed branch diff — `git diff HEAD` for uncommitted work,
`gh pr diff <n>` for a PR reviewed without a checkout). `collect` lists
reviewers whose output is missing/invalid. Retry once; still incomplete prevents a clean/converged verdict and preserves the pending round for resume.

Run state lives in the host repo's gitignored `.context/<slice-id>/`:
`ledger.json` (the ledger + loop state), `contract.md` (the run contract),
`round-N/prompts/` (emitted task prompts), `round-N/findings/` (the findings
inbox reviewers write JSON into), fix/validator/adjudication artifacts beside
them. `node --test '<plugin-root>/engine/test/*.test.mjs'` covers the loop.

**Worker execution is shared across runtimes.** Each task persists its prompt,
output path, schema, cwd and explicit Claude/Codex execution profiles in a task
manifest. Native Claude subagents keep the vendored personas and tool inheritance;
native Codex workers use the same persona bodies with the Codex profile. The
`engine run --task ... --runtime claude|codex` adapter is the tested CLI fallback.
The parent stores validated JSON, so read-only workers do not need output-file
write permission. Read-only tasks may fan out; writers run serially with fresh
context. Missing worker/tool support blocks the task; no inline persona fallback.

`status` lists unfinished tasks. Config is pinned in the ledger at init and
survives branch changes. Legacy ledgers recover task manifests from their saved
prompts; legacy success without coverage is collected again before trusting it.
Cloud supervision and tracker publication use
[the cloud relay contract](skills/feature-goal/references/cloud-relay.md).

CI and the final configured reviewer are tied to the current PR head. Earlier
reviewers are ordered completion milestones: a later reviewer's current-head
pass covers fixes made after those earlier phases. The GitHub snapshot helper
pages reviews, comments, threads and thread comments before checking the
verdict. Restacks and out-of-band head changes invalidate all review phases.
Media manifests record `sourceHead`; capture once per verified head, refresh
stale manifests after current-head GOAL MET, then update the same PR body and
QA handoff. Scratch cleanup deletes only paths recorded before creation.
