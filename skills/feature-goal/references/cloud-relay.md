# Cloud bootstrap and supervision

The planning or dispatching caller owns supervision until the work completes or
has a concrete blocker. Relay workers still handle one PR each and end after a
successful handoff. The caller stays available to recover a crashed worker and
publish queued tracker writes; it does not implement in a second workspace.

## Prepare a reproducible handoff

Before creating work, read the routing labels on all selected tickets and
resolve every destination with the shared runtime contract's `model --cloud`.
Pass explicit model and effort on **every** session, including bootstrap,
replacement workers and the final babysit session. A slice uses `implementer`;
the stack babysit session uses `dispatcher`. Labels choose the runtime, the
registry chooses its model. Verify these IDs against `conductor model --json`.

For a feature pipeline, commit and push planning documents first. Record the
docs branch and its full commit OID, then pin its config:

```bash
node "$engine" snapshot --ref <docs-commit-oid> \
  --output .context/<ISSUE>/planning/repo-config.md
```

For standalone ticket dispatch, snapshot the caller's resolved config without
`--ref`. An explicit ref or config that cannot be read is a blocker, never a
reason to use defaults. Planning documents are read at that OID, not at a moving
branch tip. Pass the snapshot with `--config` to engine initialization and model
resolution, including on branches cut from `<BASE>`. The engine persists the
resolved config in its ledger.

Write a bootstrap prompt file containing the feature/PRD or ticket IDs, docs
branch/OID where applicable, selected runtimes, resolved profiles, the exact
config snapshot and this bootstrap checklist. These are machine state, not a
second implementation brief. Use `--message-file` (MCP: its structured message
argument) to transfer it; local `.context/` does not travel to a cloud workspace.

1. Write the supplied snapshot and `.context/<ISSUE>/pipeline-state.md` in the
   destination workspace, including workspace ID, docs OID, tracker mode and
   the config path. Verify the fetched docs commit matches the supplied OID.
2. Install the plugin for **each runtime used by the selected work**, even if
   bootstrap itself runs in only one runtime. Claude: `claude plugin marketplace
   add magnuskeinicke/agent-plugins`, then `claude plugin install
   magnus@magnus-skills`; inspect `claude plugin list`. Codex: `codex plugin
   marketplace add https://github.com/magnuskeinicke/agent-plugins.git`, then
   `codex plugin add magnus@magnus-skills`; inspect its installed plugin list.
   Verify both resolve the same intended plugin version; record that version.
   For a feature stack, also install/check `github/gh-stack`.
3. Check each runtime's actual tracker, GitHub, browser and gate capabilities
   against the ticket and repo config. An in-app connector is not automatically
   available to a CLI child or another runtime. Verify tool availability in a
   fresh session of each required runtime after installation. Missing required
   tools → report the concrete capability and stop before claiming the ticket.
4. Probe tracker read and write access. For GitHub, re-add a label already on
   the issue (no label change); for Linear, check its actual connector in each
   destination runtime. Denied tracker writes may use the caller's queue below
   only when the caller has verified read/write access. Missing tracker reads
   or missing caller write access is a blocker.
5. Report `BOOTSTRAP OK` plus installed versions, checked runtimes and
   `TRACKER WRITES: sandbox | planning`, or `BOOTSTRAP FAILED: <reason>`.

Bootstrap has a three-minute bound, with status checks at 60-second intervals.
After success, start a **fresh** work session with `/feature-goal <ISSUE>` or
`/work-issue <ISSUE>`; it reads the persisted bootstrap state. Never launch a
runtime whose plugin or required capabilities failed the checks.

## Watch and recover

Persist `.context/<ISSUE>/supervisor.json` in the caller's workspace:

```json
{"state":"watching","workspaceId":"<id>","sessionId":"<id>",
 "runtime":"codex","model":"gpt-5.6-sol","effort":"xhigh",
 "messageFile":"<absolute local file containing the resume command>",
 "restarts":0,"maxSessionMs":21600000}
```

Populate the model fields from resolution, not from this example. The message
file contains the same workflow invocation, so a replacement resumes durable
stages in the existing workspace. With the local Conductor CLI:

```bash
node "<plugin-root>/engine/supervise.mjs" .context/<ISSUE>/supervisor.json --once
```

Run a step every 60 seconds, flush pending writes, and give the user progress.
The command also supports a bounded continuous watch when the host can yield
its output. It locks the state file against concurrent supervisors. After an
interrupted supervisor, inspect the PID in `<state>.lock/pid`; remove that lock
only after proving the recorded process is gone. Resume with the same state.
For an MCP-only caller, follow the same state transitions using session status,
paged transcript reads and session creation; persist before making mutations.

- Working → keep watching. A session exceeding six hours (configurable in the
  state) is a blocker; inspect it before starting another writer.
- Idle with a handoff marker → follow the named successor, including its
  runtime/model/effort. Reset the crash allowance for that new PR session.
- Idle without a marker → restart once in the **same** workspace. Persist the
  intended session/message UUIDs before creation; after an uncertain response,
  look up that session ID before retrying. Never create two replacement writers.
- A second silent death → blocked with the transcript and workspace link.
- Explicit `blocked` → report that blocker. `tracker-pending` → flush and verify
  completion below. `complete` → verify the live PR/ticket state before claiming
  DONE; a terminal marker alone is not verification evidence.

For ticket fan-out, keep one state per workspace and step them fairly. Existing
working workspaces are adopted and watched, never duplicated. On caller resume,
read these states before selecting any new work.

## Relay result protocol

At every worker exit, put one single-line marker in the **terminal session
report**, never in a PR or tracker comment. Obtain this session's actual ID from
Conductor. A handoff is emitted only after the successor was created and its
identity recorded in the pipeline checkpoint:

```text
<!-- magnus:relay {"sessionId":"<current>","state":"handoff","nextSessionId":"<next>","runtime":"claude","model":"opus-5-1m","effort":"xhigh"} -->
<!-- magnus:relay {"sessionId":"<current>","state":"complete"} -->
<!-- magnus:relay {"sessionId":"<current>","state":"blocked","reason":"<concrete blocker>"} -->
<!-- magnus:relay {"sessionId":"<current>","state":"tracker-pending","reason":"QA handoff awaits caller publication"} -->
```

Choose one, using actual resolved values. Record intended successor UUIDs before
creation and recover uncertain creation by ID. The PR worker ends after passing
the baton; the original caller keeps monitoring. An existing open PR is checked
out on its owning branch before resuming review, babysit or evidence capture.

## Tracker writes from the sandbox

Record `Tracker writes: sandbox | planning` in the shared checkpoint. In planning
mode, queue each denied operation under
`.context/<ISSUE>/tracker-writes-pending/<NN>-<kind>-<target>.json` with a stable
operation ID, kind, target, exact body/value and existing comment ID when known.
Kinds: comment upsert, label add/remove, status update. Use local queued markers
for relay progress. Never discard a denied write or retry a known 403 repeatedly.

Include the exact queued payloads in each terminal session report so the caller
can retrieve them with **read-only** paged transcript queries. `conductor session
message` reads; it cannot ask a worker to print a file. If a payload is missing,
send a maintenance request with `conductor message create` to an idle worker,
then read its response; never start a competing implementation session.

The caller flushes in order, upserting comments by ID/heading and applying only
the named label/status change. Read back each effect before recording its
operation ID as applied in local supervisor state. Repeating a flush must not
duplicate a comment or replay an older status over a later acknowledged one.
An unexpected permission change switches to planning mode only if the caller
can write; otherwise report the blocker with the queue intact.

At `tracker-pending`, flush the final QA handoff, verify it on the ticket and
verify the current-head PR verdicts and media. Only then mark supervisor state
`complete`. This caller stays active through publication; users do not need a
second invocation solely to flush the queue.
