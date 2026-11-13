// The local adversarial-review runner copies HEAD into a snapshot for the other
// provider. Repos expose skills to other agents through in-repo symlinks
// (.agents/skills/<name> -> ../../.claude/skills/<name>); the snapshot must keep
// them as links, while links that leave the repo or dangle still fail closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'adversarial-review', 'scripts', 'run-adversarial-review.sh');

// Stands in for the Codex CLI: reports whether the snapshot kept the skill link
// and could read through it, then writes a schema-valid review to `-o`.
const FAKE_CODEX = `#!/bin/bash
while [ $# -gt 0 ]; do
  case "$1" in
    -C) dir=$2; shift ;;
    -o) out=$2; shift ;;
  esac
  shift
done
cat > /dev/null
link="$dir/.agents/skills/demo"
if [ -L "$link" ] && [ "$(readlink "$link")" = "../../.claude/skills/demo" ] && grep -q 'demo skill' "$link/SKILL.md"; then
  seen="kept-link"
else
  seen="lost-link"
fi
printf '{"summary":"%s","findings":[],"positive_observations":[],"coverage":{"files_examined":["a.txt"],"limitations":[]}}' "$seen" > "$out"
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(extraLink) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adv-snapshot-')));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), FAKE_CODEX);
  chmodSync(join(bin, 'codex'), 0o755);

  mkdirSync(join(repo, '.claude', 'skills', 'demo'), { recursive: true });
  mkdirSync(join(repo, '.agents', 'skills'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'skills', 'demo', 'SKILL.md'), '# demo skill\n');
  symlinkSync('../../.claude/skills/demo', join(repo, '.agents', 'skills', 'demo'));
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.symlinks', 'true');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  writeFileSync(join(repo, 'a.txt'), 'two\n');
  if (extraLink) symlinkSync(extraLink, join(repo, 'extra'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'change');
  return { repo, bin, base };
}

function runReview({ repo, bin, base }) {
  return spawnSync(RUNNER, ['--host-provider', 'claude', '--provider', 'codex', '--merge-base', base, '--model', 'test-model'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONDUCTOR_IS_LOCAL: '1' },
  });
}

test('an in-repo skill symlink stays a readable link in the snapshot', () => {
  const result = runReview(makeRepo());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary, 'kept-link');
});

test('a symlink that leaves the repository still blocks the review', () => {
  const result = runReview(makeRepo('../outside'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink points outside the repository: extra/);
});

test('an absolute symlink still blocks the review', () => {
  const result = runReview(makeRepo('/etc/hosts'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink points outside the repository: extra/);
});

test('a dangling in-repo symlink still blocks the review', () => {
  const result = runReview(makeRepo('missing/file'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink target is not in HEAD: extra -> missing\/file/);
});
