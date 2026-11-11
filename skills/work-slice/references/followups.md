# Follow-up tickets

The suite files follow-up tickets from two sources only: the reuse audit's
`consolidations`, which mean code that is already duplicated at two or more
existing call sites outside the diff and belongs in a shared lib, and
verified [discoveries](#discoveries-verified-defects-outside-the-diff). Nothing
else becomes a ticket. That covers advisory findings, unverified findings,
reviewer notes, deferred or disputed ledger entries, bot review threads,
"could generalize later" ideas, and duplication inside the diff. These go
into the PR's `## Notes` (when a human must act) or are dropped.

## What to file: `followups`, verbatim

```bash
node "$engine" followups --slice <id>
```

The engine has already deduped candidates across rounds. It checks every
claimed call site against the work tree, so the file must exist, the line
must be in range, and the file must sit outside the diff. It demotes
anything with fewer than two verified sites and caps own tickets at one.
It returns:

- `file`: at most one candidate that gets **its own ticket**.
- `batch`: the remaining qualified candidates. Append them to the **one
  rolling follow-ups ticket**.
- `demoted`: never filed. List them in the terminal summary only.

Never re-derive the selection. Never file a `demoted` entry, and never
promote a `batch` entry to its own ticket.

## Filing

1. **Dedupe against the tracker first.** Every candidate carries a `marker`
   (`magnus:followup:<fingerprint>`). Search open tickets for it (per
   `tracker.docPath`). A candidate whose marker is already on an open ticket
   is done: skip it.
2. **`file` → its own ticket** on the team, using the same create flow as
   `tracker.docPath`:
   - Title: the candidate's title.
   - Body: the detail, the `targetLib`, the verified `callSites`, a link back
     to this PR, and the marker as an HTML comment.
   - Labels: the chore type label + `<SKIP>`.
3. **`batch` → the rolling ticket.** Find the open ticket titled
   `Follow-ups: <feature title>` (work-slice / feature-goal) or
   `Follow-ups: consolidation candidates` (work-issue). Append one line per
   candidate to its **description**:
   `- [ ] <title> — <targetLib>; <callSites>; from <PR link> <!-- <marker> -->`.
   Never add a comment, and never create a second rolling ticket. Create it
   (chore type label + `<SKIP>`) only when it does not exist yet.
4. **Placement.** Link follow-up tickets to the human feature ticket as
   related. Never make them children of it or the PRD: finalization closes
   workflow descendants, and follow-ups are separate, unfinished work
   (`issue-lifecycle.md`).
5. **PR `## Notes`:** one bullet for the own ticket (id + one clause), and
   one bullet `N candidates appended to <rolling id>` when the batch was
   non-empty. Nothing filed means no bullet.

## Discoveries: verified defects outside the diff

A review-loop reviewer, or a review that another plugin's gate forces, can report a defect
that is real but not this ticket's to fix: a production bug in code the diff
does not touch, or a missing test for behaviour that already shipped (often
another in-flight ticket's). These are not questions for the user, and they
are not scope for this PR.

1. **Verify each one** against the work tree. The file exists, the line is in
   range, the defect is still present at HEAD, and the code sits outside the
   diff. Drop anything that fails a check.
2. **File at most two tickets per run.** One bug ticket lists every verified
   production defect, and one chore ticket lists every verified test gap. Each
   item gives file:line, a one-line impact, the ticket it belongs to (if one
   exists) and a `magnus:discovery:<fingerprint>` marker as an HTML comment.
   Dedupe by marker against open tickets first. Use the type labels from
   `tracker.docPath` and no `<SKIP>`, so triage treats them like any ticket a
   human filed. Placement follows step 4 above.
3. **Never edit, comment on or re-scope another ticket**, even when the gap
   belongs to it. Name that ticket in the item instead.
4. **PR `## Notes`:** one bullet per discovery ticket (id + one clause).

Babysit and bot review threads never file tickets. An out-of-scope bot
suggestion is declined on its thread (see `babysit-stack` Phase D).
