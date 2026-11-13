# Runtime and model contract

Read this when a workflow launches workers or selects a session model. Both
Claude and Codex use the same engine tasks and result schemas. The native Claude
agent definitions remain the reviewer personas; the Codex adapter reads those
same definitions.

## Resolve the engine and configuration

Resolve the real directory of the **loaded** skill before walking up to the
plugin root. Use the skill's actual path, including a Codex cache or symlink:

```bash
engine=$(node -e 'const fs=require("node:fs"),p=require("node:path");process.stdout.write(p.resolve(fs.realpathSync(process.argv[1]),"../..","engine/cli.mjs"))' "<absolute loaded skill directory>")
```

Before any config placeholders, tracker reads or stage detection, inspect the
run's `.context/<ISSUE>/pipeline-state.md` / bootstrap checkpoint. If it names a
pinned config, that file supplies **all** settings (tracker, labels, bots, gates,
routing and reviewer conventions), not only engine flags. Propagate its absolute
path to every constituent skill and worker brief, including `/babysit-stack`.
A missing named snapshot is a blocker. Only a run without a pinned config reads
the checkout's `docs/agents/repo-config.md`.

An absent optional `docs/agents/repo-config.md` uses defaults. An existing invalid config
is an error: fix its syntax/shape before dispatching or claiming work. Never
interpret parse errors as permission to change venue or skip configured gates.
For a pipeline, pass its pinned planning configuration with `--config <file>`
on `init`, `model`, `commit-rule`, `commit-check`, and standalone `task`
commands (after `init`, `--slice <run-id>` reads the ledger's pinned copy). `init` stores the resolved
configuration in the ledger; subsequent commands reuse it across resumes.

## Model roles

`engine/lib/models.mjs` owns the role registry and the skill-to-role map.
Resolve the actual runtime (`claude` or `codex`), then:

```bash
node "$engine" model --skill <skill-name> --runtime <runtime>
node "$engine" model --role reviewer --runtime <runtime>
node "$engine" model --role implementer --runtime <runtime> --cloud
```

The last form returns Conductor's model ID. Pass the returned `model` and
`effort` on session creation. For an existing user session, do not silently
switch models; delegate bounded work to the configured role. Interactive
grilling stays with the user in their selected session; use the planner role
when launching that session or a planning worker. Supporting skills explicitly
inherit the caller's resolved role.

| Roles | Claude | Codex | Effort |
| --- | --- | --- | --- |
| all roles | opus | gpt-6.1-sol | high |

`babysit-stack` and the feature pipeline's final babysit session use `babysitter`.
Its Codex default is independent of legacy model aliases; configure
`routing.models.babysitter.codex` to override it.

Host overrides: `routing.models.<role>.<runtime>` may set `model`, `effort`,
`cloudModel`, `timeoutMs`, or `access` (`read-only` / `workspace-write`). Existing
`routing.codexModelAliases` still maps roster pins, and `routing.cloudModels`
still supplies legacy planner/implementer/fixer cloud overrides. Explicit role
overrides take precedence. Unknown roles/aliases and invalid profiles fail;
there is no silent model inheritance for a worker.

## Run an emitted task

Each task has a persisted `taskFile`, `promptFile`, `outputFile`, schema, cwd,
role, and resolved `execution.claude` / `execution.codex`. `status` returns the
pending task manifests after interruption. The gut-check runs before the roster.
Read-only tasks may run concurrently within the host's worker limit; writers
run one at a time in the shared checkout.

- **Claude native:** launch the named agent definition as a fresh subagent,
  applying its resolved model/effort. Give it the task prompt; have it return
  JSON. The parent validates and writes that JSON to `outputFile`. Native
  subagents inherit the host's tools and permissions.
- **Codex native:** when native subagents expose the required model/effort and
  tools, launch a fresh worker with `execution.codex` and the agent-file body
  plus the task prompt. The parent validates and saves its JSON result.
- **CLI fallback for either runtime:** the executable adapter handles stdin,
  cwd, model/effort flags, explicit permission mode, timeout, exit status,
  schema validation and result persistence:

  ```bash
  node "$engine" run --task <taskFile> --runtime <runtime> --dry-run
  node "$engine" run --task <taskFile> --runtime <runtime>
  ```

The dry run prints the command without launching a model. CLI children use
their own CLI configuration/authentication, not the parent's in-app connectors.
In a Conductor cloud workspace the `claude` CLI child is not logged in (the
session's own auth does not reach it), so Claude-hosted cloud runs use native
subagents for every task; the CLI route fails with `Not logged in`.
Check the tools required for that task before choosing the CLI route. If they
are absent, use a native worker with those tools or report the missing
capability; never pretend coverage completed. No permission-bypass flags are
used. Configure the host CLI's allowed gate/git commands before unattended
writer runs; a denied command is reported, not silently approved by the adapter.

To prepare an implementation or other task outside a review round, write its
bounded prompt first, then use:

```bash
node "$engine" task --role implementer --schema implement \
  --prompt-file <prompt.md> --output-file <implement-result.json>
```

Other schemas: `babysit-fix`, `fix`, `findings`, `validation`, `adjudication`, `gut`. Add
`--agent <roster-id>` to include a vendored persona. Never resume a previous
worker for another pass; state travels in files.

If a writer can edit source but cannot commit in its sandbox, it returns
`committed=false`, the exact `editedFiles`, and test evidence. The parent checks
the diff against those files and the pre-pass status, runs any denied gates,
stages only those owned paths, commits, then updates `committed`, `head`, and
gate evidence from actual results before `init` / `apply-fix`. The parent's
commit subject follows the repo's commit rule — `node "$engine" commit-rule
--slice <run-id> --subject "<one line>"` prints it as `subject` — and must pass
`node "$engine" commit-check --range <pre-commit-head>..HEAD` before `init` /
`apply-fix`; reword with `git commit --amend -m` on a mismatch. Unknown or
pre-existing dirty files remain untouched. Claude workers that can commit
continue doing so; the parent still verifies their commit and evidence.

## Incomplete coverage and scratch ownership

Every emitted reviewer must return valid JSON with its own identity. Retry a
dead task once. Still missing/invalid → `incomplete`: preserve the round and
report the blocker. Never advance to PR creation or claim clean/converged.
Re-invocation runs only the unfinished tasks, then `collect` again.

Keep scratch artifacts inside the run's gitignored `.context/` or test-output
directory. If a temporary spec must live in a source directory, record its
exact path in `scratch-files.json` **before creating it**, after checking that
the path does not already exist. Delete only those owned scratch files.
Untracked status alone never proves ownership.

Adapter interfaces follow the [Codex noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
and [Claude programmatic interface](https://code.claude.com/docs/en/headless).
