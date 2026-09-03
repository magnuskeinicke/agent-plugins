# PR evidence — `## Verification` + `## Visual verification`

Every PR the suite opens carries two evidence sections **in its description**,
so a reviewer can judge what was actually run and actually seen without pulling
the branch. Shared by `/work-slice`, `/work-issue`, `/solve-ready-tickets`,
`/split-pr`; refreshed by `/iterate-pr` and `/babysit-stack` when they push.

Two sections, always in this order, always after the PR skill's own Summary /
What content and before any trailer (stack navigation, workspace link):

1. **`## Verification`** — a table of every terminal check run against this
   branch: gates, test runs, builds, typechecks, lint, manual runs. Commands
   verbatim, results from the actual output.
2. **`## Visual verification`** — how the visual evidence was captured (one
   sentence), then **the fewest scenes that prove the change**: a GIF when the
   change is behaviour (a flow, a state change), a still when it is appearance
   (before/after pair for a changed surface, single image for a new one). One
   scene per *logical group* of acceptance criteria, never one per criterion,
   and never both a video and a picture of the same thing. Every scene names
   the surface, the route, and the viewport width.

Both sections rest on the same rule as `/verify-before-done`: **a row or an
image exists only for something that ran or was captured in this run.** No
row for a command you did not run; no image you did not capture; a check left
to CI is listed as such; "not captured" is written down, never skipped
silently.

## The evidence ledger — `.context/<run-id>/evidence/`

Evidence accumulates in the run's gitignored state dir while the work happens,
and is rendered once at PR time. `<run-id>` is the slice id / issue id /
`pr-<n>` the run already uses for `.context/`.

```
.context/<run-id>/evidence/
  verification.jsonl     # one line per check actually run
  media/
    <scene>-before@2x.png
    <scene>-after@2x.png
    <scene>@2x.png         # brand-new surface — no before exists
    <flow>@2x.gif          # + <flow>.webm, the Playwright source video
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
[{"scene": "admin-sidebar", "kind": "before-after" | "new" | "flow",
  "surface": "Administration sidebar", "route": "/administration/users", "viewport": 1440,
  "caption": "the new discovery-only Forms item", "criteria": [1, 2],
  "files": {"before": "admin-sidebar-before@2x.png", "after": "admin-sidebar-after@2x.png"},
  "displayWidth": 352}]
```

`kind` decides the render: `before-after` → a two-column table; `new` → one
image; `flow` → one GIF (or a video link). `displayWidth` is the `<img width>`
in CSS px — about half the 2× file's pixel width: ~830 for a full 1440 px
viewport, ~352–410 each for a side-by-side pair, ~390 for a mobile frame.

## Capturing — rules for the Playwright spec

The captures are produced by the same throwaway Playwright spec the user-story
loop runs (work-slice 3.5); this reference only fixes **what** it captures.
Everything in 3.5 still binds: one dev server per run, the **secret preflight
before any capture**, seeded demo users only, authenticate outside the recorded
flow, a leaked secret means discard + recapture.

- **Viewport.** Desktop at `1440 × 900`, `deviceScaleFactor: 2` → files are
  `@2x`. Add a `390` px mobile capture when the browser guide says the surface
  is used on mobile or the diff touches responsive styles; each viewport is its
  own scene, named with its width.
- **Crop to what changed.** A component, sidebar, or table → `locator.screenshot()`
  of that element; a whole page → the viewport (`fullPage: false`). Before and
  after use the **same** crop, route, seeded user, and viewport, or the pair
  proves nothing.
- **Before.** Captured while the working tree is still the base — i.e. **before
  the implement pass** (work-slice 3.1 pre-capture): the routes the ticket's
  acceptance criteria / "where to look" / design links name, into
  `media/<scene>-before@2x.png`. That is the only cheap moment the base is
  running on the one dev server; afterwards HMR (or a restart of that same
  server — a restart is not a second server) serves the branch. No before for a
  brand-new surface (`kind: new`). If the before was not captured (resumed run,
  scene not predictable up front, server not up yet) → the scene is rendered
  with an explicit `Before not captured — <reason>` cell. **Never** switch
  branches, stash, or add a second worktree + server to manufacture a before.
- **After.** The final passing Playwright round captures each scene's
  `-after@2x.png` (or `@2x.png` for `new`) in the same spec run that captures
  the per-AC `ac-<n>-<pass|fail>.png` QA evidence. The AC shots go to the
  ticket; the scenes go to the PR. One shot may serve as both.
- **Economy.** Aim for 1–3 scenes per PR. Group acceptance criteria that a
  single walk-through covers into **one** capture (`media.json` lists the
  criteria a scene proves under `criteria`); pick video **or** still per scene,
  whichever proves it — behaviour → video, appearance → still — not both. A
  scene is added only when it shows something no other scene shows.
- **Video** is preferred whenever the change is something the user *does*
  (a flow, a state change, feedback). Record the story end to end with
  `video: 'on'`, keep the `.webm` as the source (the tracker handoff embeds
  it — `qa-handoff.md`), and convert to a GIF for the PR body when `ffmpeg` is
  available:

  ```bash
  ffmpeg -y -i "<flow>.webm" -vf "fps=8,scale=1660:-1:flags=lanczos" -loop 0 "<flow>@2x.gif"
  ```

  Keep GIFs under ~5 MB (trim with `-ss`/`-t`, or lower `fps`). No `ffmpeg` →
  publish the `.webm` if it is under 5 MB and link it (GitHub does not inline
  raw video); larger → link the tracker upload instead and say so in the scene.
  A behaviour change shown only as stills is a gap the section must name —
  never quietly substitute.
- **Themes.** Both light and dark only when the diff touches theme-dependent
  styling; otherwise the app's default theme, named once in the capture sentence.
- **Fake data only.** Say so in the capture sentence. A capture that shows real
  customer/personal data is a hard stop (3.5 preflight).

## Publishing media — the media branch

Images in a PR body need a stable URL `gh` can produce. The suite commits them
to an **orphan media branch** in the host repo and references them by
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
the manifest is what lets `/feature-goal` compose the feature ticket's QA handoff from
the stack later (`qa-handoff.md`). Never the per-AC QA shots (those go to the
ticket), never a spec, never anything outside `media/`. Re-publishing after a recapture is a new commit on the same branch
under the same `pr/<n>/`; update the URLs to the new sha.

**Push refused** (branch rulesets, no write access from this workspace)? Do not
fight it. Fall back to the tracker's attachment flow (Linear:
`prepare_attachment_upload` → PUT → `create_attachment_from_upload`) and link
those URLs — they will not inline, but they are evidence — and open the
section with one line naming the refusal. No tracker either → the section
lists the scenes with `not published — <reason>` and the local path.

## Rendering — the two sections

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
<!-- /magnus:verification -->

<!-- magnus:visual-verification -->
## Visual verification

Captured against the local dev stack (`<devServerCommand>` + Docker services) with Playwright — headless Chromium, 1440 px, 2× scale — signed in as a seeded admin. Fake data only.

**Administration sidebar, `/administration/users`, 1440 px — the new discovery-only Forms item.**

| Before | After |
| --- | --- |
| <img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/admin-sidebar-before@2x.png" width="352" alt="Administration sidebar without the Forms item"> | <img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/admin-sidebar-after@2x.png" width="352" alt="Administration sidebar with the Forms item"> |

**Form templates table, `/administration/forms`, 1440 px — a published handle.**

<img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/forms-table-published@2x.png" width="830" alt="Form templates table showing mouth-first-triage@1 published">

**Publish flow, `/administration/forms`, 1440 px — not published yet → upload JSON → published row and success toast → second upload → overwrite confirmation → overwritten.**

<img src="https://github.com/<owner>/<repo>/raw/<sha>/pr/<n>/publish-flow@2x.gif" width="830" alt="Uploading a form template JSON, the published row, and the overwrite confirmation">
<!-- /magnus:visual-verification -->
```

Rendering rules:

- **Verification rows** in the order they matter to a reviewer: unit/integration
  tests of the touched projects, builds, typecheck, format, lint, then manual
  runs. `Passed — <summary>` / `Failed — <summary>`; a `fail` row ships only when
  the PR knowingly ships red (a capped loop) and the note says so. Omit the
  second table when nothing was left to CI.
- **Scene order**: flows (video) first, then before/after pairs, then single
  stills. A reviewer should see the story move before reading the diffs.
- **Not one per criterion.** A scene that covers several acceptance criteria
  says so in its caption ("covers 1–3"); no scene is duplicated as both GIF and
  still.
- **Scene caption**: `**<Surface>, `<route>`, <width> px — <what to look at>.**`
  For a flow, the caption walks the steps with `→`.
- **`alt` text** describes what the image shows, not the file name.
- **Internal-only change** (no user-facing surface): the section is one line —
  `No user-facing change — no visual verification.` Never omit the heading.
- **User-facing but uncapturable** (`devServerCommand` empty, no stack or
  credentials in this workspace, Playwright loop skipped): the section says
  exactly that, in one line, e.g. `No real-app capture — no dev stack or login
  credentials in this cloud workspace; verification is test-only.` Never
  substitute a Storybook or design screenshot for the real surface without
  saying it is one.
- **Advisory design-fidelity deviations** (work-slice 3.5 `<FIDELITY>`) are
  listed under the scenes as `Design fidelity (advisory): …` bullets.

## Getting the sections into the body

The suite ships **one** body write per PR creation — `gh pr edit` fires the
`pull_request: edited` event and restarts CI, so never edit the body twice in
a row.

- **No `<PR-SKILL>`** (fallback `gh pr create --base <BASE> --draft`): render both
  sections into the initial `--body-file`, after the summary.
- **With `<PR-SKILL>`**: hand it the two rendered sections as the PR's
  verification content (most PR skills have a test-plan / verification slot —
  the rendered sections *are* that content). After it opens the PR, read the
  body back (`gh pr view <n> --json body --jq .body`). Both markers present →
  done. Otherwise **one** `gh pr edit <n> --body-file <file>` that inserts the
  two blocks after the skill's own content and before any trailer
  (`<!-- conductor-workspace-link -->`, a stack navigation block) — keep every
  other byte of the body as the skill wrote it. Do this **before** requesting
  the review bots, so the restarted CI run is the one they see.
- **Refresh** (`/iterate-pr`, `/babysit-stack` after pushing fixes): re-render
  `## Verification` for the new head from the rows appended during the fix
  passes, replace the text between the `magnus:verification` markers, and fold
  the edit into the moment of the push. `## Visual verification` is refreshed
  only when a fix changed a captured surface (re-run the capture; a stale
  screenshot presented as current is a false claim).

The convention provenance, review ledger, assumptions and consolidation links
stay **PR comments** as before — the body edit is for the two evidence sections
only.
