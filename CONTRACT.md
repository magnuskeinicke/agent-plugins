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
