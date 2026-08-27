---
name: daily-ticket-manager
description: >
  Review and triage the tracker tickets assigned to me that are queued to start — every issue assigned
  to me, on the repo's team, in its ready-for-dev status, regardless of cycle. Classifies
  each on two axes: how risky it is to execute unattended (risk: low / medium / high), and who should
  pick it up (routing: agent-ready vs needs-human). The ticket's `type` (bug / feature / docs / …) is
  assumed already set by the PM / PRD pipeline — this skill does not assess it. It produces a triage
  report and, on `apply`, applies risk/routing labels and writes an "Agent Assessment" comment.
  Use this whenever I ask to "review my tickets", "triage my queue", "what's ready for me to pick up",
  "classify my Linear tickets", "which of my tickets can an agent pick up", "what needs my attention",
  "go through my assigned issues", or run `/daily-ticket-manager` — even when I don't name Linear
  explicitly. Defaults to a read-only dry run; only mutates Linear when I pass `apply`.
argument-hint: "[dry-run|apply] [for <team>]"
---

# Daily Ticket Manager

## Repo contract — resolve this first

Read `docs/agents/repo-config.md` (its `## Config` JSON block); the placeholders
below stand for its values. A key this skill *needs* that is empty is a **hard
stop**, not a guess — say which key is missing and end the run.

| Placeholder | Config key | Absent → |
| --- | --- | --- |
| `<ISSUE>` | `tracker.issuePrefix` + number (e.g. `PROJ-1234`) | the tracker's own id form (`#123`) |
| `<TRACKER>` | `tracker.kind` (`linear` → Linear MCP) | GitHub Issues via `gh` |
| `<TEAM>` | `tracker.team` / `tracker.teamId` | the repo's only team |
| `<READY>` | `tracker.statuses.readyForDev` | **STOP** — there is no queue to triage |
| `<IN-PROGRESS>` | `tracker.statuses.inProgress` | — (only named as out-of-scope) |
| `<AGENT-READY>` | `labels.agentReady` | **STOP** — routing has no target label |
| `<HITL>` | `labels.needsHuman` | **STOP** — routing has no target label |
| `<SKIP>` | `labels.managerSkip` | no exclusion signal — triage everything in scope and say so |
| `<RISK:>` | `labels.riskPrefix` | `risk:` |
| `<TYPE:>` | `labels.typePrefix` | `type:` |

Also read the prose rules at `tracker.docPath` and `labels.docPath`.

## What it does

A lightweight daily triage of my own ticket queue — think of it as a product manager that looks at every
dev-ready ticket assigned to me and answers two questions per ticket:

1. **How risky is it to execute unattended?** — a single risk value (low / medium / high).
2. **Who should pick it up?** — routing: `<AGENT-READY>` (safe to hand to an AI agent loop) or `<HITL>`
   (a judgement call, ambiguity, or blocker needs me first), or neither.

The ticket's type (bug / feature / docs / test / refactor / chore) is assumed already set by the PM / PRD
pipeline (`to-prd` / `to-issues`); this skill does not classify or apply it.

It reports those classifications and, when asked, records them back on the ticket so the queue stays
self-describing for me and for downstream automation — the whole point is to mark which work is safe to
route to an agent and which needs my attention.

This skill **does not implement tickets**. It reads, classifies, and (on `apply`) labels + comments.
Nothing else mutates.

## Mode — dry-run is the default

Parse the argument for the run mode:

- **`dry-run`** (default, and the default whenever the mode is absent or ambiguous) — read the tracker, classify,
  print the report. **Mutate nothing.** No labels, no comments, no label creation.
- **`apply`** — do everything dry-run does, then apply the `<RISK:>*` and routing labels and
  write/update the Agent Assessment comment on each ticket, creating any missing managed labels first.

When running unattended (scheduled / non-interactive), never block on input. If a prerequisite is missing
or the scope can't be resolved, record it in the report and exit. Treat an unattended run as `dry-run`
unless the schedule prompt explicitly says `apply`.

## Step 1 — Resolve scope

The default scope is **my tickets, `<TEAM>`, in the `<READY>` status** — every such
ticket assigned to me, regardless of which cycle (or no cycle) it sits in. Concretely:

- **Assignee** — `me` (the tracker resolves this to the authenticated user).
- **Team** — `<TEAM>` by default. If I name another team, use that instead.
- **Status** — only tickets in **`<READY>`**. This is the one state where classification is
  actionable: the work is queued to start. Everything else — other backlogs, `<IN-PROGRESS>`, review/QA
  states, other lanes, released/closed/cancelled — is **out of scope** and must be skipped, even when
  assigned to me.

> **No cycle filter.** Triage every assigned `<READY>` ticket whether or not it sits in the
> current cycle (or any cycle). Scope is status-only.

> Match the status by **exact state name**; fall back to the id in `tracker.statuses.readyForDev` if names
> have drifted. For another team, resolve the equivalent state (Linear: `list_issue_statuses`). Resolve
> other teams the same way (Linear: `list_teams`).

## Step 2 — Fetch my tickets

Filter by status **server-side**: assignee `me`, team `<resolved team>`, state `<READY>`, limit 100.
(Linear: `list_issues` with those filters — it takes a single `state`.)

> If the team's state name has drifted and the name-based `state` filter silently returns an empty result,
> fetch without `state` (just assignee + team) and filter client-side by the status id in
> `tracker.statuses.readyForDev` — an empty result then means a genuinely empty queue, not a name mismatch.
> A large result can exceed the tool-output token limit, in which case the MCP saves it to a file instead of
> returning it inline. If that happens, parse the saved JSON (e.g. via a subagent or
> `python3 -c "import json; ..."`) rather than re-fetching — keep the full list out of context.

**Then drop any ticket carrying the `<SKIP>` label.** It marks a ticket the PRD pipeline owns — a
`/to-prd` parent or a `/to-issues` slice — and is the authoritative signal that this skill must not touch it:
do not classify, label, or comment. Set these aside and count them so the report can note how many tickets
were skipped (note them in the report's Notes). `<SKIP>` is the **only** exclusion: it is the sole signal
that removes a ticket from triage. **Never infer ownership from a ticket's structure** — a ticket having a
parent (being a `/to-issues` slice) or having sub-issues (being a PRD parent) does **not** exclude it and does
**not** change how it is classified or routed. If the PRD pipeline wants a ticket left alone, it carries
`<SKIP>`; absent that label, the ticket is triaged like any other.

For each in-scope issue keep: identifier (`<ISSUE>`), title, current state, current labels, and url.
A list call may return a short or truncated description. Classification leans on the body, so for any ticket
whose description looks thin or missing, read the full issue before classifying.

**An empty in-scope set is a normal outcome,** not an error — there may simply be nothing assigned to me
queued in `<READY>` right now. If nothing is in scope, report "No tickets assigned to me are in `<READY>`"
(noting any `<SKIP>` count) and stop. Do not widen the search or invent work.

## Step 3 — Classify each ticket

For each in-scope ticket, read the title and full description and decide two things: **risk** and
**routing**. Write one or two plain sentences of reasoning that justify both — this is the "why" that
goes in the report and, on `apply`, into the Agent Assessment comment.

**Read the ticket's comments first.** A ticket back in `<READY>`
with **no `<RISK:>` label** has usually been bounced back by `solve-ready-tickets` after the autonomous
solver *declined* it — look for a comment starting with `## Autonomous solve — declined`. That comment
is new triage information the original classification didn't have: the solver dug into the work and
found it bigger / more ambiguous / higher-blast-radius than `<AGENT-READY>` claimed. **Factor it into both
axes**, and treat it as a hard signal for routing — see the re-triage rule in 3b. (Ordinary tickets with
no such comment classify exactly as before; reading comments just surfaces a prior decline when there is
one.)

### 3a — Risk (how risky to execute unattended)

Assign **exactly one** risk level — how dangerous it is to let an AI agent execute the ticket unattended. This
is about *blast radius and the need for judgement*, not about how hard the work is.

| risk     | when                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `low`    | small, bounded change; clear scope; obvious verification; low blast radius. Docs, simple tests, lint/format fixes, small chores, patch dep bumps, isolated copy or constant changes. |
| `medium` | might be agent-suitable later but needs more confidence, stronger tests, or close human review. Touches shared code, multiple modules, or non-trivial logic without clear judgement calls. |
| `high`   | unattended execution could create meaningful product, security, operational, or data risk. Anything touching auth, billing, data migrations, deployment, security, patient/clinical data, schema changes, or wide-blast-radius logic. |

When torn between two levels, pick the **higher** one — risk classification should be conservative.

### 3b — Routing (who should pick it up)

Decide who should act next. This is the machine-readable handoff that lets an AI agent loop query a safe queue
without re-litigating product risk.

Routing applies to **every** in-scope ticket. `<SKIP>` tickets were already dropped in Step 2, and that
label is the *only* thing that removes a ticket from triage — see `~/.claude/docs/agents/triage-labels.md`. A
ticket's structure is irrelevant here: having a parent (being a `/to-issues` slice) or having sub-issues (being
a PRD parent) does **not** suppress routing and does **not** by itself disqualify `<AGENT-READY>`. Classify each
in-scope ticket purely on the rules below, on its own merits.

Add **`<AGENT-READY>`** only when risk is low, no product, UX, architecture, security, data, billing,
auth, or deployment judgement is required, **and all eight readiness checks pass** (adapted from the
agent-readiness bar in kramme-cc-workflow's backlog refinement):

1. **Problem stated** — the body says what's wrong or wanted, not just a title.
2. **Outcome observable** — you can tell from the outside when it's done.
3. **AC runnable** — each acceptance criterion is verifiable by running something (a test, a command, a browser flow).
4. **Scope bounded** — fits one pull request; an explicit non-goal is stated, or the scope is trivially bounded.
5. **Decisions made** — no TBDs, "discuss with…", or competing options left open; decisions made in comments are folded into the description.
6. **Inputs reachable** — no credentials, unreleased assets, or tacit knowledge an agent can't access.
7. **Dependencies clear** — blockers are named and resolved, or there are none.
8. **Done detectable** — the solver can *prove* completion (this is what feeds dev-loop's proof gate).

The **first failed check is the routing reason**: it names the specific blocker for the `Human needed:`
block in the assessment comment. Never invent missing acceptance criteria or product decisions to reach
agent-ready — a missing decision is `<HITL>`, not a guess.

Add **`<HITL>`** when **any** of these hold:

- requirements or expected behaviour are ambiguous
- a real bug has no reproduction
- the work is too large for one pull request
- it needs product, UX, architecture, security, data, billing, auth, or deployment judgement
- you cannot classify it with confidence
- risk is high (high-risk tickets are human-led; an agent may investigate or plan, but must not execute unattended)

Otherwise add **neither** routing label.

Keep routing labels small — `<AGENT-READY>` and `<HITL>` are the only two. Never put both on one ticket.
When uncertain, prefer `<HITL>` over `<AGENT-READY>`: a false `<AGENT-READY>` sends an agent at work it can't
safely do, which is worse than asking me to look.

**Re-triage rule — a prior solver decline is a hard signal against `<AGENT-READY>`.** If the ticket carries a
`## Autonomous solve — declined` comment (Step 3), the autonomous loop already took this ticket and decided it
could *not* be done unattended. Do **not** re-stamp `<AGENT-READY>` on the strength of the original description —
that just sends the solver back at work it already declined (a ping-pong loop). Route **`<HITL>`** (and
usually raise the risk to match the decline reason) **unless** the comment's specific blocker has been clearly
resolved since — e.g. the description was edited to remove the ambiguity, or a later comment closes it out. When
in doubt, `<HITL>`. Note in the report that the routing was driven by a solver decline.

## Step 4 — Map classification → tracker label

Each classification is recorded with a dedicated managed-label namespace — one label per value, across both
axes:

| axis    | value      | label           | color     |
| ------- | ---------- | --------------- | --------- |
| risk    | `low`      | `<RISK:>low`    | `#0e8a16` |
| risk    | `medium`   | `<RISK:>medium` | `#fbca04` |
| risk    | `high`     | `<RISK:>high`   | `#b60205` |
| routing | agent-ready| `<AGENT-READY>` | `#1d76db` |
| routing | needs-human| `<HITL>`        | `#d93f0b` |

A fully-classified ticket therefore carries **one `<RISK:>` label + at most one routing label**. The
`<TYPE:>*` label is owned by the PRD pipeline (`to-prd` / `to-issues`), not by this skill — leave any
existing one untouched.

**Why a separate managed namespace instead of the team's existing labels**: a team's own labels are its
*product/QA taxonomy* — roadmap distinctions and where-a-bug-was-found records. This skill
answers different, orthogonal questions (how-risky / who-picks-it-up) and needs clean 1:1 mappings that a
scheduled run can apply unambiguously, without disturbing the product taxonomy a human curates. **This table
is the one place to edit** if the team later decides to fold any of these into existing labels. The
`<RISK:>` / `<AGENT-READY>` / `<HITL>` labels are the ones this skill **owns** — see the managed-label rule
in Step 5b.

## Step 5 — Apply (only in `apply` mode)

In `dry-run`, skip this entire step — just report what *would* happen.

In `apply`:

### 5a. Ensure the managed labels exist

List the team's current labels (Linear: `list_issue_labels` with `team: "<TEAM>"`, `limit: 200`). For each
managed label this run needs (the `<RISK:>`, `<AGENT-READY>`, `<HITL>` rows from Step 4) that is
**missing**, create it once (name, color, team id, and a short description, e.g. "Set by daily-ticket-manager — how risky / who picks it up").
Labels created once persist; later runs only create genuinely new ones.

### 5b. Apply the labels without clobbering, and without downgrading existing managed labels

⚠️ **Linear's `save_issue.labels` field replaces the issue's entire label set** — it is not additive. To apply
the managed labels safely, build the full list to write back: take the issue's **current labels**, then add
this run's `<RISK:>` and routing label.

Two rules govern that merge:

- **Never clobber non-managed labels.** Keep everything the skill doesn't own — the team's product/QA
  taxonomy, urgency and compliance labels, **any `<TYPE:>*` label** (owned by the PRD pipeline), etc.
  They must survive untouched in the written set.
- **Managed labels are additive; never downgrade an existing one.** Trackers don't record who set a label, so
  treat every existing `<RISK:>` / `<AGENT-READY>` / `<HITL>` label as if a human set it
  deliberately. Only **fill gaps** — add a managed label on an axis that has none. If this run's classification
  **disagrees** with an existing managed label (e.g. it already has `<RISK:>low` but you'd assign
  `<RISK:>medium`, or it has `<AGENT-READY>` but you'd route `<HITL>`), **keep the existing label, do not replace it, and
  raise the disagreement in the report.** The one exception: when adding a routing label, you may drop the
  *other* routing label only if it's clearly stale — otherwise flag it.

If, after the merge, the written set is identical to the current set (the ticket already carries the right
managed labels), **leave it** — don't issue a write just to re-write the same labels.

### 5c. Write or update the Agent Assessment comment

The reasoning lives in one comment, not in extra labels. Use this exact block:

```md
## Agent Assessment

Risk: low | medium | high
Agent-ready: yes | no

Reason:
<1–2 sentences: what this ticket does, and why it got this risk and routing.>

Suggested plan:
1. <small first step>
2. <small second step>
3. <verification step>

_Classified by daily-ticket-manager._
```

When the routing is `<HITL>`, append — before the marker line — a block naming the blocker:

```md
Human needed:
<the specific question, decision, or missing input required before an agent can execute.>
```

Make it **idempotent** so repeated daily runs don't spam notifications:

1. List the issue's comments.
2. Find an existing comment whose body starts with `## Agent Assessment` and ends with the
   `_Classified by daily-ticket-manager._` marker.
3. If one exists and the risk + routing + reason are unchanged, **do nothing**.
4. If one exists but any of those changed, **update it in place** (by that comment's id).
5. If none exists, **create** one on the issue with the block as its body.

## Step 6 — Report

End every run with a compact summary, regardless of mode:

```md
# Ticket triage — <READY>
Mode: dry-run | apply   ·   Team: <team>   ·   In scope: <n>   ·   Skipped (opt-out label): <m>

| Ticket   | Title              | Risk   | Routing      | Reason      |
| -------- | ------------------ | ------ | ------------ | ----------- |
| <id-1>   | <short title>      | medium | needs-human  | <one line>  |
| <id-2>   | <short title>      | low    | agent-ready  | <one line>  |
| …        |                    |        |              |             |

## Recommended next pickups (agent-ready)
- <id-2> — <title> — <why it's safe>

## Needs my attention (needs-human)
- <id-1> — <title> — <the specific question/decision/blocker>

## Counts
- Risk — low: N  medium: N  high: N
- Routing — agent-ready: N  needs-human: N  unrouted: N

## Notes
- <labels created; comments written/updated/skipped; disagreements with existing managed labels; opt-out tickets dropped>
- <blockers or missing setup, if any>
```

Lead with the two action lists — **`<AGENT-READY>`** (what I can safely delegate) and **`<HITL>`** (what I must
look at myself) — because that routing is the whole point of the triage; the table is the supporting detail.
In `dry-run` describe what *would* be applied; in `apply` state what was done ("added the low-risk +
agent-ready labels", "already classified", "updated comment", etc.). If a ticket already carries a managed label that
**disagrees** with this run's classification, **do not silently overwrite it** — keep the existing label and
flag the disagreement here.

## Safety rules

- Default to `dry-run`. Mutate the tracker only when I pass `apply`.
- Never remove or replace a ticket's existing non-managed labels. Always write the full preserved set (Step 5b).
- Never downgrade or flip an existing managed label (`<RISK:>` / `<AGENT-READY>` / `<HITL>`) — only fill gaps. On disagreement, keep the existing label and flag it in the report.
- Assign exactly one `<RISK:>` label per classified ticket; at most one routing label; never both routing labels.
- Never touch `<TYPE:>*` labels — they're owned by the PRD pipeline (`to-prd` / `to-issues`). Preserve any existing one; never add, change, or remove one.
- Only add `<AGENT-READY>` to low-risk work that meets every agent-ready condition (Step 3b). Never add `<AGENT-READY>` to a high-risk ticket.
- High-risk tickets get `<HITL>` unless already clearly human-owned. When uncertain, prefer `<HITL>` over `<AGENT-READY>`.
- A ticket carrying a `## Autonomous solve — declined` comment was bounced back by the solver: never re-stamp `<AGENT-READY>` on it unless the named blocker is clearly resolved — route `<HITL>` to avoid a re-grab/decline loop (Step 3b re-triage rule).
- Don't change ticket state, assignee, title, description, estimate, or any field other than the managed labels.
- Don't create tickets, close tickets, or touch tickets that aren't assigned to me in `<READY>`.
- Only classify/label/comment tickets in `<READY>`. Never touch a ticket in any other status, even if it's mine.
- Never touch a ticket carrying `<SKIP>` — it's PRD-pipeline-owned. Drop it from scope (Step 2), fold it into the skip count, and never classify, label, or comment on it. `<SKIP>` is the *only* exclusion; never infer ownership from a ticket's parent/sub-issue structure.
- Don't re-write an unchanged Agent Assessment comment.
- An empty in-scope set is a valid result — report it and stop, never widen scope to fill the report.

## Scheduling

This skill is built to run unattended on a daily cadence (e.g. a morning cron). For that, the
schedule prompt must be self-contained: name the team (`<TEAM>`), the scope (`my tickets, status
`<READY>`, any cycle`), and the mutation policy (`dry-run` to just get a report, or `apply` to
label + comment). Default a scheduled run to `dry-run` unless I have explicitly approved `apply`. A scheduled
`apply` run still only ever creates managed labels (`<RISK:>` / `<AGENT-READY>` / `<HITL>`), fills label gaps
on those axes per ticket, and writes the assessment comment — never downgrading an existing managed label,
never touching `<TYPE:>*` or any other field.
