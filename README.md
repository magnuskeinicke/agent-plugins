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
skills/<name>/SKILL.md      # one dir per skill (+ assets, workflow .js where kept)
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

## The engine CLI

The review machinery lives in `engine/` as a dependency-free Node CLI — no
sync step, no generated blocks. Skills call it from the host repo root and
obey its JSON output; run state lands in the host's gitignored
`.context/<slice-id>/`. Interface and lifecycle: [`CONTRACT.md`](./CONTRACT.md).

```bash
node engine/cli.mjs status --slice PROJ-1234   # example invocation
node --test 'engine/test/*.test.mjs'           # the loop's test suite
```

The four `*.workflow.js` scripts still shipped inside some skills are frozen
Claude-only remnants (their embedded shared blocks no longer have a sync
source) and are being replaced skill by skill with CLI-driven sequential
loops that run on both agents.

## Status

Migration is tracked in the host repo at `.context/agent-plugins-migration-plan.md`
(voice-to-text). P1 scaffolded the manifests, P2 landed the 16 skills, P3 cut the host
repo over, P4 made the suite repo-agnostic, and the Codex-first rework (PR stack,
2026-08-28) started with PR1: the shared engine became the `engine/` CLI and the
kramme reviewer roster was vendored into `agents/`. 17 skills, 25 roster agents.
