// The adversarial-review runner in Conductor cloud mode: it starts a session in
// the current workspace with the other provider's agent, and takes the result
// from the gitignored handoff file the reviewer writes, falling back to the
// transcript. A fake `conductor` CLI stands in for the Conductor API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'adversarial-review', 'scripts', 'run-adversarial-review.sh');
const REVIEW = '{"summary":"SUMMARY","findings":[],"positive_observations":[],"coverage":{"files_examined":["a.txt"],"limitations":[]}}';

// FAKE_MODE=file: the reviewer writes the handoff file and the transcript is
// unreadable. FAKE_MODE=transcript: no file, the reply is a fenced Codex final
// answer. Every call is logged so the test can check the create arguments.
const FAKE_CONDUCTOR = `#!/bin/bash
state="$FAKE_STATE"
printf '%s\\n' "$*" >> "$state/calls"
[ "$1" = "--json" ] && shift
case "$1 $2" in
  "session create")
    shift 2
    while [ $# -gt 0 ]; do
      case "$1" in
        --session-id) id=$2; shift ;;
        --message-file) msg=$2; shift ;;
      esac
      shift
    done
    cp "$msg" "$state/prompt"
    printf '%s' "$id" > "$state/id"
    printf '{"id":"%s","resolvedModel":"gpt-test"}' "$id"
    ;;
  "session status")
    n=$(cat "$state/polls" 2> /dev/null || echo 0); n=$((n + 1)); echo "$n" > "$state/polls"
    if [ "$n" -eq 1 ]; then echo '{"status":"working"}'; exit 0; fi
    if [ "$FAKE_MODE" = "file" ] && [ "$n" -eq 2 ]; then
      out=$(grep -o "write the final JSON result to [^ ]*\\.json" "$state/prompt" | sed 's/.* to //')
      printf '%s' '${REVIEW.replace('SUMMARY', 'from-file')}' > "$out"
    fi
    echo '{"status":"idle"}'
    ;;
  "session message")
    if [ "$FAKE_MODE" = "failed" ]; then
      printf '%s' '{"data":[{"type":"agent","content":{"rawPayload":{"event":{"type":"turn.failed","error":{"message":"Your ChatGPT login has expired."}}}}}],"hasMore":false}'
      exit 0
    fi
    [ "$FAKE_MODE" = "transcript" ] || { echo "transcript unavailable" >&2; exit 1; }
    text=$(printf '%s' '\`\`\`json\\n${REVIEW.replace('SUMMARY', 'from-transcript').replace(/"/g, '\\"')}\\n\`\`\`')
    printf '{"data":[{"type":"agent","content":{"rawPayload":{"event":{"type":"item.completed","item":{"type":"agentMessage","phase":"final_answer","text":"%s"}}}}}],"hasMore":false}' "$text"
    ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo({ ignoreContext = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adv-conductor-')));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  mkdirSync(bin);
  mkdirSync(state);
  writeFileSync(join(bin, 'conductor'), FAKE_CONDUCTOR);
  chmodSync(join(bin, 'conductor'), 0o755);
  mkdirSync(repo);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  if (ignoreContext) appendFileSync(join(repo, '.git', 'info', 'exclude'), '.context/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  git(repo, 'commit', '-q', '-am', 'change');
  return { repo, bin, state, base };
}

function runReview({ repo, bin, state, base }, mode) {
  return spawnSync(RUNNER, ['--host-provider', 'claude', '--provider', 'codex', '--merge-base', base, '--model', 'test-model'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONDUCTOR_IS_LOCAL: '0', CONDUCTOR_WORKSPACE_ID: 'ws-1',
      ADVERSARIAL_REVIEW_POLL_INTERVAL: '0', FAKE_STATE: state, FAKE_MODE: mode },
  });
}

test('a cloud review starts a Codex session in the current workspace and reads the handoff file', () => {
  const ctx = makeRepo();
  const result = runReview(ctx, 'file');
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.summary, 'from-file');
  assert.equal(out.execution_mode, 'conductor');
  assert.equal(out.review_provider, 'codex');
  const create = readFileSync(join(ctx.state, 'calls'), 'utf8').split('\n').find((l) => l.includes('session create'));
  assert.match(create, /--workspace ws-1 /);
  assert.match(create, /--agent codex /);
  assert.doesNotMatch(readFileSync(join(ctx.state, 'calls'), 'utf8'), /workspace create/);
  // The handoff file is removed and the tree stays clean.
  assert.deepEqual(readdirSync(join(ctx.repo, '.context', 'adversarial-review')), []);
  assert.equal(git(ctx.repo, 'status', '--porcelain'), '');
});

test('without a handoff file the fenced transcript reply is still accepted', () => {
  const result = runReview(makeRepo(), 'transcript');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary, 'from-transcript');
});

test('when .context is not gitignored the runner asks for no file and uses the transcript', () => {
  const ctx = makeRepo({ ignoreContext: false });
  const result = runReview(ctx, 'transcript');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /is not gitignored/);
  assert.doesNotMatch(readFileSync(join(ctx.state, 'prompt'), 'utf8'), /write the final JSON result/);
  assert.equal(existsSync(join(ctx.repo, '.context')), false);
});

test('a failed reviewer turn blocks with the provider\'s own error', () => {
  const result = runReview(makeRepo(), 'failed');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the codex reviewer session failed: Your ChatGPT login has expired\./);
});
