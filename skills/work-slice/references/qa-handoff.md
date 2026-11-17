# Tracker audiences + the `## QA handoff` comment

The tracker is not a dev log, and a human's ticket is not the suite's scratch
pad. Every ticket write in the suite must know which audience it is talking to,
and a **human-authored ticket gets exactly one suite comment, ever**.
Claim/assignee fields, status transitions and PR references follow
[issue-lifecycle.md](issue-lifecycle.md); they are separate from this comment
budget. The human parent goes to technical review at final handoff; generated
PRD/slice tickets go to Done and require no human review.

## Who reads which ticket

| Ticket | Audience | The suite may write | Never on this ticket |
| --- | --- | --- | --- |
| **Feature ticket** (`<ISSUE>` — the human's ticket, seed of `/feature-goal`) | PM, designers, **QA**, the user | claim/assignee fields, labels, status, and **one** `## QA handoff` comment (this file) | everything else |
| **Standalone ticket** (`/work-issue`, whether run by hand or dispatched by `/solve-ready-tickets`) | QA (and the user) | claim/assignee fields, labels, status, and **one** suite comment — the `## QA handoff`, or the dispatcher's decline note that the same slot later becomes | everything else |
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
ticket's PR (the whole stack's PRs, for `/feature-goal`): CI green, every available review
bot satisfied (an unavailable one skipped and disclosed), every thread resolved. Bot rounds change code, and code changes
invalidate captures — a handoff written at PR-open time is stale by the time QA
reads it.

Consequences, binding on every skill:

- No comment is posted to the human ticket at claim time, at PR-open time, or
  between review rounds. Not acceptance criteria, not a status note.
- **Nothing is even captured before then** — the media is produced by the
  post-GOAL-MET capture stage (`pr-evidence.md`), which is also what fills the
  PR body's `## Visual verification`. The handoff embeds those same files; there
  is never a second set of captures and never an earlier copy of them.
- A run that ends **Blocked** short of GOAL MET posts no handoff and leaves the
  parent in development; the blocker lives on the PR and in the resume report.
- If a later run changes what QA would see, it re-renders the same comment.

The order after GOAL MET is fixed: **draft the test plan → walk it yourself →
cold read → post.** QA never receives a step nobody on our side has performed
(*Walk it yourself* below). For `/work-issue` the walk *is* the capture run, so
the media shows exactly what QA will do.

## The `## QA handoff` comment

Written in the **language the ticket is written in**. Concise is the point:
target **under ~150 words of prose** plus 1–3 embedded media. No tables, no
PASS/FAIL columns, no method notes, no counts.

- **`/work-issue`** — on the ticket itself, after babysit GOAL MET. Same when
  the run was dispatched into a cloud workspace by `/solve-ready-tickets`; the
  dispatcher itself never writes a handoff.
- **`/feature-goal`** — on the **feature ticket** (never the PRD ticket), in the
  QA-HANDOFF stage after babysit reports GOAL MET, composed across the stack.

### Who tests it — a non-technical person

QA is done by **designers and PMs**, not developers. They know the product well,
but they have never seen the code, they have no developer tools, and technical
words mean nothing to them. Write the handoff for that person and nobody else.

**The rule:** a person is asked to test only what a non-technical person can
check in the product's own screens. Everything else is proven by the automated
tests (unit, integration, end-to-end) that shipped with the PR, and **no human is
involved in it** — not as a QA step, not as a "please also check", not as a
caveat. The implement step pins every acceptance criterion with an automated
test (`work-slice` Step 3), so the handoff writer assumes those tests cover what
it leaves out and never asks a person to double-check them.

Sort every criterion before writing a word:

- **Testable by a non-technical person** — it changes something they can do or
  see in the product, and they can reach it in the test environment through the
  product's screens. It becomes a handoff step.
- **Not testable by them** — anything else: no visible effect (performance, a
  data migration, logging, analytics, a race condition, an internal refactor),
  a state they cannot reach through the product (a failed server, an expired
  payment card the test environment does not already contain), or a check that
  needs a tool (developer tools, logs, the database, an API call, a command, a
  feature flag or setting outside the product's screens, a hand-edited URL, a
  faked slow network). It is **left out of the handoff without comment**; its
  proof is the automated tests in the PR's `## Verification`.

Then, for the steps that remain:

- **Only ask for what that person can do.** Click, type, upload, switch user or
  role, resize the window, open the app on a phone, wait, reload.
- **Only ask them to judge what they can see.** Text, layout, what appears or
  disappears, what is still there after a reload, who can and cannot see
  something. Never status codes, response times, stored values, emitted events,
  or "no errors in the console".
- **Reachable states get their own steps.** A state they can reach through the
  product ("a form with no versions yet": create a new form) gets those steps. A
  hard-to-reach state is a step only when the test environment already contains
  it — name the seeded user or record that shows it, by what QA sees.

**Nothing a non-technical person can test → no QA work.** When every criterion
is in the second group (a backend change, a refactor, a fix with no visible
effect), the handoff asks nobody to do anything. It is one sentence, no steps,
no media:

```markdown
## QA handoff

No QA needed. <One plain sentence on what changed, in user terms — "Saving a form is faster; nothing looks or works differently.">. Automated tests cover this change.

<PR link>
```

The same applies to a mixed change: QA gets steps only for the testable part,
and the rest is not mentioned.

### The template

```markdown
## QA handoff

Test on <the team's test environment, in plain words — never localhost or a port>, signed in as <a role, in plain words: "a clinic admin">.

### <What the user does, in their words: "Upload a new version of a form">
**Steps:** 1. Open Administration → Forms. 2. On the "Mouth-first triage" row, click "Upload JSON" and pick a template file. 3. Confirm. 4. Upload again.
**Expected:** the row shows the new version and today's date, and a "Published" message appears. The second upload asks before replacing the first.

![Uploading a template and the overwrite confirmation](https://uploads.linear.app/…)

### <What the user sees: "The published form in the list">
**Steps:** …
**Expected:** …

![The published row](https://uploads.linear.app/…)

**Not working yet:** <only if something failed — in user terms, what QA will see>

<PR link>
```

One heading per walk-through, named by what the user does or sees — never by a
criterion number, a component or a ticket id. Several criteria one walk-through
covers share one heading.

### Acceptance criteria — whose, and in what words

1. The ticket's own `- [ ]` criteria, **verbatim**, when a non-technical person
   would understand them as written.
2. A criterion written in technical terms (schema, endpoint, component) is
   **rewritten** as what the user experiences; the original wording is not shown.
   If there is nothing the user experiences, it is left out (see above).
3. No criteria on the ticket → **write user-facing ones** from the description
   (or, for a feature ticket, from the PRD ticket's User Stories — one criterion
   per story the stack delivered). They live **inside** the handoff; never post a
   separate `## Acceptance criteria` comment.
4. Cover every testable criterion, including ones that failed. A failed one
   gets a line under **Not working yet**, in user terms. Omitting a failure is a
   false claim. A failed criterion that users cannot see belongs in the PR
   body's `## Notes`, not the handoff.

### Language rules

Write the way a PM writes a ticket, not the way a developer writes a commit.

- No file paths, URLs other than the PR link, commands, component names, branch
  or PR jargon, model or reviewer names, `CR-NNN` ids, PASS/FAIL columns, test
  counts, sha's, or "captured against…" method paragraphs.
- No developer vocabulary: not "endpoint", "API", "backend", "frontend",
  "payload", "request", "response", "cache", "state", "render", "mount",
  "hydrate", "null", "undefined", "flag", "feature flag", "env", "migration",
  "schema", "query", "props", "seed", "route", "regression".
  Use the words someone sees on screen: "message", "list", "button", "page",
  "window", "saved".
- Buttons, menus and fields are named exactly as the screen labels them, in
  quotes ("Upload JSON"). When the label is technical, that is still its name.
- Navigation by what the screen shows ("Administration → Forms"), never by a
  route or a URL path.
- Roles and data by what QA sees in the test environment ("the clinic admin
  test user"), never credentials or ids.
- Expected results as observable outcomes ("a Published message appears"), not
  implementation ("the cache is invalidated").

### Walk it yourself before QA does

A test plan nobody has followed is a guess: a label that reads differently on
screen, a menu path that does not exist, a record the test data lacks, a click
the plan forgot. Before the cold read and before anything is posted, perform
the draft's steps yourself, exactly as written, the way the QA person will.

- **Where.** The app started per [run-app.md](run-app.md) (one dev server,
  never the e2e harness), on the code QA will test: for `/work-issue`, the PR
  head babysit reported GOAL MET on; for `/feature-goal`, the **top branch of
  the stack** (it holds every PR) after the stack-wide GOAL MET. The seeded
  users and records stand in for the test environment's.
- **How — literally, through the screens only.** A throwaway Playwright spec
  under the capture stage's setup (`pr-evidence.md`: own minimal config,
  `1920 × 1080` desktop, real-copy check, secret preflight). One `test.step`
  per numbered step, titled with that step's text. Sign in as the role the
  plan names (dev-login outside the walk is fine — QA starts signed in too).
  After that: no `page.goto` except to the app's start page, no test ids, CSS
  selectors, routes or anything else learned from the code. Locate only by the
  words the plan quotes (`getByRole('button', { name: 'Upload JSON' })`,
  `getByText('Published')`). Assert every **Expected** on what the screen
  shows.
- **A step that cannot be done as written** (different label, wrong menu
  path, wrong order, missing click, a record the seeded data does not have) →
  the plan is wrong, not the product: rewrite it to what actually works and
  walk that walk-through again from its first step. A state only a tool can
  reach is not a QA step — drop it (*Who tests it*).
- **An Expected the screen does not show**, with the steps right → a real
  regression on a green PR: stop, post nothing, report it — same as a failed
  capture story (`pr-evidence.md`). Never soften the Expected to match.
- **Record the walk** in `.context/<run-id>/evidence/qa-walk.json`:
  `sourceHead` (full sha walked), the branch, and per walk-through heading its
  steps as walked. A handoff is posted only when every walk-through in it is
  recorded at the current head; a later head change invalidates the walk the
  same way it invalidates media.
- **What it keeps.** `/work-issue`: the walk is the capture stage's one
  Playwright run — the scenes it records are the PR body's
  `## Visual verification` and the handoff's media (nothing captured twice).
  `/feature-goal`: the walk records nothing — the media comes from the PR
  sessions' captures; the walk proves the plan works on the whole feature.
  Delete the throwaway spec after the walk either way.
- **The app cannot run here** (no run command, no stack, no credentials, no
  real copy — `run-app.md`) → a plan with steps is **not posted**. End the run
  Blocked at the handoff stage, naming the reason; a later run in a workspace
  where the app starts resumes at the walk. The *No QA needed* form has no
  steps and needs no walk.

### Read it back through a non-technical reader

Your own read-back is not enough — you wrote the code, and your vocabulary
leaks. After the walk, before posting (or staging) the handoff, spawn **one** fresh
`magnus:cold-reader` (any fresh agent with no repo context when that agent
type is unavailable) and give it **only** the draft comment text, with this
prompt:

```text
You are a product designer. You know the product's screens well, but you have
never seen its code, you have no developer tools, and technical words mean
nothing to you. Below is a test request someone left for you. Do not read any
files.

List, one per line:
WORD: <any word or phrase you would not understand>
STEP: <any step you could not do with only the product's own screens, and why>
RESULT: <any expected result you could not see for yourself on screen>
Write "none" under a heading with nothing to report.

<draft comment>
```

Rewrite or delete every line it reports, then post. One read, no loop — if a
step still needs explaining after the rewrite, it is not a QA step: drop it. A
rewrite that changes what QA does or what they should see (not just the words)
is walked again before posting.

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
follow-ups, verification tables, capture methodology, sandbox caveats, and any
request to check something the automated tests already prove. None of
it reaches the tracker in any form. What a human must act on goes in the PR
body's `## Notes` (`pr-evidence.md`); the rest stays in `.context/<run-id>/`
and the terminal report.
