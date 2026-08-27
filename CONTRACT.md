# Host-repo contract

**Status: stub — filled in during Phase 4 of the migration.** Today the skills still carry
Seranote-specific values inline; this file records what the contract will cover so the shape is
visible before the agnosticizing slices land.

The split: **this plugin is HOW** (loops, gates, review algorithms, stack mechanics); **the host repo
is WHAT** (its domain language, conventions, gate commands, reviewer set). Skills read well-known
paths in the host repo and degrade gracefully when a file is absent.

## Files a host repo provides

| Path | Purpose | Absent → |
| --- | --- | --- |
| `CONTEXT.md` | domain glossary; sharpened by `magnus:grill-with-docs` | skills skip domain-language checks |
| `docs/adr/` | architecture decision records | no ADR cross-checks, no ADR writes |
| `docs/agents/repo-config.md` | repo-specific values (see keys below) | skills fall back to built-in defaults and say so |
| `.claude/skills/_shared/reviewer-registry.js` | repo-specific reviewer lenses + domain-skill hints | generic reviewer set only |

## Keys to lift into `docs/agents/repo-config.md` (P4)

Enumerated from the P0 sweep; each is a literal in some skill today:

- issue tracker: team name (`Seranote`), status names, label names (`agent:ready`, `slice:next`, `manager:skip`, `type:*`, `risk:*`)
- git: base branch (`development`), stack tooling (`gh-stack`)
- PR: title rule `<type>[(scope)]: SER-XX <subject>`, allowed scopes, reviewer bot (Copilot) + re-review mechanics
- gates: lint/test/build/format commands (`nx affected …`, `nx format:check`)
- domain handoffs: which repo skills own migrations, i18n, e2e, prototypes

## Dev-time sync

`shared/sync.sh` bakes `docs/agents/repo-config.md` (via `shared/gen-repo-config-defaults.mjs`) and the
host's `reviewer-registry.js` into each workflow `.js` between `// >>> shared:<name>` markers — the
Workflow runtime cannot import files, so the scripts must stay self-contained. Run it in a working
copy of this repo against a host checkout, never against an installed plugin directory.
