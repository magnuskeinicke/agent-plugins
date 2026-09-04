# Tracker audiences + the `## QA handoff` comment

The tracker is not a dev log, and a human's ticket is not the suite's scratch
pad. Every ticket write in the suite must know which audience it is talking to,
and a **human-authored ticket gets exactly one suite comment, ever**.

## Who reads which ticket

| Ticket | Audience | The suite may write | Never on this ticket |
| --- | --- | --- | --- |
| **Feature ticket** (`<ISSUE>` — the human's ticket, seed of `/feature-goal`) | PM, designers, **QA**, the user | labels, status, and **one** `## QA handoff` comment (this file) | everything else |
| **Standalone ticket** (`/work-issue`, whether run by hand or dispatched by `/solve-ready-tickets`) | QA (and the user) | labels, status, and **one** suite comment — the `## QA handoff`, or the dispatcher's decline note that the same slot later becomes | everything else |
| **PRD ticket** (`PRD: …` sub-issue of the feature ticket, `/to-prd`) | the user + AI | the PRD as its description; `## Implementation deltas` comment | QA handoff (that is the feature ticket's), per-slice machinery |
| **Slice sub-issues** (`/to-issues`, children of the PRD ticket) | the user + AI **only** — never shown to anyone else | anything the machinery needs: Skeleton map, `## Cloud dispatch`, `## Assumptions`, **text-only** `## QA evidence` (PASS/FAIL rows, no images), acceptance-criteria notes | images or video — the only two places visual proof appears are the PR body and the human ticket's handoff |

Two rules follow, and they are absolute:

- **AI-generated prose belongs on AI-generated tickets.** The PRD ticket and the
  slice sub-issues are the suite's own; write what the machinery needs there.
  The human's ticket is theirs.
- **Evidence on a human ticket is visual, inline, and concise.** Test runs, gate
  output, reviewer verdicts, provenance, review ledgers and assumptions are
  developer material and live on the **PR body** (`pr-evidence.md`) — never on
  the tracker, never as a tracker comment.

## The one comment slot on a human ticket

There is exactly **one** suite-authored comment per human-facing ticket. It is
not a thread and it is never appended to:

- **Find it by its heading** (`## QA handoff`, or the decline note's heading) in
  `list_comments`, and **update that comment by id**. A second suite comment on
  a human ticket is a defect, not a duplicate.
- **Superseding is editing.** New evidence, a re-run, a corrected criterion, a
  recapture — all of it *replaces* the body of the existing comment. Never post
  a "v2 supersedes the above" comment; the reader must never have to work out
  which version is current.
- **The decline note shares the slot.** A ticket `/solve-ready-tickets` refuses
  to dispatch gets a three-line `## Autonomous solve — declined` note in that
  slot — the one AI-to-AI message on a human ticket, because
  `/daily-ticket-manager` re-triages on it. If the ticket is later worked, the
  handoff replaces it.

## When it is written — after the PR is done, never before

The handoff is written **only once `/babysit-stack` reports GOAL MET** for the
ticket's PR (the whole stack's PRs, for `/feature-goal`): CI green, both review
bots satisfied, every thread resolved. Bot rounds change code, and code changes
invalidate captures — a handoff written at PR-open time is stale by the time QA
reads it.

Consequences, binding on every skill:

- Nothing is posted to the human ticket at claim time, at PR-open time, or
  between review rounds. Not acceptance criteria, not a status note.
- **Nothing is even captured before then** — the media is produced by the
  post-GOAL-MET capture stage (`pr-evidence.md`), which is also what fills the
  PR body's `## Visual verification`. The handoff embeds those same files; there
  is never a second set of captures and never an earlier copy of them.
- A run that ends **Blocked** short of GOAL MET writes **nothing** on the
  ticket; the state lives on the PR, and the resume report names it.
- If a later run changes what QA would see, it re-renders the same comment.

## The `## QA handoff` comment

Written in the **language the ticket is written in**. Concise is the point:
target **under ~150 words of prose** plus 1–3 embedded media. No tables, no
PASS/FAIL columns, no method notes, no counts.

- **`/work-issue`** — on the ticket itself, after babysit GOAL MET. Same when
  the run was dispatched into a cloud workspace by `/solve-ready-tickets`; the
  dispatcher itself never writes a handoff.
- **`/feature-goal`** — on the **feature ticket** (never the PRD ticket), in the
  QA-HANDOFF stage after babysit reports GOAL MET, composed across the stack.

```markdown
## QA handoff

Test on <the team's test environment, in plain words — never localhost or a port>, signed in as <a role, in plain words: "a clinic admin">.

### 1–2. <Acceptance criteria in user terms, grouped when one walk-through covers them>
**Steps:** 1. Open Administration → Forms. 2. On the "Mouth-first triage" row, choose Upload JSON and pick a template file. 3. Confirm. 4. Upload again.
**Expected:** the row shows the new version and today's date and a "Published" message appears (1); the second upload asks before overwriting (2).

![Uploading a template and the overwrite confirmation](https://uploads.linear.app/…)

### 3. <a criterion that is about how something looks>
**Steps:** …
**Expected:** …

![The published row](https://uploads.linear.app/…)

**Not working yet:** <only if something failed — in user terms, what QA will see>

<PR link>
```

### Acceptance criteria — whose, and in what words

1. The ticket's own `- [ ]` criteria, **verbatim**, when they are user-facing.
2. A criterion written in technical terms (schema, endpoint, component) is
   **rewritten** as what the user experiences; the original wording is not shown.
3. No criteria on the ticket → **write user-facing ones** from the description
   (or, for a feature ticket, from the PRD ticket's User Stories — one criterion
   per story the stack delivered). They live **inside** the handoff; never post a
   separate `## Acceptance criteria` comment.
4. Cover every criterion, including ones that failed — a failed one gets a line
   under **Not working yet**, in user terms. Silence is a false claim.

### Language rules

- No file paths, commands, component names, branch or PR jargon, model or
  reviewer names, `CR-NNN` ids, PASS/FAIL columns, test counts, sha's, or
  "captured against…" method paragraphs.
- Navigation by what the screen shows ("Administration → Forms"), not by route;
  a route may follow in parentheses if the app exposes it.
- Roles and data by what QA sees in the test environment ("the seeded clinic
  admin"), never credentials.
- Expected results as observable outcomes ("a Published message appears"), not
  implementation ("the cache is invalidated").

### Evidence — inline, visual, as few artifacts as prove it

**Everything the reader needs must render in the comment.** A tracker
attachment, a file to download, a link to click, a GitHub raw URL — all of them
are failures of this rule.

- **Embed, never attach.** Linear: `prepare_attachment_upload` → PUT the file to
  the returned URL → put the returned **asset URL straight into the comment
  markdown** (`![alt](assetUrl)`). **Never call `create_attachment_from_upload`**
  on a human ticket — that files the media in the attachments panel as a
  downloadable resource, which is exactly what this rule forbids.
- **Never a GitHub raw URL on the tracker** — QA has no repo access.
- **One artifact per logical group of criteria, video *or* still — never both
  for the same thing.** Group criteria that one walk-through covers under one
  heading with one video; a criterion about appearance gets one still. **1–3
  artifacts per handoff**, full stop. Prefer video when the criterion is
  something the user *does*, a still when it is something the user *sees*.
- **Video must play inline.** Upload `.mp4` (`ffmpeg -i <flow>.webm -c:v libx264
  -pix_fmt yuv420p <flow>.mp4`) and embed it. If the tracker will not render it
  inline, fall back to a **still** — never to a download link.
- Files come from the capture stage's `.context/<run-id>/evidence/media/`
  (`pr-evidence.md`) — the same scenes the PR body shows, re-used, never
  recaptured for the tracker. For a feature-ticket handoff composed across the
  stack, fetch them from the media branch: `git fetch origin <MEDIA-BRANCH>` then
  `git show origin/<MEDIA-BRANCH>:pr/<n>/<file> > <file>` for each stack PR —
  `pr/<n>/media.json` names the scenes, routes and captions.
- Missing evidence for a criterion → one short line saying so.
- The capture stage's secret preflight applies unchanged: seeded users, no URL
  bars with tokens, discard + recapture on a slip.

### What is *not* in the handoff

Assumptions, HITL decisions, routing disclosures, leanness concerns, the
reviewer roster, verdicts, provenance, the review ledger, consolidation
follow-ups, verification tables, capture methodology, sandbox caveats. None of
it reaches the tracker in any form. What a human must act on goes in the PR
body's `## Notes` (`pr-evidence.md`); the rest stays in `.context/<run-id>/`
and the terminal report.
