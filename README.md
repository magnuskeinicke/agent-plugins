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
shared/                     # plugin-owned engine copied into the workflow scripts:
                            # repo-config-defaults.js (generic fallbacks),
                            # reviewer-engine.js (lanes/ledger/validator),
                            # loop-schemas.js, sync.sh
.claude-plugin/             # Claude Code: plugin.json + marketplace.json
.codex-plugin/plugin.json   # Codex: plugin manifest (plugin root = repo root)
.agents/plugins/marketplace.json   # Codex: marketplace manifest
codex/install.sh            # Codex fallback adapter: symlink skills into ~/.codex/skills
CONTRACT.md                 # what a host repo must provide
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

## Syncing shared blocks into the workflow scripts

Four skills ship a `Workflow` script (`work-slice`, `review-code`, `iterate-pr`,
`solve-ready-tickets`). The runtime cannot import files, so those scripts must be
self-contained: shared code is copied verbatim between `// >>> shared:<name>` /
`// <<< shared:<name>` markers. **All three sources are plugin-owned and
host-agnostic** — `repo-config-defaults.js`, `reviewer-engine.js`,
`loop-schemas.js`. Host knowledge is never baked in; it arrives at runtime as
`repoConfig` in the workflow args.

```bash
shared/sync.sh            # copy into every workflow script
shared/sync.sh --check    # exit 1 on drift
```

Run it in this working copy, never against an installed plugin cache dir. Commit the
result, bump the plugin version, then reinstall in each agent.

## Status

Migration is tracked in the host repo at `.context/agent-plugins-migration-plan.md`
(voice-to-text). P1 scaffolded the manifests, P2 landed the 16 skills, P3 cut the host
repo over, and P4 made the suite repo-agnostic: no host literal survives in any skill,
the reviewer registry's machinery moved here as `shared/reviewer-engine.js`, and
`/magnus:init-repo` scaffolds a new host's contract. 17 skills.
