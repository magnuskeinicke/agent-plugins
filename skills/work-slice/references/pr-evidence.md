# PR evidence — `## Verification` + `## Visual verification`

Every PR the suite opens carries its evidence **in its description**, so a
reviewer can judge what was actually run and actually seen without pulling the
branch. Shared by `/work-slice`, `/work-issue` (including the runs
`/solve-ready-tickets` dispatches) and `/split-pr`; refreshed by `/iterate-pr` and `/babysit-stack` when they push.
Preserve the PR's `## Issues` mapping during every refresh: the human parent
and the generated ticket this PR implements, per [issue-lifecycle.md](issue-lifecycle.md).

Visual evidence is **captured once, at the very end** — see the next section.

## The PR body is the suite's only voice on the PR

**The suite posts no comments on its own PRs.** Not provenance, not review
ledgers, not assumptions, not outstanding findings, not consolidation lists, not
"posted by /work-issue" notes. The only comments the suite is allowed to leave
on a PR are **machinery** `/babysit-stack` needs: the `<COMMENT-BOT>` summon
command, and the one-line replies that resolve a bot's review threads.

**The body is written for a human reviewer, and only for one.** Include what a
human wants to read, in as few words as it takes; leave out everything written
for a bot, a ledger, or a future audit:

| Goes in the body | Stays in `.context/<run-id>/` + the terminal report |
| --- | --- |
| Summary / What (the PR skill's own content) | the convention provenance table |
| `## Issues` — parent and corresponding PRD/slice links | the full workflow ticket inventory |
| `## Verification` — what was actually run | the review ledger, `CR-NNN` ids, dispute evidence, adjudication rulings |
| `## Visual verification` — the fewest scenes that prove it | reviewer roster, model/agent names, round counts |
| `## Notes` — only what a human must act on (see below) | routing disclosures, "posted by" attributions, capture methodology |

### `## Notes` — at most five one-line bullets

Written **only when there is something the reviewer must act on or would be
misled without**. Omit the whole section otherwise. One line each, no
sub-sections, no prose:

- an **assumption** taken where the ticket left a decision open;
- an **outstanding review finding** the loop shipped without fixing;
- a **leanness concern** (this ticket wanted the full pipeline);
- a **follow-up ticket** `followups` selected instead of widening this diff — id + one clause
  (`references/followups.md`);
- a **skipped review bot** — `<bot> did not review the final head: <reason>` (rate limit,
  quota, error, never delivered), written by `/babysit-stack`.

Anything that needs more than a line does not belong on the PR — it belongs in
the diff, in a follow-up ticket, or nowhere.

## Captured after current-head GOAL MET

**Nothing visual is captured, published or posted before `/babysit-stack`
reports GOAL MET for the PR.** Bot rounds change code, and any capture taken
earlier is either retaken or knowingly shown stale — so the suite takes it once,
at the end, and shows it in exactly two places, rendered from the same files:
the PR body's `## Visual verification` and the human ticket's one
`## QA handoff` (`qa-handoff.md`). There is never a third copy, and never an
earlier one.

The order is fixed, in every flow:

1. implement + review loop, then the headless Playwright user-story loop
   (work-slice 3.5) — it **proves** the acceptance criteria and keeps **no
   artifacts**: no screenshots, no video, nothing published, nothing posted;
2. the draft PR is opened — its body carries `## Verification` (+ `## Notes`);
   **no `## Visual verification` block yet**;
3. `/babysit-stack` drives the PR to **GOAL MET** — CI green, every available
   bot satisfied (a rate-limited or unavailable one skipped), every thread resolved, refreshing `## Verification` as it
   pushes fixes;
4. **the capture stage** (below) runs on the finished branch: one Playwright
   capture run → publish to `<MEDIA-BRANCH>` → **one** body edit inserting
   `## Visual verification`;
5. the ticket's `## QA handoff` is composed from those same files — its test
   plan drafted first and walked by us in the running app before QA sees it
   (`qa-handoff.md` → *Walk it yourself*). For `/work-issue` that walk **is**
   step 4's capture run.

Later pushes/restacks invalidate manifests whose `sourceHead` differs. The
caller runs this stage again after fresh GOAL MET and replaces the existing
visual section and ticket handoff. Never label stale media as current.

A PR that never reaches GOAL MET carries no visual section at all — the run is
Blocked, and nothing is captured for it.

The one exception is `/split-pr`, whose layer PRs are code-identical to a branch
that was already reviewed: each layer gets the section's **one-line form** at
PR creation (`Split layer — no new surface captured`) and captures nothing, and
the top layer inherits the original PR's already-published scenes.

## The two evidence sections

Always in this order, always after the PR skill's own Summary / What content and
before `## Notes` and any trailer (stack navigation, workspace link) — but
written at **different moments** (above):

1. **`## Verification`** — written when the PR is opened, refreshed on every fix
   push. A table of every terminal check run against this branch: gates, test
   runs, builds, typechecks, lint, manual runs. Commands verbatim, results from
   the actual output.
2. **`## Visual verification`** — written **only after GOAL MET**, by the
   capture stage. How the evidence was captured (one sentence), then **the
   fewest scenes that prove the change**: a GIF when the change is behaviour (a
   flow, a state change), a still when it is appearance. Scenes show the
   **finished state** — there are no before shots, because the base is long gone
   by the time anything is captured. One scene per *logical group* of acceptance
   criteria, never one per criterion, and never both a video and a picture of
   the same thing. Every scene names the surface, the route, and the viewport
   dimensions.

Both sections rest on the same rule as `/verify-before-done`: **a row or an
image exists only for something that ran or was captured in this run.** No
row for a command you did not run; no image you did not capture; a check left
to CI is listed as such; "not captured" is written down, never skipped
silently.

## The evidence ledger — `.context/<run-id>/evidence/`

`verification.jsonl` accumulates in the run's gitignored state dir while the
work happens; `media/` is written only by the capture stage, after GOAL MET.
`<run-id>` is the slice id / issue id / `pr-<n>` the run already uses for
`.context/`.

```
.context/<run-id>/evidence/
  verification.jsonl     # one line per check actually run
  media/                   # written by the capture stage only, after GOAL MET
    <scene>.png         # a surface in its finished state
    <flow>.gif          # + <flow>.webm, the Playwright source video
    media.json             # scene manifest, rendered into the section
```

### `verification.jsonl`

Append one line **every time** a gate or check runs in-session — the implement
pass (its `testEvidence`), every gate-fix and fix pass, the Playwright loop's
final `<GATE>` run, a manual run on the dev stack:

```json
{"command": "pnpm exec nx test form-templates --runInBand", "head": "<full sha the command ran against>",
 "result": "pass" | "fail" | "not-run", "summary": "17 suites, 268 tests",
 "note": "optional — pre-existing failures named as such, sandbox limits, what CI covers instead"}
```

Rules:

- `command` is what was typed, verbatim. A phrase (`ESLint on all PR source files`,
  `Manual run on the local dev stack: publish mouth-first-triage@1`) is allowed
  only when there is no single command — say what was done.
- `summary` comes from the tool's own output (suite/test counts, `0 errors`,
  `exit 0`), never from memory.
- A known-failing, unrelated test in the same run is a **pass row with a
  note** naming the failure and why it is unrelated ("cannot load the `canvas`
  native binding in this sandbox; green in CI") — never hidden, never counted
  as this PR's failure.
- A check the run could not perform (no stack, no credentials, too slow for
  the sandbox) is a **`not-run` row with a note** saying what covers it
  (`Covered by the Test Affected job on this head`). The renderer puts these in
  a second table.
- `head` matters: the table is rendered "against the current head". A row run
  at an earlier head is still shown, with `passed at an earlier head` in the
  note, when the same command was not re-run.

### `media.json`

```json
[{"scene": "admin-sidebar", "kind": "still" | "flow",
  "surface": "Administration sidebar", "route": "/administration/users", "viewport": 1920, "viewportHeight": 1080,
  "caption": "the new discovery-only Forms item", "criteria": [1, 2],
  "files": {"image": "admin-sidebar.png"},
  "displayWidth": 960}]
```

`kind` decides the render: `still` → one image; `flow` → one GIF (or a video
link). Every file is `1920 × 1080` pixels. `displayWidth` is the `<img width>`
in CSS px: use `960` for a readable inline preview without changing the file
resolution or aspect ratio.

## The capture stage — one run, after GOAL MET

Reached only on a `/babysit-stack` **GOAL MET** verdict, on the PR's own branch
with every bot fix already merged into it. It is the **only** place the suite
captures anything, and it runs once per verified PR head:

1. Compare the media manifest's `sourceHead` with the live PR head. Reuse matching media only when every file is also `1920 × 1080`; otherwise check out the PR's branch, up to date with what CI went green on
   (`git status --porcelain` clean, head = the pushed head).
2. Start the app with the command [run-app.md](run-app.md) resolves (the
   Conductor run script for this environment, else `devServerCommand`) if it is
   not already serving — one instance, never a second, never through the e2e
   harness.
3. Record the unused temporary spec path and its minimal Playwright config in `scratch-files.json` before creating them; author (or restore an already owned) throwaway spec under that config (no `webServer`, no e2e env files, `baseURL` = the running app; copy only the `e2eDir` dev-login pattern), dev-login
   as the seeded user the ticket's story needs, pass the real-copy check (`run-app.md` §4), drive the acceptance-criterion
   stories once more — for `/work-issue`, the drafted QA test plan walked
   literally (`qa-handoff.md` → *Walk it yourself*) — and capture the scenes below into
   `.context/<run-id>/evidence/media/`, plus `media.json`. Each manifest entry records `sourceHead` (the full verified PR OID). Verify the head is unchanged before publication; a changed head requires a fresh verdict and capture.
4. Publish to `<MEDIA-BRANCH>` (below), insert `## Visual verification` into the
   body with **one** `gh pr edit`, then delete only the owned throwaway spec. Existing untracked files stay untouched.

The change is already reviewed and green, so the capture is a recording, not a
check: **a story that fails here is a real regression** — stop, report it, do
not doctor the capture around it.

Rules for what it captures:

- **Secret preflight before any capture.** Screenshots and video reach the PR
  and the ticket, so anything on screen is published: no credentials, tokens,
  API keys, auth headers, cookies or signed URLs — scan for the classic shapes
  (`sk-`, `ghp_`, `xoxb-`, `Bearer `, `Authorization:`, `?token=`, `api_key=`,
  `.env` contents). Authenticate *outside* the recorded flow and show the
  authenticated result, not the auth step; use the seeded demo users. A secret
  that slips into a capture means **discard and recapture** — never blur, crop,
  or edit it out after the fact. (The dev stack is seeded, so its data needs no
  screening.)
- **Resolution.** Capture evidence only at desktop `1920 × 1080`, with
  `viewport: { width: 1920, height: 1080 }`, `deviceScaleFactor: 1`, and
  `isMobile: false`. Run the capture spec in one desktop Chromium project;
  override inherited device settings and do not run a viewport/device matrix.
  No mobile or other resolutions, including for responsive changes.
- **Frame.** Use `page.screenshot({ path, fullPage: false, scale: 'css' })`
  for a complete `1920 × 1080` viewport. Scroll the target into view and name
  it in the caption; do not use element crops, `clip`, or full-page captures.
  Check every image and video's pixel dimensions before publishing; recapture
  anything that is not `1920 × 1080`.
- **Finished state only — no before shots.** By capture time the base is long
  gone, and the suite never switches branches, stashes, or adds a second
  worktree + server to manufacture a "before". A scene shows what the surface
  looks like now; the caption says what to look at.
- **Economy.** Aim for 1–3 scenes per PR. Group acceptance criteria that a
  single walk-through covers into **one** capture (`media.json` lists the
  criteria a scene proves under `criteria`); pick video **or** still per scene,
  whichever proves it — behaviour → video, appearance → still — not both. A
  scene is added only when it shows something no other scene shows.
- **Video** is preferred whenever the change is something the user *does*
  (a flow, a state change, feedback). Record the story end to end with
  `video: { mode: 'on', size: { width: 1920, height: 1080 } }`,
  keep the `.webm` as the source (the tracker handoff embeds
  it — `qa-handoff.md`), and convert to a GIF for the PR body when `ffmpeg` is
  available:

  ```bash
  ffmpeg -y -i "<flow>.webm" -vf "fps=8" -loop 0 "<flow>.gif"
  ```

  Keep GIFs at `1920 × 1080` and under ~5 MB (trim with `-ss`/`-t`, or
  lower `fps`; never reduce the resolution). No `ffmpeg` →
  publish the `.webm` if it is under 5 MB and link it (GitHub does not inline
  raw video); larger → link the tracker upload instead and say so in the scene.
  A behaviour change shown only as stills is a gap the section must name —
  never quietly substitute.
- **Themes.** Both light and dark only when the diff touches theme-dependent
  styling; otherwise the app's default theme, named once in the capture sentence.
- **Real copy only.** Every frame shows the product as users see it: translated
  text, not translation keys (`settings.profile.title`), literal `{placeholders}`
  or test-mode banners. Such a frame is discarded, the run fixed per
  `run-app.md` §4, and the scene recaptured. Never publish it with a caption
  explaining it away.
- **Nothing capturable** (no dev stack, no credentials, internal-only change,
  or the app cannot render real copy in this workspace)
  → the one-line form of the section (below). Never a Storybook or design image
  standing in for the real surface.

## Publishing media — the media branch

Images in a PR body need a stable URL `gh` can produce. The capture stage commits
them to an **orphan media branch** in the host repo and references them by
**commit sha**, so the URLs are immutable and survive later media commits:

```
https://github.com/<owner>/<repo>/raw/<media-commit-sha>/pr/<n>/<file>
```

`<MEDIA-BRANCH>` = `pr.mediaBranch` (default `pr-media`). It holds only
`pr/<n>/…` directories, is never merged, never PR'd, and carries no workflows
(so pushes to it trigger no CI). Publish from a throwaway worktree so the
slice's checkout is never touched:

```bash
media=<MEDIA-BRANCH>; n=<pr number>; src=.context/<run-id>/evidence/media
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
tmp=$(mktemp -d)
if git ls-remote --exit-code --heads origin "$media" >/dev/null 2>&1; then
  git fetch -q origin "$media" && git worktree add -q --detach "$tmp" "origin/$media"
else
  git worktree add -q --detach "$tmp" && git -C "$tmp" checkout -q --orphan "$media" && git -C "$tmp" rm -rfq .
fi
mkdir -p "$tmp/pr/$n"
find "$src" -maxdepth 1 \( -name '*.png' -o -name '*.gif' -o -name '*.webm' -o -name 'media.json' \) -exec cp {} "$tmp/pr/$n/" \;
git -C "$tmp" add -A && git -C "$tmp" commit -q -m "media: PR #$n"
git -C "$tmp" push -q origin "HEAD:refs/heads/$media"
sha=$(git -C "$tmp" rev-parse HEAD)
git worktree remove --force "$tmp"
# each file → https://github.com/$repo/raw/$sha/pr/$n/<file>
```

Publish only `.png` / `.gif` / small `.webm` plus `media.json` from `media/` —
the manifest is what lets `/feature-goal` compose the feature ticket's QA handoff
from the stack later (`qa-handoff.md`), and the same files are what a ticket's own
handoff embeds. Never a spec, never anything outside `media/`. Re-publishing after
a recapture is a new commit on the same branch under the same `pr/<n>/`; update
the URLs to the new sha.

**Push refused** (branch rulesets, no write access from this workspace)? Do not
fight it. Fall back to the tracker's **upload** step only (Linear:
`prepare_attachment_upload` → PUT → use the returned **asset URL**) and embed
those URLs in the body, and open the section with one line naming the refusal.
Never call `create_attachment_from_upload` for this — that would file the media
as a downloadable resource on the ticket, which no tracker rule allows. No
tracker either → the section lists the scenes with `not published — <reason>`
and the local path.

## Rendering — the body sections

Render from the ledger at PR time. Wrap each section in markers so a later
refresh replaces it instead of appending a second copy.

```markdown
<!-- magnus:verification -->
## Verification

Run against head `<short sha>`:

| Check | Result |
| --- | --- |
| `pnpm exec nx test form-templates --runInBand` | Passed — 17 suites, 268 tests |
| `pnpm exec nx build desktop-web --configuration=production` | Passed |
| `pnpm exec nx test redux --runInBand` | Passed — 22 tests. `rtk-error-handling.utils.spec.ts` cannot load the `canvas` native binding in this sandbox; unrelated to this PR and green in CI |
| Manual run on the local dev stack: publish `mouth-first-triage@1` from `/administration/forms` | Passed — row filled in with version and timestamp; success toast shown; second upload gated behind the overwrite confirmation |

Not run here, left to CI:

| Check | Note |
| --- | --- |
| `pnpm exec nx affected:test --base=origin/development` | Covered by the `Test Affected` job on this head; passed locally over 13 projects at an earlier head |

Independent review: codex gpt-6.2-sol; tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904; change patch 7d3f1c2e9a0b4c5d6e7f8091a2b3c4d5e6f70819; blocking findings 2 (fixed 2); disagreements decided by the adjudicator 0
<!-- /magnus:verification -->

<!-- magnus:visual-verification -->
## Visual verification

Captured against the local dev stack (`<devServerCommand>` + Docker services) with Playwright — headless Chromium, 1920 × 1080, 1× scale — signed in as a seeded admin, after the PR went green and the review bots were satisfied.

**Administration sidebar, `/administration/users`, 1920 × 1080 — the new discovery-only Forms item.**

<img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/admin-sidebar.png" width="960" alt="Administration sidebar with the Forms item">

**Form templates table, `/administration/forms`, 1920 × 1080 — a published handle.**

<img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/forms-table-published.png" width="960" alt="Form templates table showing mouth-first-triage@1 published">

**Publish flow, `/administration/forms`, 1920 × 1080 — not published yet → upload JSON → published row and success toast → second upload → overwrite confirmation → overwritten.**

<img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/publish-flow.gif" width="960" alt="Uploading a form template JSON, the published row, and the overwrite confirmation">
<!-- /magnus:visual-verification -->

<!-- magnus:notes -->
## Notes

- The ticket left the empty-handle case open; treated it as a validation error, matching `createPatientDetails`.
- Shipping with one unfixed finding: the retry banner is not announced to screen readers (CR-014).
- Filed CP-742 for the duplicated size-guard helper rather than widening this diff.
<!-- /magnus:notes -->
```

Rendering rules:

- **Verification rows** in the order they matter to a reviewer: unit/integration
  tests of the touched projects, builds, typecheck, format, lint, then manual
  runs. `Passed — <summary>` / `Failed — <summary>`; a `fail` row ships only when
  the PR knowingly ships red (a capped loop) and the note says so. Omit the
  second table when nothing was left to CI.
- **Independent review line**: the engine `report`'s `independentReview` string,
  verbatim and exactly once, as the last line of `## Verification`
  (`references/convergence.md`). It names the tree Gate 5 attested; a later fix
  (Playwright, babysit) does not rewrite it. Omit it when `report` returns
  `null` (Gate 5 blocked — the blocker goes in `## Notes`) and when the loop
  never ran (a babysit-only push).
- **Scene order**: flows (video) first, then stills. A reviewer should see the
  story move before reading the diffs.
- **Not one per criterion.** A scene that covers several acceptance criteria
  says so in its caption ("covers 1–3"); no scene is duplicated as both GIF and
  still.
- **Scene caption**: `**<Surface>, `<route>`, 1920 × 1080 — <what to look at>.**`
  For a flow, the caption walks the steps with `→`.
- **`alt` text** describes what the image shows, not the file name.
- **Internal-only change** (no user-facing surface): the section is one line —
  `No user-facing change — no visual verification.` Never omit the heading.
- **User-facing but uncapturable** (`devServerCommand` empty, no stack or
  credentials in this workspace, capture stage could not run): the section says
  exactly that, in one line, e.g. `No real-app capture — no dev stack or login
  credentials in this cloud workspace; verification is test-only.` Never
  substitute a Storybook or design screenshot for the real surface without
  saying it is one.
- **Advisory design-fidelity deviations** (work-slice 3.5 `<FIDELITY>`) are
  listed under the scenes as `Design fidelity (advisory): …` bullets.
- **`## Notes`** is omitted entirely when there is nothing a human must act on.
  When present: five bullets maximum, one line each, no headings inside it. A
  finding needing more than a line is not summarised at length — it is fixed,
  filed as a ticket, or left to the reviewer's own reading of the diff.

## Getting the sections into the body

`gh pr edit` fires the `pull_request: edited` event and restarts CI, so the body
is written at exactly **two** moments, never twice in a row:

- **At PR creation — `## Verification` (+ `## Notes`).** No `<PR-SKILL>`
  (fallback `gh pr create --base <BASE> --draft`): render them into the initial
  `--body-file`, after the summary. With `<PR-SKILL>`: hand it `## Verification`
  as the PR's verification content (most PR skills have a test-plan /
  verification slot — that rendered section *is* that content). After it opens
  the PR, read the body back (`gh pr view <n> --json body --jq .body`). Markers
  present → done. Otherwise **one** `gh pr edit <n> --body-file <file>` that
  inserts the blocks after the skill's own content and before any trailer
  (`<!-- conductor-workspace-link -->`, a stack navigation block) — keep every
  other byte of the body as the skill wrote it. Do this **before** requesting the
  review bots, so the restarted CI run is the one they see.
- **After GOAL MET — `## Visual verification`.** The capture stage's one
  `gh pr edit`, inserting the block between `## Verification` and `## Notes`.
  CI restarting on it is harmless: the bots are already satisfied and no fix
  rides on this edit.

**Refresh** (`/iterate-pr`, `/babysit-stack` after pushing fixes): re-render
`## Verification` for the new head from the rows appended during the fix passes,
replace the text between the `magnus:verification` markers, and fold the edit
into the moment of the push. A push that lands **after** a visual section exists
(a review round re-opened on an already-captured PR) marks the affected scenes
stale and lets the next capture stage re-render them — a stale screenshot
presented as current is a false claim.

`## Notes` rides in the creation write — never as a comment. A later run that
must add a note (a capped fix round, a finding shipped unfixed, a skipped review bot)
folds it into the same push-time body edit that refreshes `## Verification`,
replacing the text between the `magnus:notes` markers.
