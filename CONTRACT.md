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
| `docs/agents/repo-config.md` | **the one required file** — its `## Config` JSON block supplies every key below | every key falls back to the generic default; skills say so once |
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
| `tracker.statuses` | `{readyForDev, inProgress, inReview, done}` | all `''` | status names the skills move issues between |

### `labels`

`agentReady`, `needsHuman`, `sliceNext`, `managerSkip`, `typePrefix`,
`riskPrefix`, `docPath`. Default: all `''` except `typePrefix: 'type:'` and
`riskPrefix: 'risk:'`.

A label left empty **disables the machinery that rides on it** — no
`sliceNext` means the slice pointer is carried by the user instead; no
`agentReady` means `magnus:solve-ready-tickets` has no queue to drain and says
so.

### `pr`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pr.titleRule` | string | `''` | title format, e.g. `<type>[(<scope>)]: SER-XX <subject>` |
| `pr.scopes` | string[] | `[]` | allowed scopes in that rule |
| `pr.stackTool` | string | `''` → plain branches | stacking CLI (`gh-stack`) |
| `pr.botReviewer` | string | `''` → phase skipped | the **review-request** bot (e.g. `Copilot`); `magnus:babysit-stack` requests it and runs request → wait → fix → re-request rounds until it is satisfied (cap 5 rounds per PR) |
| `pr.commentReviewer` | `{login, command}` | both `''` → phase skipped | the **comment-summoned** bot, run after `botReviewer` is satisfied — e.g. `{"login": "coderabbitai[bot]", "command": "@coderabbitai review"}`; babysit posts `command` as a PR comment, waits for a review by `login`, fixes, re-summons, until satisfied (same cap) |
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
- **`## Visual verification`** — one sentence on how the captures were made
  (stack, Playwright, viewport, seeded user, fake data), then one scene per
  changed surface: before/after pair for a changed surface, single image for a
  new one, GIF for a flow — each captioned with surface, route and viewport
  width. Before shots are taken at the base before the implement pass; after
  shots in the final Playwright round. Media is committed to `pr.mediaBranch`
  under `pr/<n>/` and referenced by commit sha. Internal-only changes and
  uncapturable surfaces get a one-line section saying so — never an omission,
  never a substitute image presented as the real surface.

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

`devServerCommand`, `e2eDir`, `browserGuidePath` — all `''` by default. With
`devServerCommand` empty the Playwright user-story reviewer is **skipped** and
the run says so rather than inventing a start command.

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
  into the PR body's `## Visual verification` and the QA evidence unfixed.

### `routing` — slice agent routing

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `routing.labelPrefix` | string | `''` → routing disabled | tracker-label prefix for reserving a slice to an agent (`agent:` → `agent:claude`) |
| `routing.frontendAgent` | string | `''` → no stamping | agent name `magnus:to-issues` stamps on frontend-dominant slices (paths judged by `areaPaths.frontend`) |
| `routing.delegate` | agent → command template | `{}` → report/skip, never delegate | headless invocation per agent, e.g. `{"claude": "claude -p \"<prompt>\" --permission-mode acceptEdits", "codex": "codex exec \"<prompt>\""}` — local-mode machinery |
| `routing.dispatch` | string | `'cloud'` | where `magnus:feature-goal` runs everything after planning (slice loop + babysit): `cloud` → **one** Conductor cloud pipeline workspace for the stack and a **fresh session per PR** (a relay: each session works one slice to a linked draft PR, babysits that PR to GOAL MET, starts the next session and ends; the last starts the stack-wide babysit session), created via the Conductor MCP or the `conductor` CLI (falls back to `local` when neither is reachable); `local` (opt-in) → the sequential single-worktree loop, one fresh subagent per slice |
| `routing.cloudModels` | agent → `{model, effort}` | `{"claude": {"model": "opus-5-1m", "effort": "xhigh"}, "codex": {"model": "gpt-5.6-sol", "effort": "xhigh"}}` | Conductor model + effort `magnus:feature-goal` passes on every cloud session it creates (`create_workspace` and every relay `create_session`), keyed by the session's agent; an agent key set to `{}` → Conductor's own default for that agent. A host's per-agent object replaces the default one wholesale. Implementer-side only — reviewer subagents use the roster files' own pins |
| `routing.codexModelAliases` | alias → codex model | `{"sonnet": "gpt-5.6-terra", "opus": "gpt-5.6-sol"}` | roster files pin reviewer models with Claude alias names; a Codex runtime maps each task's emitted alias through this table for its `codex exec` children (the task's `effort` passes through unchanged). Unmapped alias → the child runs on the session model, disclosed once |

Different agents have different strengths (e.g. Claude at frontend). With
routing configured, `magnus:to-issues` stamps `<labelPrefix><agent>` on slices
reserved for a specific agent; `magnus:work-slice` refuses a slice reserved
for an agent other than its own runtime; `magnus:feature-goal` either
delegates such a slice via `routing.delegate` (child process running
`/work-slice`, verified afterwards from durable markers) or ends the
invocation naming which agent the slice waits on. Routing is **slice-granular
only** — never per-step or per-file. The suite's durable markers (checkpoint
files, ledger, PR state) are what make a slice resumable by any agent.

`routing.dispatch` decides the venue, not the agent: by default (`cloud`)
`magnus:feature-goal` leaves the planning session once planning is done —
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
babysit session in the same workspace. No session ever outlives
one PR. Opting into `local` runs the sequential single-worktree loop with a
fresh subagent per slice and consults `routing.delegate` for slices reserved
for another agent (no delegate → it works the slice itself and discloses that
on the PR — the pipeline never waits on a human after the grill).
The pipeline workspace bootstraps once: its first session installs this
plugin and `gh-stack` in the fresh sandbox (skills load only at session
start), then the relay sessions run `/feature-goal <ISSUE>` and re-detect the
stage. The host repo's shared Conductor settings are never touched, so the
plugin stays personal to the dispatching user.
`solve-ready-tickets` is the other cloud dispatcher, fanning **out** rather than
relaying along: one workspace per `agentReady` ticket, named `<ISSUE> <slug>`
(the name is the ownership marker — there is no dispatch comment on a
human-facing ticket), bootstrap session, then one session whose entire prompt is
`/work-issue <ISSUE>`. It dispatches and ends; a re-run sweeps those workspaces.
`work-issue` and `daily-ticket-manager` stay venue-neutral and run wherever the
user starts them.

### Tracker audiences

The tracker is documentation for the user + AI **and** the handoff surface for
QA, who has no code access — never a dev log
(`skills/work-slice/references/qa-handoff.md`):

- **Feature ticket** — the human's ticket (PM, designers, QA): the suite
  writes labels and, **only once the stack is GOAL MET**, exactly one
  **`## QA handoff`** comment: per acceptance criterion (grouped where one
  walk-through covers several) the steps in user terms, the expected
  result, and one embedded visual per group — under ~150 words of prose.
  Nothing else suite-authored, ever, and nothing before the PRs are done (a
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
reviewers whose output file is `missing` (re-run once, re-collect, or state
degraded coverage).

Run state lives in the host repo's gitignored `.context/<slice-id>/`:
`ledger.json` (the ledger + loop state), `contract.md` (the run contract),
`round-N/prompts/` (emitted task prompts), `round-N/findings/` (the findings
inbox reviewers write JSON into), fix/validator/adjudication artifacts beside
them. `node --test '<plugin-root>/engine/test/*.test.mjs'` covers the loop.

**Fan-out is mechanism-agnostic.** `plan` emits one task prompt per selected
reviewer plus the matching roster file in `agents/`; the host runs them however
its runtime allows — Claude spawns subagents (in parallel) from the agent
definitions, Codex spawns background `codex exec` children with the agent-file
body as the system prompt, and inline-sequential is the disclosed fallback.
Either way every reviewer writes its findings JSON to the `outputFile` the
manifest names, and `collect` ingests them identically. Losing parallelism is
never a licence to drop a reviewer.

**Writers are one fresh agent per pass.** The same ladder carries every
code-editing pass — the implement pass, each gate-fix, each round's fix, the
closeout adjudicator, and a skill's own fix passes (Playwright rounds,
`magnus:babysit-stack`'s CI and thread fixes). The CLI holds no agent handles:
it emits a prompt file, the host spawns something to run it, and the result
comes back as JSON. Hosts must keep it that way — never continue, re-prompt or
resume a spent pass's agent, so round N never inherits round N-1's reasoning.
Handoff between passes is files only (`contract.md`, the emitted prompt, prior
result JSONs). With no spawn mechanism at all, inline is the disclosed
fallback: each pass re-reads its prompt as a fresh persona, and the degraded
isolation is stated once.
