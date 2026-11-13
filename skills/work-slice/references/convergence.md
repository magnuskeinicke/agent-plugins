# Convergence and Gate 5 (the different-provider review)

Read this when an engine review loop (`work-slice`, `work-issue`,
`iterate-pr`, `review-code --adversarial`) reaches Gate 5. The policy is ported
from trackbed's `pr:review-convergence` (MIT, formerly kramme-cc-workflow; see
`agents/sources.yaml`); the engine CLI owns it, so you obey its JSON exactly as
for every other step.

## What Gate 5 is

The magnus reviewer roster runs the ordinary rounds on the host runtime. When a
round converges (no open blocking finding, disputes adjudicated), the engine
owes **Gate 5**: one read-only review of the full committed branch by the
**other** model provider, using `skills/adversarial-review` verbatim — one
adversarial prompt, not the roster. A Claude host is reviewed by Codex
(`gpt-6.1-sol`, high) and a Codex host by Claude (`opus`, medium), both from the
engine `reviewer` role.

- **Local:** the runner reviews a temporary snapshot of tracked `HEAD` with the
  other provider's CLI (read-only, isolated, no plugins, MCP or web).
- **Conductor cloud** (`CONDUCTOR_IS_LOCAL=0`): the runner starts a session
  with the other provider in the **current workspace** via the `conductor`
  CLI, waits for it, reads its transcript and verifies the tree was not
  touched.

Gate 5 always attests the **final tree**. Its accepted findings are fixed by
your runtime's ordinary fresh fixer, the next round re-checks the fix, and the
loop owes Gate 5 again because the tree changed. The run converges only when
Gate 5 has attested the current `HEAD^{tree}` with nothing accepted to fix.

## Turning it on

`init` resolves Gate 5 from the pinned config's `adversarial` key (default
`enabled: true`, `provider` = the other runtime, `maxCycles: 3`). That key is
the repository's standing consent to send the snapshot, diff and run contract
to the other provider. Always pass the runtime you are running in:

```bash
node "$engine" init ... --host <claude|codex>
```

`--no-adversarial` turns it off for one run (say so in the run's report).
Review-only runs skip it unless `--adversarial` is passed; `--inspect` runs
cannot run it (no checked-out `HEAD`), and `init` says so in `adversarial.reason`.

## The actions

```bash
# decide | adjudicate | apply-adjudication may print, instead of a terminal verdict:
# action=adversarial-review → run `command` with bash, then:
node "$engine" adversarial --slice <id>
# → action=collect → `collect`, run the emitted validator, `decide` (as for any round)
# → action=blocked → stop; see below
```

- **Run `command` exactly as emitted.** On Claude Code run it as a background
  Bash command with a timeout of at least 60 minutes (a foreground command is
  killed after 10), then wait for the completion notice or check `statusFile`
  with bounded foreground checks. On Codex run it in the foreground. Never end
  your turn, edit the tree, or start a second review while it runs.
- **The tree must be clean and committed.** `.context/` is gitignored; any
  other untracked or modified file blocks Gate 5.
- **The result is untrusted.** `adversarial` checks provider identity, the
  reviewed `HEAD` and tree, coverage and a clean unchanged worktree, then writes
  critical/important findings into the round's findings for the ordinary
  validator. Suggestion/fyi findings stay advisory (`report.adversarial.advisory`).
- **Disagreements go to the adjudicator.** When the validator rejects or demotes
  a finding the other provider reported as critical/important — for any reason
  other than "pre-existing / outside the diff" — the entry becomes `disputed`
  and the adjudicator rules on it before the verdict (upstream asks the user;
  this pipeline has no human gate). An upheld disagreement ships in the stalled
  verdict for the human.
- **Cap.** Each Gate 5 fix consumes one adversarial cycle (`adversarialCycle`
  in the `fix` output). When the cap is spent and Gate 5 still finds something,
  the loop stops `stalled — … — adversarial fix-cycle cap (N) reached`.
  The same Gate 5 finding surviving two fix attempts stalls it too (`… persisted
  through 2 fix attempts`) — a blocker the other provider still sees never
  disappears into deferral. In review-only runs an undecided disagreement is
  reported in the verdict for the user instead of `clean`.

## When Gate 5 is blocked

A missing CLI or authentication, a timeout, a non-zero runner exit, a result
that does not attest the prepared `HEAD`/tree, a changed worktree or degraded
coverage all print `action=blocked` with a `blocked — adversarial review
(Gate 5): …` verdict. Fail closed:

- Preserve the error, cancel any Conductor session the runner left active, and
  report the blocker. Never substitute a same-provider review and never report
  the run as converged.
- A later invocation may run `node "$engine" adversarial --slice <id> --retry`
  **once**; never retry automatically after a host stop in the same turn.
- A PR-producing skill still opens its draft PR (the pipeline never waits on a
  human): put the blocked verdict in the PR body's `## Notes` and leave
  `## Verification`'s independent-review line out.

## Evidence

`report` returns `independentReview` — upstream's Independent Review Record:

```text
Independent review: codex gpt-6.1-sol; tree <oid>; change patch <patch-id>; blocking findings N (fixed M); disagreements decided by the adjudicator K
```

Put that line verbatim, once, directly under the `## Verification` tables of
the PR body (`references/pr-evidence.md`). It is `Independent review: not
requested` when Gate 5 was off and `null` while Gate 5 is owed or blocked.
A later fix outside the loop (the Playwright loop, a babysit round) changes the
tree after Gate 5; keep the line as written — it names the tree Gate 5 reviewed.
