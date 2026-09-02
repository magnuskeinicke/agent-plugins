# PR session — one slice, one session, one stack layer

You are a relay session inside the **pipeline workspace** (SKILL.md, "Which
session am I?"), at stage SLICE-LOOP. Your whole job: take **one** slice to a
linked stacked draft PR, start the next session, end. Everything below is
work-slice with two substitutions — Step 2 (branches are *created* here with
`gh stack`, not renamed; all stack branches live in this one worktree) and the
end of Step 6 (pass the baton instead of running Step 7).

## 0. Preflight

- Working tree clean (`git status --porcelain` empty) — a dirty tree is a
  safety stop: report it as Blocked, don't clean up another session's work.
- Plugin + tools present: the skill you're reading proves the plugin; check
  `gh extension list | grep -q gh-stack || gh extension install github/gh-stack`,
  `git config rerere.enabled true`, `git config remote.pushDefault origin`.
- Read `.context/<ISSUE>/pipeline-state.md` (the previous session's
  checkpoint — same workspace, so it is here) and the parent's `# PRD`
  comment. Planning docs are on the docs branch named there; read them from
  `origin/<docs-branch>` (`git show origin/<docs-branch>:CONTEXT.md`), never
  merge that branch into a stack branch.

## 1. Claim exactly one slice

Stack order is `/to-issues`' published numbering (`NN`). The slice to work is
the **earliest in stack order with neither an open nor a merged PR**
(`gh pr list --state all --search "<slice-id>"`). Then:

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
  id, docs branch, `dispatched-by: feature-goal relay`. Checkpoint `CLAIMED`
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
you don't implement), the Playwright user-story loop, QA evidence +
consolidation tickets, then Step 5 with these readings:

- **5.1 (stale remote branch)** — does not apply: nothing was renamed.
- **Push** with `gh stack push --remote origin` (pushes the tracked stack;
  predecessors are unchanged so only this branch moves) — or
  `git push -u origin <stack-name>` if tracking is absent.
- **5.2** — `<PR-SKILL>` opens the draft PR verbatim (it targets `<BASE>`);
  the evidence-sections insert is the one body write.
- **5.3** — link by PR number, bottom → top, never `--open`, never `submit`:
  `gh stack link --base <BASE> <pr-01> … <this-pr>` (skeleton alone: nothing
  to link yet). Then `gh pr view <n> --json baseRefName,isDraft` must show
  the predecessor's branch and `true`.
- **5.4** — the provenance / assumptions / ledger PR comment as written.

Then Step 6 (advance `<NEXT>`, skeleton map, parent deltas) to checkpoint
`HANDED_OFF`. **Do not run Step 7** — the babysit session owns the stack.

Safety stops are Blocked, not a reason to improvise: no committed diff,
gut-check `hard-stop`, a dirty tree. Report where it stopped and end
**without** starting the next session.

## 4. Verify from durable markers, not from memory

`.context/<slice-id>/workflow-state.md` reads `HANDED_OFF`; `gh pr view`
shows an open **draft** PR on `<stack-name>` with the predecessor's branch as
base (or `<BASE>` for the first); `gh stack view --json` shows the chain;
`git status --porcelain` is clean. Markers short of that → you are still
inside Step 3 or 5; finish them. Rewrite the pipeline checkpoint.

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
  lands in BABYSIT inside the pipeline workspace).
- Record the started session in the pipeline checkpoint (`Relay`), report
  (slice, PR link, assumptions, the session started) and **end**. Never
  wait for, poll or message the session you started; never claim a second
  slice.

If the spawn call fails: retry once; still failing → report Blocked with the
error verbatim (the human, or a `/feature-goal <ISSUE>` from anywhere,
restarts the relay from the markers).
