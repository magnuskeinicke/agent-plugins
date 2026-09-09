# Cloud bootstrap and dispatch

The caller's job is to hand work over, prove it started, and **end the run**.
Relay workers handle one PR each and start their own successor, so the relay
propels itself with nothing alive outside the pipeline workspace. A caller that
sits and polls a cloud worker is pure waste — and in a local worktree it defeats
the point of cloud dispatch, which is that the user's machine can be closed.
Recovery and queued tracker publication happen at the **next invocation**, not
in a watch loop.

## Prepare a reproducible handoff

Before creating work, read the routing labels on all selected tickets and
resolve every destination with the shared runtime contract's `model --cloud`.
Pass explicit model and effort on **every** session, including bootstrap,
replacement workers and the final babysit session. A slice uses `implementer`;
the stack babysit session uses `babysitter`. Labels choose the runtime, the
registry chooses its model. Verify these IDs against `conductor model --json`.

For every final babysit session, including recovery, use this handoff in the
message file (substitute the actual IDs):

```text
/feature-goal <ISSUE>
You are the final stack babysitter in pipeline workspace <workspace-id>.
Resume stage detection from the checkpoint. At BABYSIT, run /babysit-stack <PRD-ISSUE> in this session, then complete QA-HANDOFF.
If the recorded Relay session is this session, its working status is your own. Continue the work; do not report yourself as an external worker and stop.
```

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
branch/OID where applicable, claim owner, generated ticket inventory, PR → issue
mapping, selected runtimes, resolved profiles, the exact
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
   For standalone planning-write mode, run `/work-issue`'s resume/preflight
   checks now and include its exact parent claim payload in the bootstrap
   result for the caller to apply before starting the implementation session.
5. Report `BOOTSTRAP OK` plus installed versions, checked runtimes and
   `TRACKER WRITES: sandbox | planning`, or `BOOTSTRAP FAILED: <reason>`.

Before dispatch in planning-write mode, apply and read back the parent's claim
through the authorized caller, using `issue-lifecycle.md`. For a standalone run,
this is the bootstrap/worker's exact claim payload after its fresh-run preflight;
the dispatcher only relays that payload. Record the acknowledged claim in the
destination checkpoint. A queued claim does not reserve an issue.

Bootstrap has a three-minute bound, with status checks at 60-second intervals.
After success, start a **fresh** work session with `/feature-goal <ISSUE>` or
`/work-issue <ISSUE>`; it reads the persisted bootstrap state. Never launch a
runtime whose plugin or required capabilities failed the checks.

## Confirm the start, then stop

Confirming the start is the caller's last act: after creating the work session,
check its status at 60-second intervals until it reports working, bounded at
three minutes. A session that never leaves a pre-run status inside that bound is
a blocker (deep link + last observed status), never a reason to keep polling.
Once it is working, record the state below, report the workspace and session
deep links, end with the resume line, and **stop** — do not read its transcript,
do not wait for its PR, do not schedule a local follow-up.

Persist `.context/<ISSUE>/supervisor.json` in the caller's workspace as the
**carrier between invocations**, not as a watch-loop cursor:

```json
{"state":"watching","workspaceId":"<id>","sessionId":"<id>",
 "runtime":"codex","model":"gpt-5.6-sol","effort":"xhigh",
 "messageFile":"<absolute local file containing the resume command>",
 "restarts":0,"maxSessionMs":21600000}
```

Populate the model fields from resolution, not from this example. `watching` is
the engine's literal for "relay running, reconcile at the next invocation" — it
never means a process is watching. The message file contains the same workflow
invocation, so a replacement resumes durable stages in the existing workspace.

## Reconcile at re-entry

Every later invocation of the workflow from outside the pipeline workspace runs
**one** reconcile step against that state, acts on its outcome, and ends:

```bash
node "<plugin-root>/engine/supervise.mjs" .context/<ISSUE>/supervisor.json --once
```

The command takes exactly one step and exits — there is no watch mode to reach
for, and `--once` is only kept for compatibility. Never wrap it in a loop, a
`sleep`, or a background process. It locks the state file against a concurrent
reconcile. After an interrupted step, inspect the PID in `<state>.lock/pid`;
remove that lock only after proving the recorded process is gone. For an
MCP-only caller, take the same single step using session status, one paged
transcript read and at most one session creation; persist before mutating.

- Working → nothing to do: report the deep link and stop. A session exceeding
  six hours (configurable in the state) is a blocker; inspect it before starting
  another writer.
- Idle with a handoff marker → the relay already created its successor: adopt
  that session id (with its runtime/model/effort), reset the crash allowance,
  and stop.
- Idle without a marker → restart once in the **same** workspace, confirm the
  replacement reaches working, and stop. Persist the intended session/message
  UUIDs before creation; after an uncertain response, look up that session ID
  before retrying. Never create two replacement writers.
- A second silent death → blocked with the transcript and workspace link.
- Explicit `blocked` → report that blocker. `tracker-pending` → flush and verify
  completion below, then finish. `complete` → verify the live PR/ticket state
  before claiming DONE; a terminal marker alone is not verification evidence.

Between invocations the relay is unattended by design. A stalled worker costs
one re-invocation, which the user (or a schedule) triggers — that is the price
of running nothing locally, and it is the intended trade.

For ticket fan-out, keep one state per workspace and reconcile each once per
invocation. Existing working workspaces are adopted, never duplicated. Read
these states before selecting any new work.

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
the baton; no caller is listening, so the marker is the only record a later
invocation can read. An existing open PR is checked out on its owning branch
before resuming review, babysit or evidence capture.

## Tracker writes from the sandbox

Record `Tracker writes: sandbox | planning` in the shared checkpoint. In planning
mode, queue each denied operation under
`.context/<ISSUE>/tracker-writes-pending/<NN>-<kind>-<target>.json` with a stable
operation ID, kind, target, exact body/value and existing comment ID when known.
Kinds: comment upsert, label add/remove, assignee/ownership update, status update
(including GitHub project/label status and internal issue closure). Use local queued markers
for relay progress. Never discard a denied write or retry a known 403 repeatedly.

Include the exact queued payloads in each terminal session report so the caller
can retrieve them with **read-only** paged transcript queries. `conductor session
message` reads; it cannot ask a worker to print a file. If a payload is missing,
send a maintenance request with `conductor message create` to an idle worker,
then read its response; never start a competing implementation session.

Flushing is part of a reconcile step, never a reason to stay alive: an
invocation that finds queued writes applies them in order, upserting comments by
ID/heading and applying only the named field/state change, then ends. Read back
each effect before recording its operation ID as applied in local supervisor
state. Repeating a flush must not duplicate a comment or replay an older status
over a later acknowledged one. An unexpected permission change switches to
planning mode only if the caller can write; otherwise report the blocker with
the queue intact.

A worker that reports `tracker-pending` leaves the queue durable in the
workspace. Before flushing final transitions, verify current-head PR verdicts,
media and every PR's parent/generated-issue mapping. If stale, resume the owning
stage instead of applying a completion status. Flush the QA handoff, then all
owned generated descendants to Done (PRD last), then the human parent to Dev
technical review, using the resolved mapping in `issue-lifecycle.md`. Read back
the handoff and every affected status before marking supervisor state `complete`;
an old `complete` marker also requires this audit. Queued writes are never lost by stopping — they
wait in the queue for the invocation that can apply them.
