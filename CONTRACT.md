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
| `pr.botReviewer` | string | `''` → skip | PR review bot; gets exactly **one** review round per PR |
| `pr.cliReviewer` | string | `''` → skip | review CLI; joins only the **first** reviewer round of a loop |

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
  into the PR comment and QA evidence unfixed.

### `routing` — slice agent routing

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `routing.labelPrefix` | string | `''` → routing disabled | tracker-label prefix for reserving a slice to an agent (`agent:` → `agent:claude`) |
| `routing.frontendAgent` | string | `''` → no stamping | agent name `magnus:to-issues` stamps on frontend-dominant slices (paths judged by `areaPaths.frontend`) |
| `routing.delegate` | agent → command template | `{}` → report/skip, never delegate | headless invocation per agent, e.g. `{"claude": "claude -p \"<prompt>\" --permission-mode acceptEdits", "codex": "codex exec \"<prompt>\""}` — local-mode machinery |
| `routing.dispatch` | string | `'cloud'` | where `magnus:feature-goal` runs the slice loop: `cloud` → one Conductor cloud workspace per slice via the Conductor MCP (falls back to `local` when the MCP is unreachable); `local` → the sequential single-worktree loop |

Different agents have different strengths (e.g. Claude at frontend). With
routing configured, `magnus:to-issues` stamps `<labelPrefix><agent>` on slices
reserved for a specific agent; `magnus:work-slice` refuses a slice reserved
for an agent other than its own runtime; `magnus:feature-goal` either
delegates such a slice via `routing.delegate` (child process running
`/work-slice`, verified afterwards from durable markers) or ends the
invocation naming which agent the slice waits on. Routing is **slice-granular
only** — never per-step or per-file. The suite's durable markers (checkpoint
files, ledger, PR state) are what make a slice resumable by any agent.

`routing.dispatch` decides the venue, not the agent: with the default
`cloud`, `magnus:feature-goal` creates one Conductor **cloud** workspace per
slice (Conductor MCP `create_workspace`) and the `<AGENT:>` label picks that
workspace's agent — `routing.delegate` is only consulted in `local` mode.
Each cloud workspace self-bootstraps: its first session installs this plugin
in the fresh sandbox, then a second session runs `/work-slice` (skills load
only at session start). The host repo's shared Conductor settings are never
touched, so the plugin stays personal to the dispatching user.
Only `feature-goal` auto-dispatches; the standalone commands (`work-issue`,
`solve-ready-tickets`, `daily-ticket-manager`) are venue-neutral and run
wherever the user starts them.

### Review targeting

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `areaPaths` | area → (regex source \| `{re, flags}`)[] | language-generic patterns | which risk areas a diff triggers (feeds reviewer selection + the overlay) |
| `reviewers` | area → `{skills, focus}` | generic lens per area, naming no framework/path/skill | an **additive focus overlay** appended to the prompts of the roster reviewers covering that area |

**The reviewer roster in `agents/` is the lane source, not this key.** The
engine (`engine/lib/roster.mjs`) selects reviewers from the vendored
kramme-cc-workflow roster — an always-on tier (code-reviewer,
silent-failure-hunter, deslop-reviewer), a round-1 tier (lean-reviewer,
code-simplifier, codebase-pattern-reviewer in diff reuse audit mode), and
mechanically-triggered conditionals (tests, types, removals, conventions,
overengineering, performance, the four-agent security bundle, a11y/copy).
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
`gh pr diff <n>` for a PR reviewed without a checkout). `plan` accepts
`--coderabbit-cmd '<cmd>'` / `--no-coderabbit` to match the CLI-reviewer
invocation to the target, and `collect` lists reviewers whose output file is
`missing` (re-run once, re-collect, or state degraded coverage).

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
