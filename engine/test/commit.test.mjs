// The commit-subject rule: config resolution, prompt rendering, and the
// engine's deterministic enforcement (init, apply-fix, commit-check) against a
// real temp git repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoConfig, parseRepoConfig } from '../lib/config.mjs';
import { resolveCommitRule, renderCommitSubject, commitOffenders } from '../lib/commit.mjs';
import { fixPrompt } from '../lib/prompts.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
// melatech-io/voice-to-text's `development` ruleset commit_message_pattern.
const VTT_PATTERN = '^(feat|fix|perf|build|refactor|chore|docs|test|ci|tool)(\\([a-zA-Z0-9\\-]+\\))?: .+';
const SER_TITLE_RULE = '<type>[(<scope>)]: SER-XX <subject>';

function repo(t, config) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-commit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'chore: base');
  const commit = (subject) => {
    git('commit', '-q', '--allow-empty', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  mkdirSync(join(dir, 'docs/agents'), { recursive: true });
  writeFileSync(join(dir, 'docs/agents/repo-config.md'), `## Config\n\n\`\`\`json\n${JSON.stringify(config)}\n\`\`\`\n`);
  const exec = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CONDUCTOR_DEFAULT_BRANCH: '' } });
  const run = (...args) => {
    const r = exec(...args, '--slice', 'SER-1633', '--dir', join(dir, '.context'));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return { dir, git, commit, exec, run, base: git('rev-parse', 'HEAD') };
}

test('resolution: explicit commit.* → pr.titleRule → pr.scopes → plain conventional', () => {
  const explicit = resolveCommitRule(resolveRepoConfig({
    commit: { format: '<type>[(<scope>)]: SER-XX <subject>', pattern: VTT_PATTERN },
    pr: { titleRule: '<type>: <subject>' },
  }));
  assert.deepEqual(explicit, { format: SER_TITLE_RULE, pattern: VTT_PATTERN, source: 'commit' });

  const fromTitle = resolveCommitRule(resolveRepoConfig({ pr: { titleRule: SER_TITLE_RULE, scopes: ['web', 'api'] } }));
  assert.equal(fromTitle.source, 'pr.titleRule');
  assert.equal(fromTitle.format, SER_TITLE_RULE);
  assert.equal(fromTitle.pattern, '^[a-z]+(?:\\((?:web|api)\\))?: SER-\\d+ \\S.*$');

  const fromScopes = resolveCommitRule(resolveRepoConfig({ pr: { scopes: ['web'] } }));
  assert.equal(fromScopes.source, 'pr.scopes');
  assert.equal(fromScopes.format, '<type>[(<scope>)]: <subject>');

  const fallback = resolveCommitRule(resolveRepoConfig({}));
  assert.deepEqual(fallback, { format: '<type>: <subject>', pattern: '^[a-z]+: \\S.*$', source: 'default' });

  const proseTitle = resolveCommitRule(resolveRepoConfig({ pr: { titleRule: 'Conventional commits, ticket id after the colon' } }));
  assert.equal(proseTitle.pattern, '', 'a non-template title rule derives no pattern');

  assert.throws(() => parseRepoConfig('## Config\n```json\n{"commit":{"pattern":"^(feat"}}\n```\n'), /commit\.pattern/);
});

test('example subjects render from the rule, never with the issue id first', () => {
  const rule = resolveCommitRule(resolveRepoConfig({ pr: { titleRule: SER_TITLE_RULE } }));
  assert.equal(renderCommitSubject(rule, { issue: 'SER-1633', type: 'feat', scope: 'web' }), 'feat(web): SER-1633 <subject>');
  assert.equal(renderCommitSubject(rule, { issue: 'SER-1633', type: 'fix' }), 'fix: SER-1633 <subject>');
  assert.equal(renderCommitSubject(rule, { type: 'feat' }), '', 'an unfillable issue slot yields no example');
  assert.equal(renderCommitSubject(rule, { issue: 'SER-7', type: 'fix', scope: 'api', subject: 'guard null' }), 'fix(api): SER-7 guard null');
});

test('voice-to-text pattern: rejects an issue-first subject, accepts the rule shape', () => {
  const rule = resolveCommitRule(resolveRepoConfig({ commit: { format: SER_TITLE_RULE, pattern: VTT_PATTERN } }));
  const offenders = commitOffenders(rule, [
    { sha: 'a'.repeat(40), subject: 'SER-1633 feat(web): x' },
    { sha: 'b'.repeat(40), subject: 'feat(web): SER-1633 x' },
  ]);
  assert.deepEqual(offenders, [{ sha: 'a'.repeat(40), subject: 'SER-1633 feat(web): x' }]);
});

test('fix prompt states the resolved format, an example, and a separate push ban', () => {
  const text = fixPrompt('contract', [], 'git diff main...HEAD', 'Commit message subject: `x` — e.g. `feat(web): SER-1633 <subject>`.', 'out.json');
  assert.match(text, /feat\(web\): SER-1633 <subject>/);
  assert.match(text, /Never `git push`/);
  assert.doesNotMatch(text, /starts with the (slice|issue) id/i);
});

test('dry run: titleRule-derived rule reaches the implement text and every fix prompt', (t) => {
  const { run, commit, base } = repo(t, { pr: { titleRule: SER_TITLE_RULE } });
  const implement = run('commit-rule', '--type', 'feat', '--scope', 'web', '--issue', 'SER-1633');
  assert.equal(implement.example, 'feat(web): SER-1633 <subject>');
  assert.match(implement.text, /feat\(web\): SER-1633 <subject>/);

  commit('feat(web): SER-1633 add widget');
  const init = run('init', '--base', base, '--tests-green', 'false', '--commit-scope', 'web');
  assert.equal(init.commitCheck.status, 'ok');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  assert.equal(plan.action, 'gate-fix');
  const prompt = readFileSync(plan.fix.promptFile, 'utf8');
  assert.match(prompt, /<type>\[\(<scope>\)\]: SER-XX <subject>/);
  assert.match(prompt, /e\.g\. `feat\(web\): SER-1633 <subject>`/);
  assert.match(prompt, /Never `git push`/);
  assert.doesNotMatch(prompt, /starts with the (slice|issue) id/i);

  const subject = run('commit-rule', '--type', 'fix', '--subject', 'guard null');
  assert.equal(subject.subject, 'fix(web): SER-1633 guard null', 'ledger context supplies issue and scope');
});

test('init: an implement commit that breaks the rule becomes a commit-subject gate-fix', (t) => {
  const { run, commit, base } = repo(t, { commit: { format: SER_TITLE_RULE, pattern: VTT_PATTERN } });
  const bad = commit('SER-1633 feat(web): x');
  const init = run('init', '--base', base);
  assert.equal(init.commitCheck.status, 'rejected');
  assert.deepEqual(init.commitCheck.offenders, [{ sha: bad, subject: 'SER-1633 feat(web): x' }]);
  const plan = run('plan', '--changed-files', 'src/a.ts');
  assert.equal(plan.action, 'gate-fix');
  const prompt = readFileSync(plan.fix.promptFile, 'utf8');
  assert.match(prompt, new RegExp(`${bad.slice(0, 12)} SER-1633 feat\\(web\\): x`));
  assert.match(prompt, new RegExp(`git reset --soft ${base}`));
});

test('apply-fix refuses a fix range with a non-matching subject, then accepts the rewrite', (t) => {
  const { run, exec, git, commit, dir, base } = repo(t, { commit: { format: SER_TITLE_RULE, pattern: VTT_PATTERN } });
  const head = commit('feat(web): SER-1633 add widget');
  run('init', '--base', base, '--tests-green', 'false');
  const plan = run('plan', '--changed-files', 'src/a.ts', '--head', head);
  const badHead = commit('SER-1633 fix(web): tests');
  const result = { summary: 'fixed', committed: true, head: badHead, testsGreen: true, testEvidence: 'ok' };
  writeFileSync(plan.fix.outputFile, JSON.stringify(result));
  const refused = exec('apply-fix', '--result', plan.fix.outputFile, '--slice', 'SER-1633', '--dir', join(dir, '.context'));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /apply-fix refused/);
  assert.match(refused.stderr, new RegExp(`${badHead.slice(0, 12)} SER-1633 fix\\(web\\): tests`));
  assert.equal(run('status').phase, 'fix', 'a refused fix leaves the round pending');

  git('commit', '-q', '--amend', '--allow-empty', '-m', 'fix(web): SER-1633 tests');
  writeFileSync(plan.fix.outputFile, JSON.stringify({ ...result, head: git('rev-parse', 'HEAD') }));
  assert.equal(run('apply-fix', '--result', plan.fix.outputFile).action, 'review');
});

test('commit-check: reports the offending sha and subject, exits non-zero', (t) => {
  const { exec, commit, base, dir } = repo(t, { commit: { pattern: VTT_PATTERN } });
  commit('feat(web): SER-1633 ok');
  const bad = commit('SER-1633 feat(web): x');
  const r = exec('commit-check', '--base', base);
  assert.equal(r.status, 1);
  const outp = JSON.parse(r.stdout);
  assert.equal(outp.ok, false);
  assert.equal(outp.checked, 2);
  assert.deepEqual(outp.offenders, [{ sha: bad, subject: 'SER-1633 feat(web): x' }]);
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--amend', '--allow-empty', '-m', 'feat(web): SER-1633 x'], { cwd: dir });
  assert.equal(exec('commit-check', '--base', base).status, 0);
});

test('snapshot pins the resolved commit rule for relay and babysit sessions', (t) => {
  const { exec, dir } = repo(t, { pr: { titleRule: SER_TITLE_RULE } });
  const outFile = join(dir, '.context/planning/repo-config.md');
  assert.equal(exec('snapshot', '--output', outFile).status, 0);
  const pinned = parseRepoConfig(readFileSync(outFile, 'utf8'));
  assert.equal(pinned.commit.format, SER_TITLE_RULE);
  assert.equal(pinned.commit.pattern, '^[a-z]+(?:\\([A-Za-z0-9_./-]+\\))?: SER-\\d+ \\S.*$');
});

test('snapshot pins the base branch cloud workspaces are cut from', (t) => {
  const outFile = (dir) => join(dir, '.context/planning/repo-config.md');
  const snapshot = (r, env) => {
    const res = spawnSync(process.execPath, [cli, 'snapshot', '--output', outFile(r.dir)], {
      cwd: r.dir, encoding: 'utf8', env: { ...process.env, CONDUCTOR_DEFAULT_BRANCH: '', ...env },
    });
    assert.equal(res.status, 0, res.stderr);
    return { base: JSON.parse(res.stdout).base, pinned: parseRepoConfig(readFileSync(outFile(r.dir), 'utf8')).integrationBranch };
  };

  const plain = repo(t, {});
  plain.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  plain.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  assert.deepEqual(snapshot(plain), { base: 'main', pinned: 'main' });
  assert.deepEqual(snapshot(plain, { CONDUCTOR_DEFAULT_BRANCH: 'development' }), { base: 'development', pinned: 'development' });

  const explicit = repo(t, { integrationBranch: 'origin/release' });
  assert.deepEqual(snapshot(explicit, { CONDUCTOR_DEFAULT_BRANCH: 'development' }), { base: 'release', pinned: 'origin/release' });

  const bare = repo(t, {});
  assert.deepEqual(snapshot(bare), { base: null, pinned: '' });
});
