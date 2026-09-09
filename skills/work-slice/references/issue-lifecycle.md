# Issue ownership, PR links and completion

Read this at entry to `/feature-goal`, `/work-issue` and `/work-slice`, and when
creating their PRD or slice tickets. It governs tracker fields and PR links;
`qa-handoff.md` governs comment content. Claim/status/link updates do not consume
the human ticket's one comment slot.

## Resolve the human parent and the workflow's tickets

The **parent** is the human-facing feature ticket, or the standalone ticket for
`/work-issue`. For a slice, follow slice → PRD → feature; a PRD argument resolves
to its feature parent. Legacy slices directly under the feature resolve there.
Never confuse the PRD intermediary with the human parent. A standalone issue
does not need an artificial child just to link its PR.

Record the parent ID/URL, PRD ID/URL, generated descendant IDs/roles, claim owner,
and PR → issue mapping in the existing workflow/pipeline checkpoint. Transfer
these fields in cloud bootstrap and worker briefs. Tracker relationships and
live PRs are authoritative; a local inventory alone is not proof of ownership.

When `/to-prd` or `/to-issues` creates a ticket, put a small `## Workflow ownership`
section in **that generated ticket's description**: `Workflow: feature-goal`,
`Feature: <parent ID and URL>`, `Role: prd | slice`. Preserve it on updates.
Recover older tickets from their actual hierarchy plus PRD/slice bodies and
workflow markers; backfill only when those establish workflow ownership.
A shared label, title prefix or bot author alone is insufficient.

List descendants recursively, following every page, to find the PRD, all slices
and any other internal tickets generated for this run. Preserve human-created
children. Consolidation/future-work tickets are separate work: create them
outside this tree, link them as follow-ups, and never close unfinished work just
because an AI created it.

## Resolve status values through the repo's tracker

Use the pinned `tracker.statuses` mapping and `tracker.docPath`:

| Role | Config key | Intended status when no mapping is supplied |
| --- | --- | --- |
| Active development | `inProgress` | Dev in progress |
| Human review handoff | `inReview` | Dev technical review |
| Internal work complete | `done` | Done |

Resolve actual IDs/options from the ticket's team/project before writing.
Configured names win; otherwise discover the intended names or their documented
equivalents. Do not silently leave status untouched or substitute a generic
started state for technical review. An unresolved mapping is a concrete tracker
blocker, recorded for repair; independent work may continue, but completion may
not be claimed.

For Linear, use the team's workflow states. For GitHub Issues, use the repo's
documented Projects status field or status-label workflow for development and
technical review, keeping the parent issue open. Internal Done also closes the
generated issue as completed and updates its project/label status when used.
Other trackers use their documented equivalent. Never close the human parent
as a substitute for technical review or create new workflow states implicitly.

## Claim when work begins

- `/feature-goal` claims the resolved parent **at entry, before grilling or
  dispatch**, or immediately after `/to-prd` creates it when there was no seed.
- `/work-issue` claims its standalone parent after fresh-run preflight, before
  implementation. `/work-slice` ensures the feature parent and PRD are claimed
  before claiming its slice, including standalone slice invocations.
- Use the repo's assignee/ownership convention; preserve an existing assignee,
  assign an unassigned parent to the initiating user resolved by the tracker
  create/claim flow, and record the run/workspace owning the claim. Do not replace
  the user with a bot identity. Remove only `labels.agentReady` from the parent
  and set `<IN-PROGRESS>`; preserve unrelated labels and fields.
- The PRD enters `<IN-PROGRESS>` when the pipeline starts using it; each slice
  enters it when selected. Generated children never enter human review queues.
- On resume, reconcile live ownership and stage first. Repair a missed claim;
  do not reset an already handed-off parent to in progress just because the skill
  ran again. If implementation actually resumes after handoff, move the parent
  and affected internal tickets back to in progress. Respect a competing active
  run; a status/label mutation alone is not an atomic lock.

## Every PR identifies its issues in the body

At creation, pass the resolved issue mapping to the repo's PR skill. Include a
stable section in the same body write as `## Verification`:

```markdown
## Issues

Parent: [PROJ-1200](<feature URL>)
PRD: [PROJ-1201](<PRD URL>)
Slice: [PROJ-1202](<this slice URL>)
```

Standalone PRs have just the Parent line. Include the corresponding generated
ticket for every PR that implements one; each stack layer names **its own**
slice, never a sibling or every slice. PRD-only work uses the PRD line. Use full
tracker URLs (including repository identity for GitHub issues), so the mapping
survives branch renames and cross-repository work.

Use non-closing references; remove generated `Fixes`/`Closes`/`Resolves` references
that would automatically finish the parent. Explicit workflow transitions own
completion. A title/branch issue ID, stack navigation or a QA comment alone is
not a PR-to-issue mapping. Keep this section through body refreshes, evidence
inserts and restacks; read the body back after creation and at final handoff.
Repair missing/wrong links on existing PRs without duplicating the section.
The repo PR skill's title/template rules still apply, but cannot override this
mapping, status lifecycle or the one-comment rule on the human ticket.

## Finalize the whole deliverable

“Finished” means current-head babysit GOAL MET for the **entire** PR/stack,
required evidence published (or a recorded not-applicable reason), and the
parent's QA handoff published. It does not require merge. One completed slice
never advances the parent to review or closes the rest of the tree.

`/work-issue` Step 7 and `/feature-goal` QA-HANDOFF own finalization:

1. Re-list the owned descendant tree and verify every PR's issue mapping and
   current-head completion evidence. An internal implementation ticket without
   its required PR is unfinished; the PRD itself needs no separate PR.
2. Publish/update the one QA handoff, then move **all workflow-generated
   descendants** to `<DONE>`, deepest children first and the PRD last. Exclude
   the human parent even when a legacy pipeline uses its ID as `<PRD-ISSUE>`. Include
   recovered legacy and already-completed children; never move them to technical
   review. Leave unrelated/human-created children and separate follow-ups alone.
3. Move the **human parent** to `<IN-REVIEW>` last. Never mark it Done. Re-read
   every affected status and every PR body before recording workflow DONE.

Partial failure is resumable tracker work, not a successful finish: keep the
inventory and exact pending operations, retry only unapplied effects, and do not
repeat implementation, reviews or captures whose evidence is still current.
In cloud planning-write mode, queue assignment, label and status operations as
well as the QA handoff under [cloud-relay.md](../../feature-goal/references/cloud-relay.md). An initial
claim must be applied by the authorized caller before dispatch when the worker
cannot write; a queued claim alone does not reserve the parent. Final writes
remain `tracker-pending`/QA-HANDOFF until flushed and read back. Never replay an
old in-progress claim over an acknowledged technical-review/Done transition.
