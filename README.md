# agent-plugins

Magnus's personal agent skills, packaged once and consumed by both **Claude Code** (as the plugin
`magnus` from the marketplace `magnus-skills`) and **Codex** (as the plugin `magnus`, or as plain
symlinked skills).

The plugin is the **engine** — loops, gates, review algorithms, issue-tracker mechanics. Repo-specific
knowledge (integration branch, gate commands, tracker + labels, reviewer lenses, exemplars) stays in the
**host repo**, in a single file: `docs/agents/repo-config.md`. Every key has a generic fallback here, so a
repo that supplies nothing still works — just blunter. Full key reference: [`CONTRACT.md`](./CONTRACT.md).
Scaffold a fresh repo's half with `/magnus:init-repo`.

## Layout

```
skills/<name>/SKILL.md      # one dir per skill (+ assets)
scripts/, shared/, hooks/   # plugin-root files the vendored kramme review skills
                            # (github-review & co.) load; see agents/sources.yaml
agents/<id>.md              # reviewer roster — vendored from kramme-cc-workflow
                            # (MIT, see agents/sources.yaml); Claude subagent def
                            # = Codex `codex exec` child system prompt
engine/cli.mjs              # the review-loop CLI: roster selection, prompts,
                            # findings ingestion, ledger, stop conditions
engine/lib/*.mjs            # config/areas/roster/ledger/schemas/prompts modules
engine/test/*.test.mjs      # node --test suite for the loop
.claude-plugin/             # Claude Code: plugin.json + marketplace.json
.codex-plugin/plugin.json   # Codex: plugin manifest (plugin root = repo root)
.agents/plugins/marketplace.json   # Codex: marketplace manifest
codex/install.sh            # Codex fallback adapter: symlink skills into ~/.codex/skills
CONTRACT.md                 # what a host repo must provide + the engine CLI contract
```

## Install — Claude Code

```bash
claude plugin marketplace add magnuskeinicke/agent-plugins
claude plugin install magnus@magnus-skills
```

Skills surface namespaced: `magnus:feature-goal`, `magnus:work-slice`, … Restart the session after
installing.

Local development (edit here, see it immediately) — point the marketplace at the working copy instead:

```bash
claude plugin marketplace add ~/Documents/Work/agent-plugins
```

## Install — Codex

Preferred, namespaced:

```bash
codex plugin marketplace add git@github.com:magnuskeinicke/agent-plugins.git   # or a local path
codex plugin add magnus@magnus-skills
```

Local iteration needs a version cachebuster to force a reinstall — see
`~/.codex/skills/.system/plugin-creator/references/installing-and-updating.md`.

Fallback (no plugin machinery, no namespace):

```bash
codex/install.sh              # symlink skills/* → ~/.codex/skills/
codex/install.sh --uninstall
```

The fallback refuses to clobber an existing real directory, so a vendored skill of the same name is
safe. Start a new thread after either route.

## Using the suite in a new repo

Two phases: a one-time setup, then the daily pipeline.

### One-time setup

1. **Install the plugin** (once per machine, not per repo — see the install sections above), then
   restart the session.
2. **Run `/magnus:init-repo`** in the new repo. It scaffolds the one required host file,
   `docs/agents/repo-config.md`, discovering the repo's real values itself (integration branch, gate
   commands, tracker + issue prefix, labels, PR title rule, commit rule, area paths, lib map) and
   asking for a single confirmation on the load-bearing keys: `integrationBranch`, `gates.all`,
   `tracker.kind` + `tracker.issuePrefix`, `labels.agentReady`, and `commit.pattern`. Every key is optional — an empty
   key falls back to the generic default in `engine/lib/defaults.mjs`, so the suite works with zero
   config, just blunter.
3. **Sharpen later, optionally:** `/magnus:grill-with-docs` builds `CONTEXT.md` and `docs/adr/`
   lazily as terms and decisions get resolved; `docs/agents/issue-tracker.md` and
   `docs/agents/triage-labels.md` hold the prose tracker/label rules; `goldenPaths` starts empty by
   design (`/magnus:to-issues` pins exemplars as it works); `design.fidelityCheck` and `routing.*`
   are extension points for design-fidelity checks and slice→agent routing. Full key reference:
   [`CONTRACT.md`](./CONTRACT.md).

### Daily workflow

The full pipeline is one command: **`/magnus:feature-goal <feature issue>`** — a re-entrant stage
machine (run it again to resume) that chains:

1. `/grill-with-docs` — grill the plan until shared understanding
2. `/to-prd` — write the PRD as a dedicated `PRD: …` sub-ticket of the feature ticket (the
   human's ticket stays clean — PM, designers and QA read it)
3. `/to-issues` — slice the PRD into stacked, agent-ready sub-issues of the PRD ticket
4. `/work-slice` per slice — **in the cloud by default** (`routing.dispatch: cloud`): one
   Conductor cloud **pipeline workspace** for the stack and a **fresh session per PR** — a
   relay: each session works one slice, opens its stacked draft PR, **babysits it to GOAL MET**
   (CI, Copilot rounds, CodeRabbit rounds, threads — on GitHub), starts the next session and
   ends, so no agent's context ever holds more than one PR and every layer is cut on a
   bot-reviewed, green predecessor (the workspace bootstraps this plugin + `gh-stack` once,
   first). Walking up the stack in order: test-first
   implementation inside the bounded engine-CLI review-fix loop — the magnus reviewer roster on the
   host runtime, then Gate 5: the other provider (Codex for a Claude run) reviews the final tree
   and its accepted findings are fixed until it attests clean (`skills/work-slice/references/convergence.md`) —
   ending in a stacked draft PR
   (one linear GitHub stack via `gh stack`) whose body carries `## Verification` (every check actually run) and — only after that PR is
   babysat to GOAL MET — `## Visual verification` (the fewest scenes that prove it, captured once per verified head on the finished branch, published to
   `pr.mediaBranch`, sha-pinned, and re-used verbatim by the ticket's QA handoff — see `skills/work-slice/references/pr-evidence.md`).
   Opt-in `local` runs the loop in this worktree with a fresh subagent per slice
   (`skills/feature-goal/references/local-loop.md`)
5. `/babysit-stack` — each PR session runs it on its own PR first (step 4); the last PR session then
   starts a fresh babysit session in the pipeline workspace for the stack-wide sweep, to a terminal
   verdict: CI green, then Copilot review rounds until satisfied, then CodeRabbit
   rounds (summoned by `@coderabbitai review`) as the terminal reviewer until satisfied, every thread resolved. Bot
   reviews happen on GitHub only — no review CLI
6. QA handoff — **after** the stack is GOAL MET, one concise `## QA handoff` comment on the
   feature ticket for QA — written for designers and PMs, not developers (plain-language steps
   only for what they can test in the product's screens + one **inline-embedded** visual per
   group of criteria; anything they cannot test is left to the automated tests, and a change
   with nothing for them gets a one-sentence "No QA needed"), under ~150 words, no dev material, no tracker attachments — see
   `skills/work-slice/references/qa-handoff.md`); it is the only suite comment on a
   human's ticket, and re-runs edit it rather than adding a second. Slice tickets stay internal;
   `/work-issue` writes the same single comment once it has babysat its PR green

Both workflows claim the human parent when work starts and move it to **Dev in
progress**. Every PR links that parent and its own generated slice (plus the PRD
when present). After the full PR/stack and QA handoff are complete, the parent
moves to **Dev technical review** and **all generated internal descendants,
including the PRD, move to Done**. PRs remain drafts for human review; generated
tickets need no human review. The repo's `tracker.statuses` maps these roles to
its tracker. Status/link failures remain pending and are repaired on resume.

Planning (steps 1–3) happens in your session (local, or a cloud workspace you handed the grill
off to); everything after it runs as fresh one-PR sessions in the pipeline workspace. The
grilling session is the pipeline's **only human gate**. Everything after it runs without
asking: `/to-prd` and `/to-issues` run in pipeline mode (no confirmations, no HITL slices —
undecided points become recorded `## Assumptions`), and every PR-producing skill ends by
babysitting its PR. Runs end at GOAL MET or when only `needs-human` items remain.

### Before the pipeline: initiatives too big for one grill

When an initiative spans several features or carries decisions that need research or other
people (a whole new settings page, say), one grilling session cannot hold it. Run
**`/magnus:wayfinder <seed ticket | project:<name> | idea>`** first (a whole Linear project works
as the seed). It charts a decision map on the tracker: a
`Wayfinder: …` issue (`wayfinder:map`) whose sub-issues are research, prototype, grilling and task
tickets wired with native blocking. Then run `/magnus:wayfinder <map>` once per ticket, in any
workspace, local or cloud. Each session claims and resolves one frontier ticket, records the answer
on that ticket, gists it on the map and graduates fog into new tickets. Grill-written
`CONTEXT.md`/ADR changes go to the map's `wayfinder/<map>` docs branch so they travel between
workspaces. When nothing is left to decide, the map's `## Handoff` lists the features in build
order, and `/magnus:feature-goal <feature>` runs a **delta grill** on top of the decisions each
feature inherits. Wayfinder plans; it never builds.

Standalone entry points onto the same machinery:

| Command | Use for |
| --- | --- |
| `/magnus:work-issue <id>` | a lean ticket straight to a babysat draft PR — skips PRD/slicing, no human gates |
| `/magnus:solve-ready-tickets` | dispatch every eligible `agent:ready` issue (or configured `labels.agentReady`) into its own cloud workspace running `/work-issue`; `dry-run` previews, `max N` caps new workspaces |
| `/magnus:review-code` | one read-only reviewer round on any diff, PR, or working tree |
| `/magnus:iterate-pr <n>` | bounded review ⇄ fix rounds on an existing PR |
| `/magnus:github-review [<n>]` | review someone else's PR as the requested reviewer: code + product + Linear-requirement passes, a local report, then (on your OK or `--draft-review`) one **unsubmitted pending** GitHub review; `--adversarial` adds a cross-provider pass (Codex from Claude, Claude from Codex) |
| `/magnus:babysit-stack` | babysit a PR or stack to GOAL MET: CI, Copilot rounds, CodeRabbit rounds, threads |
| `/magnus:qa-or-release [dry-run]` | finish the checked-out PR or its stack once every PR is merged or in the merge queue: route the linked issue back to **QA** when QA sent it back before these PRs, else to **QA** when it has clear steps a designer or PM can follow in the product's screens (a cold reader judges), else **Ready to be released**, and delete merged PRs' remote branches |
| `/magnus:wayfinder <seed \| project:<name> \| map>` | chart, or work one ticket of, a tracker-native decision map for an initiative too big for one grill |

`/work-issue`, `/review-code`, `/iterate-pr`, and `/babysit-stack` run wherever
you invoke them. `/solve-ready-tickets` dispatches to Conductor cloud workspaces
by default, then ends — as `/feature-goal` does after planning. Re-invoke (or
schedule) either one to reconcile the workers; nothing runs on your machine
while they work.

Under all of them sits the engine CLI (next section): skills run it from the host repo root, obey
its JSON output, and resume from durable markers — `## Workflow State` checkpoints, the ledger in
`.context/<slice-id>/`, and PR state — so any interrupted run continues by re-invoking the skill.

## The engine CLI

The review machinery lives in `engine/` as a dependency-free Node CLI — no
sync step, no generated blocks. Skills call it from the host repo root and
obey its JSON output; run state lands in the host's gitignored
`.context/<slice-id>/`. Interface and lifecycle: [`CONTRACT.md`](./CONTRACT.md).

```bash
node engine/cli.mjs status --slice PROJ-1234   # example invocation
node --test 'engine/test/*.test.mjs'           # the loop's test suite
```

Commit subjects follow one configured rule — `commit.format` / `commit.pattern`, else the
`pr.titleRule` shape, else `<type>: <subject>` — never "issue id first". The engine renders it into
every writer prompt and enforces it: `init` and `apply-fix` reject non-matching subjects, and
`commit-check` gates every push (see [`CONTRACT.md`](./CONTRACT.md#commit)).

No `*.workflow.js` scripts remain — every loop-running skill drives the engine
CLI, and persistence is re-invocation from durable state markers (`## Workflow
State` checkpoints, `.context/` run state), never a stop-hook or the `Workflow`
tool.

## Status

Migration is tracked in the host repo at `.context/agent-plugins-migration-plan.md`
(voice-to-text). P1 scaffolded the manifests, P2 landed the 16 skills, P3 cut the host
repo over, P4 made the suite repo-agnostic, and the Codex-first rework (PR stack,
2026-08-28) started with PR1: the shared engine became the `engine/` CLI and the
kramme reviewer roster was vendored into `agents/`. PR2 rewrote `work-slice` onto
the CLI: sequential-first loop (subagents an optional accelerator), a
`## Workflow State` resume checkpoint, and no workflow script. PR3 gave
`review-code` (CLI review-only mode, `--inspect` targets) and `iterate-pr`
(full loop on an existing PR, `--max-rounds`) the same treatment and deleted
their workflow scripts. PR4 killed the `/goal` stop-hook dependency —
`feature-goal`, `work-issue` and `solve-ready-tickets` are re-entrant stage
machines on durable markers ("run again to resume"). `solve-ready-tickets` has
since become a pure dispatcher — it fans the queue out to one cloud workspace per
ticket, each running `/work-issue`, and writes no code itself. PR5 adopted the kramme
fix-ci CI mechanics into `babysit-stack` (bucket classification, bounded
watch, failure-signature caps, no `git add -A`). PR6 added the
`design.fidelityCheck` repo extension point, slice agent routing
(`agent:<name>` labels), and the `conductor-workspace` skill. PR7 was the
conventions sweep: every SKILL.md ≤500 lines with Workflow Boundaries /
Red Flags / Verification epilogues, descriptions within Codex's 1024-char
limit. 18 skills, 25 roster agents. The 2026-09 autonomy pass made the grill
the pipeline's only human gate (pipeline-mode `to-prd`/`to-issues`, no HITL
stops in `work-slice`/`work-issue`), made `feature-goal` run everything after
planning in the cloud — first a workspace per slice, then (2026-09-02) a
**relay**: one pipeline workspace, a fresh session per PR that opens its
stacked draft PR (one linear `gh stack` chain), babysits it to GOAL MET
(2026-09-03: per-PR bot review before the next layer is cut), starts the next
session and ends, the last starting the stack-wide babysit session (`local` opt-in) — turned `babysit-stack` into a babysitting
mode that runs Copilot then CodeRabbit rounds on GitHub until satisfied, with
CodeRabbit covering the final head instead of returning to Copilot, and
removed the CodeRabbit CLI lane from the engine (`pr.cliReviewer` →
`pr.commentReviewer`).

Worker models and runtime execution are defined in
[the shared runtime contract](skills/work-slice/references/runtime.md): explicit
Claude/Codex role profiles, native agents or the schema-validating CLI adapter,
and resumable task manifests. Missing review results cannot produce success.
[Cloud dispatch](skills/feature-goal/references/cloud-relay.md) hands work over,
confirms it started and stops; crash recovery and tracker publication happen on
the next invocation. GitHub checks
and visual evidence are tied to each PR's current head.
