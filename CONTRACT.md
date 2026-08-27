# Host-repo contract

**This plugin is HOW** — loops, gates, review machinery, stack mechanics, ticket
choreography. **The host repo is WHAT** — its branch, tracker, labels, gate
commands, conventions, reviewer lenses, exemplars, domain language.

Skills read well-known paths in the host repo and degrade gracefully when a file
or key is absent. Nothing host-shaped is ever baked into the plugin: the
built-in fallbacks in `shared/repo-config-defaults.js` are deliberately generic,
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
`## Config` heading. Skills read that block and pass it verbatim as `repoConfig`
in the Workflow args, or apply the values directly when running without a
workflow.

## Config keys

Every key is optional. The **Default** column is what `shared/repo-config-defaults.js`
supplies; `resolveRepoConfig()` in `shared/reviewer-engine.js` merges the host's
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
| `areaPaths` | area → (regex source \| `{re, flags}`)[] | language-generic patterns | which area reviewers a diff triggers |
| `reviewers` | area → `{skills, focus}` | generic lens per area, naming no framework/path/skill | what each lane applies and looks for |

Areas: `frontend`, `backend`, `database`, `i18n`, `security`, `performance`.
`performance` has no path triggers (it is force-added whenever `frontend`
triggers); `security` is force-added whenever `backend` triggers.

### Exemplars

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `goldenPaths` | layer → file | `{}` | canonical "mirror this" exemplar per layer; **binding** for implementers, deviations declared in the PR provenance table. `magnus:to-issues` writes back entries it pins. |
| `libMap` | lib path → one-line purpose | `{}` | the reuse reviewer's search index; empty means it searches `sourceDirs` blind |

## Plugin-side shared files

Workflow scripts must be self-contained — the `Workflow` runtime cannot import
files — so `shared/sync.sh` copies these verbatim into each script between
`// >>> shared:<name>` / `// <<< shared:<name>` markers. All three are
plugin-owned; **no host file is ever synced in.**

| File | Block | Contents |
| --- | --- | --- |
| `shared/repo-config-defaults.js` | `repo-config-defaults` | `REPO_CONFIG_DEFAULTS` — the generic fallback for every key above |
| `shared/reviewer-engine.js` | `reviewer-engine` | config resolution, lane composition, finding schemas, the finding ledger, the relevance validator, the closeout adjudicator, the scope-fidelity lane |
| `shared/loop-schemas.js` | `loop-schemas` | structured-output schemas for the implement/fix loops |

```bash
shared/sync.sh            # copy into every workflow script
shared/sync.sh --check    # exit 1 if any target drifted
```

Run it against the plugin **working copy**, never an installed plugin cache dir.

## Codex note

Codex has no `Workflow` tool. The four workflow-carrying skills
(`work-slice`, `iterate-pr`, `review-code`, `solve-ready-tickets`) each document
a sequential fallback: run the same phases one agent at a time, in the order the
script would have. The contract above is identical either way.
