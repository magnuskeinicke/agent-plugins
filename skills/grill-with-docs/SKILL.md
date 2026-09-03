---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

<convention-docs>

This skill's convention docs (issue tracker, triage labels, domain layout) are committed in this repo at `docs/agents/` — read from there. Nothing to seed.

The domain content this skill writes is also committed **in the repo**: create/update `CONTEXT.md` at the repo root and ADRs under `docs/adr/`. `docs/agents/domain.md` is the authoritative location statement; the file-structure illustration and `CONTEXT-FORMAT.md` / `ADR-FORMAT.md` below agree with it.

</convention-docs>

<what-to-do>

If I seeded this session with an issue-tracker ticket (an id or URL in whatever form `tracker.kind` in `docs/agents/repo-config.md` uses — a Linear `PROJ-1234`, a GitHub issue number, …), fetch it first and treat that ticket as the plan under discussion — read its title, description, acceptance criteria, and any links, and follow the links to their source-of-truth artifacts. The PRD produced next by `/to-prd` goes into a dedicated `PRD:` sub-ticket under this ticket — this ticket stays the human's (PM, designers, QA) and is never written to — so its id is the through-line for the whole pipeline (grill → PRD ticket → slices). Note the ticket id where it won't get lost.

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

Sibling: `grill-me` is the lightweight, docs-free variant of this interview — use it when the project keeps no glossary/ADRs, or for a quick stress-test with no documentation upkeep.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `adr/` exists, create it when the first ADR is needed. Both live **in the repo** (`CONTEXT.md` at the root, `docs/adr/`) and are committed like any other change, so the whole pipeline reads the same files.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

</supporting-info>

## Workflow Boundaries

**This skill interviews the user against the repo's domain docs, updating `CONTEXT.md` and ADRs inline as decisions crystallise.**

- **DOES**: fetch the seed ticket, ask one question at a time with a recommended answer, challenge terms against the glossary, cross-reference claims with code, update `CONTEXT.md` inline, create ADRs when all three criteria hold
- **DOES NOT**: write the PRD (`/to-prd` does, into a `PRD:` sub-ticket of the seed ticket), create implementation tickets (`/to-issues`), implement code, or put implementation details into `CONTEXT.md`

## Red Flags — STOP

- About to ask several questions at once — stop; one at a time, wait for the answer.
- About to ask the user something the codebase can answer — stop; explore the codebase instead.
- About to write an implementation detail, spec fragment, or scratch note into `CONTEXT.md` — stop; it is a glossary and nothing else.
- Batching glossary updates for later — stop; update `CONTEXT.md` the moment a term resolves.
- About to offer an ADR that is not hard to reverse, surprising without context, AND a real trade-off — stop; all three or skip it.
- About to create `CONTEXT.md` or `docs/adr/` with nothing to write yet — stop; create files lazily, on first content.
- Session seeded with a ticket you have not fetched — stop; fetch it and follow its links first.

## Verification

Before reporting done:

- [ ] Every branch of the design tree walked to a resolved decision or an explicitly parked question.
- [ ] Each resolved term captured in `CONTEXT.md` per CONTEXT-FORMAT.md, free of implementation details.
- [ ] Conflicts with the existing glossary called out and settled, not papered over.
- [ ] Any ADR created meets all three criteria and follows ADR-FORMAT.md.
- [ ] Claims about system behaviour cross-checked against the code, contradictions surfaced.
- [ ] The seed ticket id noted where it won't get lost — `/to-prd` hangs the PRD ticket off it.
