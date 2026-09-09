---
name: to-prd
description: Turn the current conversation context into a PRD and publish it as a dedicated PRD sub-ticket under the feature ticket on the project issue tracker — the human's ticket stays clean. Use when the user wants to create a PRD from the current context (typically right after a /grill-with-docs session).
---

This skill takes the current conversation context and codebase understanding and produces a PRD, then publishes it as the description of a **dedicated PRD ticket** — a sub-issue of the feature ticket, titled `PRD: <feature title>`. The feature ticket itself (the human's ticket: PM, designers, QA read it) is **never written to** beyond labels. Do NOT interview the user — just synthesize what you already know. The detailed implementation tickets are NOT created here; `/to-issues` slices this PRD into sub-tickets of the PRD ticket next.

## Repo contract — resolve this first

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `to-prd`; supporting skills inherit the caller’s resolved role.

Read `docs/agents/repo-config.md` (its `## Config` JSON block); the placeholders
below stand for its values. Missing file or empty key → use the fallback and say
so once. Also read the prose docs it points at (`tracker.docPath`,
`labels.docPath`) for how this repo's tracker creates/updates tickets and who
owns which label.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) — the **feature ticket** | the tracker's own id form (`#123`) |
| `<PRD-ISSUE>` | derived — the sub-issue of `<ISSUE>` whose title starts with `PRD:` | none yet → this skill creates it |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<ISSUE-SKILL>` | `skills.createIssue` | create the issue directly with `<TRACKER>` |
| `<TYPE:>` | `labels.typePrefix` | skip the type label |
| `<SKIP>` | `labels.managerSkip` | skip the triage opt-out stamp (say so — the daily triage may then pick the ticket up) |
| `<NEXT>` | `labels.sliceNext` | no work pointer — tell the user which slice is up |
| `<HITL>` | `labels.needsHuman` | write "needs a human decision" into the slice body instead |
| `<AGENT-READY>` | `labels.agentReady` | there is no autonomous-loop trigger to avoid |

## The ticket tree

Read [the shared issue lifecycle](../work-slice/references/issue-lifecycle.md)
when publishing: record workflow ownership on the generated PRD and return its
ID/URL and the human parent's to the caller. In pipeline mode `/feature-goal`
owns their claims and final statuses; standalone `/to-prd` does not claim them.

Three tiers, two audiences (`../work-slice/references/qa-handoff.md`):

- **Feature ticket `<ISSUE>`** — the human's ticket. PM, designers and QA read it; its description and comments are theirs. The suite writes claim/status fields, labels and, once the whole stack is babysat green, one concise `## QA handoff` comment with inline evidence (`../work-slice/references/qa-handoff.md`). No PRD, no assumptions, no dev material, no progress notes.
- **PRD ticket `<PRD-ISSUE>`** — a sub-issue of the feature ticket, titled **`PRD: <feature ticket title>`**, whose **description is the PRD**. Dev-owned: `/work-slice` appends `## Implementation deltas` comments here, `/to-issues` hangs every slice off it. This is the ticket this skill produces.
- **Slice tickets** — sub-issues of the PRD ticket, created by `/to-issues`.

Resolving the tree:

- **Seeded from an existing ticket** (a `/grill-with-docs` started from an `<ISSUE>` id, or the user named one): that ticket is the **feature ticket**. Never write the PRD into it. If it already has a `PRD:` sub-issue, that is `<PRD-ISSUE>` — **update its description** (re-runs are idempotent; its comments are untouched). Otherwise create the PRD ticket under it.
- **Seeded with a `PRD:` ticket**: it is `<PRD-ISSUE>`; its parent is the feature ticket. Update, don't duplicate.
- **No seed ticket**: create the **feature ticket first** — title from the grill, a short human-readable description (the problem and the outcome in user terms, a few lines, no implementation detail) — then the PRD ticket under it. Follow the create path in `tracker.docPath` (via `<ISSUE-SKILL>` where the repo has one: resolve team + assignee, dup-check, then write) for both.

Either way you end with exactly one feature ticket and exactly one PRD ticket under it, the PRD in the PRD ticket's description. Surface both ids clearly — `/to-issues` needs the PRD ticket, `/feature-goal` keys on the feature ticket.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can.

**Standalone:** check with the user that these seams match their expectations. **As a stage of `/feature-goal` (pipeline mode):** do not ask — the grilling session is the pipeline's only human gate. Pick the seams the grill transcript implies, write them into Testing Decisions, and list anything you had to assume under a `## Assumptions` section at the end of the PRD.

3. Write the PRD using the template below.

4. Publish it as the PRD ticket (see "The ticket tree" above):
   - Create the PRD ticket as a **sub-issue of the feature ticket** (`parentId` = `<ISSUE>`), title `PRD: <feature ticket title>`, **description = the PRD** starting with a `# PRD` heading and a first line linking the feature ticket. If a `PRD:` sub-issue already exists, update its description instead (`save_issue`) — never a second PRD ticket. Same team/project as the feature ticket.
   - Do NOT touch the feature ticket's description or add a comment to it. The PRD duplicates nothing the feature ticket says; it links to it.
   - Apply a `<TYPE:>*` label **and** `<SKIP>` to the **PRD ticket**, and `<SKIP>` to the **feature ticket**, per `labels.docPath`. Preserve existing labels — add, don't replace. Create `<SKIP>` first if the team lacks it (muted grey e.g. `#6b7280`).
   - `<SKIP>` is the triage opt-out: it tells `daily-ticket-manager` to leave these tickets alone. Stamp it now — before any slice exists — because a sub-issue-less PRD ticket otherwise looks standalone to the daily triage and could be wrongly routed `<AGENT-READY>`.
   - Do NOT apply any routing label. Neither ticket is a unit of agent work, so neither may carry `<AGENT-READY>` (the autonomous-loop trigger) or the `<NEXT>` work pointer. `/to-issues` puts the work pointer on the first slice instead.
   - Add/preserve the PRD's `## Workflow ownership` section per
     `issue-lifecycle.md`. Do NOT create slice sub-issues. Standalone mode does
     not change status or reassign; in pipeline mode return newly created IDs
     immediately so `/feature-goal` can claim the parent/PRD before continuing.

5. Report the feature ticket id + URL and the PRD ticket id + URL, then hand off **by caller**:
   - **Standalone** (the user invoked `/to-prd` directly) → tell them to run `/to-issues` to slice it.
   - **As a stage of `/feature-goal`** → say nothing about next commands: return control to the orchestrator, which runs the slice split itself in the same invocation. Do not end the run on a "now run `/to-issues`" line.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Design

Where the design lives, if this feature renders UI. Record the Figma file key and a deep-link per screen/state so `/to-issues` can attach per-slice node links and screenshots to each sub-ticket. Resolve URLs via the `figma-design-url` skill. If there is no design yet, say so.

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>

## Workflow Boundaries

**This skill synthesizes the current context into a PRD published as the description of exactly one PRD ticket, a sub-issue of the feature ticket.**

- **DOES**: explore the repo, sketch test seams and confirm them with the user, write the PRD from the template, create (or update) the `PRD: …` sub-issue with the PRD as its description, stamp `<TYPE:>*` + `<SKIP>` on it and `<SKIP>` on the feature ticket, report both ids + URLs
- **DOES NOT**: interview the user (that was `/grill-with-docs`), create slice sub-issues (`/to-issues` does), implement code, write anything into the feature ticket's description or comments, or apply `<AGENT-READY>`/`<NEXT>` to either ticket

## Red Flags — STOP

- About to open a fresh requirements interview — stop; synthesize what you already know (the seam check in step 2 is the only check-in).
- About to write the PRD into the feature ticket — as its description or as a comment — stop; the feature ticket is the human's; the PRD lives in its own `PRD:` sub-issue.
- Session was seeded from a ticket but you're about to create a new feature ticket — stop; the seed ticket IS the feature ticket (or, if it is a `PRD:` ticket, the PRD ticket to update).
- A `PRD:` sub-issue already exists and you're about to create another — stop; update its description.
- About to put file paths or code snippets into Implementation Decisions — stop; they go stale (only a decision-rich prototype snippet may be inlined).
- About to apply `<AGENT-READY>` or `<NEXT>` to the feature or PRD ticket — stop; neither is a unit of agent work.
- About to create slice sub-issues — stop; that is `/to-issues`'s job. Claim/status transitions belong to the calling workflow under `issue-lifecycle.md`.
- About to replace the ticket's existing labels — stop; add, don't replace.

## Verification

Before reporting done:

- [ ] PRD published as the description of a `PRD: <feature title>` sub-issue of the feature ticket, under a `# PRD` heading, with every template section: Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Design, Out of Scope, Further Notes.
- [ ] Feature ticket description and comments untouched; exactly one `PRD:` sub-issue exists under it.
- [ ] Test seams confirmed with the user (standalone) — or, in pipeline mode, chosen from the grill and any assumption listed under `## Assumptions`; no question was put to the user.
- [ ] `<TYPE:>*` and `<SKIP>` on the PRD ticket, `<SKIP>` on the feature ticket, existing labels preserved, no routing label on either.
- [ ] Design section records the Figma file key + per-screen deep-links, or states there is no design yet.
- [ ] Feature ticket and PRD ticket ids + URLs reported — with the pointer to run `/to-issues <PRD-ISSUE>` when invoked standalone, and **without** it when running as a `/feature-goal` stage (control returns to the orchestrator).
