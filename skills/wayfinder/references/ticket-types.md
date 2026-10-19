# Ticket types

Every ticket asks one precise question that one agent session can resolve.
Every ticket is **HITL** — worked *with* the driver, the user who charted the
map — or **AFK**, driven by the agent alone. A HITL ticket resolves only
through that live exchange with the driver; an agent that answers its own
human-facing question has failed the ticket. The driver is the only decider:
no ticket is ever handed to another person to answer. What a colleague or
another team knows is input the driver gathers, or research — never a decider.

## Choosing a type

Take the first that fits:

1. Facts must come from a source of truth (code, docs, APIs, tracker history,
   another team's ticket) → **research**.
2. The driver needs something concrete to react to → **prototype**.
3. The driver can answer directly → **grilling** (the default).
4. Non-decision work blocks one of the above → **task**.

If none fits, the question is not sharp yet — leave it in **Not yet specified**.
Never create a catch-all ticket.

**Fog or ticket?** Ticket when you can state the question precisely now, even
if it is blocked. Fog when you cannot yet phrase it that sharply. Do not
pre-slice fog: one patch may graduate into several tickets, or none.

## research (AFK)

Read code, docs, third-party APIs, the tracker and linked artifacts to answer a
factual question. Put the cited write-up in a tracker document attached to the
ticket; the resolution states the answer and separates facts from anything that
still needs the driver's call (which becomes a new grilling ticket, not a guess).
Research may run in parallel and in the charting session.

## prototype (HITL)

Make a cheap, rough, disposable artifact so the driver can react: an outline,
a state model, a rough UI stub, a sample output. Prefer an existing prototype
when one answers the question (e.g. a Storybook prototype already on the
integration branch) — link it rather than rebuild. A new one lives on a scratch
branch or in `.context/`, is never merged, and is linked from the ticket.
Resolve only after the driver reacts; record their decision, not the artifact.

## grilling (HITL)

Run `/grill-with-docs` scoped to the ticket's question: one question at a
time, a recommended answer with each, follow consequential branches, stop at
the ticket's boundary. It updates `CONTEXT.md` and ADRs inline — push them to
the docs branch. Resolve when the driver has answered and confirmed the
recorded answer. Do not launch `/to-prd` or any build workflow from a ticket.

## task (AFK or HITL)

Do non-decision work that must happen before a decision can be made:
provision test access, collect a bounded dataset, enable a sandbox. It earns
its place by unblocking a decision, never by delivering the destination. The
agent does it alone where it can; otherwise it hands the driver a precise
checklist (HITL). Record what was done and the resulting safe facts (where
credentials live, never their values; URLs; counts).

Before mutating any external system, confirm the exact action and target are
authorized. Never purchase, deploy, touch production data or broaden access
from a task.

## Every resolution records

- a direct answer to the question;
- evidence, or the driver's confirmation;
- the implications for the route;
- linked assets, not pasted ones;
- new tickets, graduated fog, blocker and scope changes;
- no secrets, private data or raw logs.
