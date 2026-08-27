# agent-plugins

Magnus's personal agent skills, packaged once and consumed by both **Claude Code** (as the plugin
`magnus` from the marketplace `magnus-skills`) and **Codex** (as the plugin `magnus`, or as plain
symlinked skills).

The plugin is the **engine** — loops, gates, review algorithms, issue-tracker mechanics. Repo-specific
knowledge (conventions, ADRs, reviewer registry, gate commands) stays in the **host repo** and is read
through the contract in [`CONTRACT.md`](./CONTRACT.md).

## Layout

```
skills/<name>/SKILL.md      # one dir per skill (+ assets, workflow .js where kept)
shared/                     # engine bits shared by skills: loop-schemas.js,
                            # gen-repo-config-defaults.mjs, sync.sh
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

## Status

Migration is tracked in the host repo at `.context/agent-plugins-migration-plan.md`
(voice-to-text). This repo is the P1 scaffold: manifests + adapters, skills land in P2.
