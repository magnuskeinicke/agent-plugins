# Tracker audiences + the `## QA handoff` comment

The tracker is not a dev log. Two audiences read it, and every ticket write in
the suite must know which one it is talking to.

## Who reads which ticket

| Ticket | Audience | The suite may write | Never on this ticket |
| --- | --- | --- | --- |
| **Parent / PRD ticket** (`/feature-goal`) | the user + AI (grill, PRD, slicing docs) — then **QA** | the `# PRD` comment and its `## Implementation deltas`; **one `## QA handoff` comment** (this file) | assumptions, provenance, review ledgers, verification tables, cloud-dispatch markers, per-slice QA evidence |
| **Slice sub-issues** (`/to-issues`) | the user + AI **only** — never shown to anyone else | anything the machinery needs: Skeleton map, `## Cloud dispatch`, `## Assumptions`, dev-form `## QA evidence`, acceptance-criteria notes | — |
| **Standalone ticket** (`/work-issue`, `/solve-ready-tickets`) | QA (and the user) | **one `## QA handoff` comment**; the triage / declined comments the manager loop already leaves | assumptions, leanness concerns, reviewer rosters, verdicts, provenance, verification tables, consolidation lists — all of that is **PR-comment** material |

Rule of thumb: **evidence on the tracker is visual only.** Test runs, gate
output, reviewer verdicts and provenance are for developers and live on the PR
(`pr-evidence.md`, the PR comments). A QA-visible ticket gets exactly one
suite-authored comment, and it must be readable by someone who has never seen
the code.

## The `## QA handoff` comment

Written **once** per QA-visible ticket, idempotently (update the existing
`## QA handoff` comment, never add a second), in the **language the ticket is
written in**:

- **`/work-issue`, `/solve-ready-tickets`** — on the ticket itself, right after
  the draft PR opens (the Playwright loop has run by then).
- **`/feature-goal`** — on the **parent** ticket, in the QA-HANDOFF stage after
  babysit reports GOAL MET, composed across the whole stack.

```markdown
## QA handoff

Test on <the team's test environment, in plain words — never localhost or a port>, signed in as <a role, in plain words: "a clinic admin">. Nothing below needs code access.

### 1–2. <Acceptance criteria in user terms, grouped when one walk-through covers them>
**Steps:** 1. Open Administration → Forms. 2. On the "Mouth-first triage" row, choose Upload JSON and pick a template file. 3. Confirm. 4. Upload again.
**Expected:** the row shows the new version and today's date and a "Published" message appears (1); the second upload asks before overwriting (2).
**Evidence:** 🎥 <one embedded video covering both>

### 3. <a criterion that is about how something looks>
**Steps:** …
**Expected:** …
**Evidence:** 🖼 <one screenshot>

**Not working yet:** <only if something failed — in user terms, what QA will see, e.g. "Uploading a second time does not ask before overwriting.">

Engineering reference: <PR link(s)> — for developers, QA can ignore it.
```

### Acceptance criteria — whose, and in what words

1. The ticket's own `- [ ]` criteria, **verbatim**, when they are user-facing.
2. A criterion written in technical terms (schema, endpoint, component) is
   **rewritten** as what the user experiences; the original wording is not
   shown.
3. No criteria on the ticket → **write user-facing ones** from the description
   (or, for a parent, from the PRD's User Stories — one criterion per story the
   stack delivered). They live **inside** the handoff; never post a separate
   `## Acceptance criteria` comment on a QA-visible ticket.
4. Cover every criterion, including ones that failed — a failed one gets its
   evidence and a line under **Not working yet**, in user terms. Silence is a
   false claim.

### Language rules

- No file paths, commands, component names, branch or PR jargon, model or
  reviewer names, `CR-NNN` ids, PASS/FAIL columns, test counts.
- Navigation by what the screen shows ("Administration → Forms"), not by
  route; a route may follow in parentheses if the app exposes it.
- Roles and data by what QA sees in the test environment ("the seeded clinic
  admin"), never credentials.
- Expected results as observable outcomes ("a Published message appears"),
  not implementation ("the cache is invalidated").

### Evidence — visual only, as few artifacts as prove it

- **One artifact per logical group of criteria, video *or* screenshot — never
  both for the same thing.** Group criteria that one walk-through covers under
  one heading with one video; a criterion about appearance gets one
  screenshot. Aim for 1–3 artifacts per handoff. Prefer video when the
  criterion is something the user does; a still when it is something the user
  sees. Missing evidence for a criterion → say so on its evidence line.
- Files come from the run's `.context/<run-id>/evidence/media/` (work-slice
  3.5). For a parent handoff composed after the fact, fetch them from the
  media branch: `git fetch origin <MEDIA-BRANCH>` then
  `git show origin/<MEDIA-BRANCH>:pr/<n>/<file> > <file>` for each stack PR —
  `pr/<n>/media.json` names the scenes, routes and captions.
- Upload with the tracker's attachment flow and **embed** in the comment
  (Linear: `prepare_attachment_upload` → PUT the file → `create_attachment_from_upload`,
  then the asset URL in markdown). Video as `.webm`/`.mp4` — convert with
  `ffmpeg -i <flow>.webm -c:v libx264 -pix_fmt yuv420p <flow>.mp4` when the
  tracker will not play WebM; GIFs are the GitHub form, not the tracker form.
- Never link a GitHub raw URL on the tracker — QA has no repo access.
- The 3.5 secret preflight applies unchanged: seeded users, fake data, no
  URL bars with tokens, discard + recapture on a slip.

### What is *not* in the handoff

Assumptions, HITL decisions, routing disclosures, leanness concerns, the
reviewer roster, verdicts, provenance, the review ledger, consolidation
follow-ups, verification tables. All of it goes to the PR as comments (or the
PR body's evidence sections). If the human needs to see it, they see it on the
PR; QA never needs it.
