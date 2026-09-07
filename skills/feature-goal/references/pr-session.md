# PR session — one slice, one session, one stack layer

You are a relay session inside the **pipeline workspace** (SKILL.md, "Which
session am I?"), at stage SLICE-LOOP. Your whole job: take **one** slice to a
linked stacked draft PR, **babysit that PR to GOAL MET** (CI, every configured
review bot, every thread — on GitHub), start the next session, end. The next
slice is only ever cut on top of a bot-reviewed, green, thread-resolved PR.
Everything below is work-slice with two substitutions — Step 2 (branches are
*created* here with `gh stack`, not renamed; all stack branches live in this
one worktree) and the end of Step 7 (pass the baton instead of reporting to a
human).

## 0. Preflight

- Read the slice checkpoint and engine `status` before fresh-run checks. A resumed writer may have recorded unfinished edits: compare them with its saved pre-pass status and owned paths, preserve them, and resume that stage. Unexplained dirty files are a blocker; never clean another session's work.
- Plugin + tools present: the skill you're reading proves the plugin; check
  `gh extension list | grep -q gh-stack || gh extension install github/gh-stack`,
  `git config rerere.enabled true`, `git config remote.pushDefault origin`.
- Read `.context/<ISSUE>/pipeline-state.md` (the previous session's
  checkpoint — same workspace, so it is here); note its `Tracker writes:`
  line — `planning` means every issue write below is **staged**, not posted
  (SKILL.md, "Tracker writes from the sandbox"), and the markers you read
  from other slices may live in `.context/<ISSUE>/tracker-writes-pending/`
  rather than on the tickets. Then the PRD ticket's
  description (`<PRD-ISSUE>`, the `PRD:` sub-issue of the feature ticket —
  its `## Implementation deltas` comments amend it). Never write on the
  feature ticket. Use the pinned `.context/<ISSUE>/planning/repo-config.md` for every engine init and model resolution. Planning docs are at the full docs OID in that checkpoint; read them with `git show <docs-oid>:CONTEXT.md`, never
  merge that branch into a stack branch.

## 1. Claim exactly one slice

Stack order is `/to-issues`' published numbering (`NN`). Read every slice's
PR state (`gh pr list --state all --search "<slice-id>"`) and its
`## Cloud dispatch` comment. Two cases, checked in this order:

- **An open PR with an unfinished required stage** — its checkpoint is not
  `COMPLETE`, its babysit evidence no longer matches the live head, or required
  Step 8 media is missing/stale. This includes GOAL MET recorded immediately
  before a worker died during capture. Stamp your session ID on the marker,
  check out the PR's actual owning branch with a clean or accounted-for tree,
  and resume the first unfinished stage. Complete pending engine/browser work;
  run §3b only when current-head babysit is owed; otherwise go straight to Step 8.
  Do not cut the next slice until required media is published (or a concrete
  not-applicable reason is recorded for that head) and the checkpoint is COMPLETE.
- Otherwise the slice to work is the **earliest in stack order with neither
  an open nor a merged PR**. Then:

- Its `## Cloud dispatch` comment already names **another** session with no PR
  → that session died mid-slice (SKILL.md's outside check sent you). Resume
  it: work-slice re-enters from `.context/<slice-id>/workflow-state.md` and
  the engine's `status`; update the comment with your session id and note the
  resume in the pipeline checkpoint.
- Its predecessor (the slice before it in stack order) has neither an open nor
  a merged PR → the relay is out of order; stop, report Blocked. Never skip
  ahead.
- Otherwise it's yours. Do work-slice **Step 1** verbatim: clear `<NEXT>`
  (additive label write), set status `<IN-PROGRESS>`, read a `<HITL>` label or
  "needs a human decision" line as an assumption to make and record (never a
  stop), disclose a routing mismatch if any. Post / update the slice's
  **`## Cloud dispatch`** comment: pipeline workspace deep link, this session
  id, docs branch, `dispatched-by: feature-goal relay`. A `403` on any of
  these writes is not a stop: stage the write
  (`.context/<ISSUE>/tracker-writes-pending/`), flip the checkpoint to
  `Tracker writes: planning` if it wasn't already, and carry on — the
  planning session flushes the queue. Checkpoint `CLAIMED`
  in `.context/<slice-id>/workflow-state.md`; update the pipeline checkpoint
  (`Slice cursor`, `Relay`).

## 2. Cut the branch with `gh stack` (replaces work-slice Step 2)

Branch name `<project-slug>/<NN>-<issue-id>` (kebab-cased project name,
zero-padded stack index, slice id). Load the `gh-stack` skill first; every
command non-interactive (explicit branch args, `--json`).

- **First slice of the stack** (skeleton, or the first slice after a merged
  predecessor): `git fetch origin && git checkout -B <BASE> origin/<BASE>`,
  then `gh stack init --base <BASE> <stack-name>` — creates the branch off
  `<BASE>`, checks it out, starts local tracking.
- **Every later slice**: check out the predecessor's stack branch —
  `gh stack checkout <predecessor-branch>` (local tracking exists in this
  workspace; if it doesn't, `gh stack checkout <predecessor PR number>` pulls
  the stack down from GitHub) — then `gh stack add <stack-name>` — creates the
  branch on top of the predecessor and checks it out.
- Verify: `git log --oneline -1` is the predecessor's tip (or `origin/<BASE>`
  for the first slice); `gh stack view --json` lists the chain bottom → top
  with this branch on top.

Checkpoint `BRANCH_READY` (full OIDs). Never rename, reset or force-push a
predecessor's branch here — lower layers are only changed by babysit, with
`gh stack rebase --upstack`.

## 3. Run work-slice Steps 3 → 6

Run the `magnus:work-slice` skill for this slice **starting at Step 3**,
verbatim: implement + engine-CLI review loop (the implementer and every fix
pass are freshly spawned agents per its writer-spawn ladder — you orchestrate,
you don't implement), the artifact-free Playwright user-story loop (it captures
nothing — all visual evidence is Step 8's, after this PR's babysit verdict), the
text-only QA evidence + consolidation tickets, then Step 5 with these readings:

- **5.1 (stale remote branch)** — does not apply: nothing was renamed.
- **Push** with `gh stack push --remote origin` (pushes the tracked stack;
  predecessors are unchanged so only this branch moves) — or
  `git push -u origin <stack-name>` if tracking is absent.
- **5.2** — `<PR-SKILL>` opens the draft PR verbatim (it targets `<BASE>`);
  the `## Verification` (+ `## Notes`) insert is the body write here. No
  `## Visual verification` and no media publish yet — that is Step 8, after
  §3b's verdict.
- **5.3** — link by PR number, bottom → top, never `--open`, never `submit`:
  `gh stack link --base <BASE> <pr-01> … <this-pr>` (skeleton alone: nothing
  to link yet). Then `gh pr view <n> --json baseRefName,isDraft` must show
  the predecessor's branch and `true`.
- **5.4** — no PR comment: the human-relevant residue is `## Notes` in the body write of 5.2b; provenance and the ledger stay in `.context/`.

Then Step 6 (advance `<NEXT>`, skeleton map, PRD-ticket deltas) to checkpoint
`HANDED_OFF`, and go straight into §3b.

Safety stops are Blocked, not a reason to improvise: no committed diff,
gut-check `hard-stop`, a dirty tree. Report where it stopped and end
**without** starting the next session.

## 3b. Run work-slice Step 7 — babysit this PR to its verdict

Run **`/babysit-stack <this PR number>`** here, in this session, to its
terminal verdict — exactly work-slice Step 7. It gets CI green, requests
`<BOT>` and fixes until satisfied, summons `<COMMENT-BOT>` and fixes until
satisfied, resolves every thread, and waits for each bot round itself with
bounded polls; every fix is a fresh agent per its own rules. `<BOT>` /
`<COMMENT-BOT>` unconfigured → it records `n/a` for that phase and the rest
still applies. Its state file (`.context/babysit-<ISSUE>.json`) lives in
this workspace, so a re-run resumes rather than restarts.

Record the verdict in **two** places: the slice checkpoint (`BABYSAT` on GOAL
MET, `COMPLETE` once Step 8 has published, else `HANDED_OFF` + the verdict line) and a `babysit: GOAL MET` /
`babysit: NOT MET — <reason>` line on the slice's `## Cloud dispatch` comment
(the durable marker every other session reads; staged under `Tracker writes:
planning`). The verdict is **not** a PR comment — babysit's own rule; the PR
body's `## Verification` refresh is the only PR write this step makes beyond
thread replies. Then:

- **GOAL MET** → run **work-slice Step 8** here, in this session, before
  anything else: capture this PR's scenes on its finished branch, publish them
  to `<MEDIA-BRANCH>` under `pr/<n>/`, insert `## Visual verification` into the
  body with one `gh pr edit`. Record `sourceHead` in its media manifest; recapture after any later head change —
  `/feature-goal`'s QA handoff re-uses these files. Then §4, then §5 (pass the
  baton).
- **NOT MET** → by construction only `needs-human` threads, a stuck bot, or
  a capped fix signature remain. That is **Blocked**: rewrite the pipeline
  checkpoint, report the blockers verbatim as the stop reason, and end
  **without** starting the next session. The human acts on the PR and
  re-invokes `/feature-goal <ISSUE>`; the next PR session finds this slice
  under §1's first case and resumes its babysit before anything else.

## 4. Verify from durable markers, not from memory

`.context/<slice-id>/workflow-state.md` reads `COMPLETE` (babysit GOAL MET and
Step 8 published); the PR body carries `## Visual verification` pinned to a
`<MEDIA-BRANCH>` sha (or its one-line form); the slice's
`## Cloud dispatch` comment carries `babysit: GOAL MET` (or its staged copy
does, under `Tracker writes: planning`); `gh pr view` shows
an open **draft** PR on `<stack-name>` with the predecessor's branch as base
(or `<BASE>` for the first), CI green, no unresolved review threads
(`gh pr view <n> --json reviewDecision,statusCheckRollup` + the thread query
babysit uses); `gh stack view --json` shows the chain; `git status
--porcelain` is clean. Markers short of that → you are still inside Step 3,
5 or 7; finish them. Rewrite the pipeline checkpoint.

## 5. Pass the baton and end

- **Another slice remains** (stack order, no open/merged PR): start the next
  session in **this** workspace — `create_session` via the Conductor MCP when
  reachable, else `conductor session create --workspace <this workspace id>
  --agent <agent> [--model <m> --effort <e>] --name "<NN>-<next-slice-id>"
  --message "/feature-goal <ISSUE>" --json`. Agent = the next slice's
  `<AGENT:>` label when present, else this runtime's agent; `<CLOUD-MODEL>` for
  that agent. Prompt exactly `/feature-goal <ISSUE>` — it re-detects the
  stage and finds itself here.
- **This was the last slice**: start the **babysit session** the same way,
  name `babysit-<ISSUE>`, prompt `/feature-goal <ISSUE>` (stage detection
  lands in BABYSIT inside the pipeline workspace). It is the stack-wide
  sweep: every PR was already babysat on its own, so it mostly confirms and
  yields the one verdict QA-HANDOFF keys on.
- Record the started session in the pipeline checkpoint (`Relay`), report
  (slice, PR link, assumptions, the session started, and — under `Tracker
  writes: planning` — every staged tracker write by file name) and **end**. Never
  wait for, poll or message the session you started; never claim a second
  slice.

If the spawn call fails: retry once; still failing → report Blocked with the
error verbatim (a later `/feature-goal <ISSUE>` from anywhere restarts the relay
from the markers).

Read `cloud-relay.md` for the required terminal result marker at every exit.
Resolve the successor's profile with the registry (`implementer` for a PR,
`dispatcher` for the stack babysit), using the pinned config. Persist intended
session/message UUIDs before creation, pass explicit model/effort, and check
that its runtime passed bootstrap. Nothing is watching this handoff live: the
recorded baton is what a later invocation follows.
