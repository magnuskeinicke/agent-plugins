import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepoConfig, resolveRepoConfig } from '../lib/config.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-compat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => JSON.parse(execFileSync(process.execPath,
    [cli, ...args, '--slice', 'ISSUE-1', '--dir', join(dir, '.context')],
    { cwd: dir, encoding: 'utf8' }));
  return { dir, run };
}

for (const mode of ['review-only', 'loop']) {
  test(`${mode}: absent reviewers cannot produce a successful verdict after resume`, (t) => {
    const { run } = fixture(t);
    run('init', '--no-adversarial', '--base', 'HEAD', ...(mode === 'review-only' ? ['--review-only'] : []));
    const plan = run('plan', '--changed-files', 'src/a.ts');
    const collected = run('collect');
    assert.equal(collected.missing.length, plan.reviewers.length + 1);
    assert.equal(run('decide').action, 'incomplete');
    assert.equal(run('status').phase, 'collect');
    assert.match(run('report').verdict, /incomplete/);
    assert.equal(run('report').coverage.missing.length, plan.reviewers.length + 1);
    assert.equal(run('status').tasks.length, plan.reviewers.length + 1);
    for (const task of plan.reviewers) {
      writeFileSync(task.outputFile, JSON.stringify({ reviewer: task.id, persona: `magnus:${task.id}`, blockingFindings: [], notes: [] }));
    }
    writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'all files' }));
    run('collect');
    assert.equal(run('decide').verdict, mode === 'review-only' ? 'clean' : 'converged');
  });
}

test('a report with another reviewer identity cannot satisfy coverage', (t) => {
  const { run } = fixture(t);
  run('init', '--no-adversarial', '--base', 'HEAD', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'all files' }));
  for (const task of plan.reviewers) {
    writeFileSync(task.outputFile, JSON.stringify({ reviewer: 'wrong-agent', blockingFindings: [], notes: [] }));
  }
  assert.equal(run('collect').invalid.length, plan.reviewers.length);
  assert.equal(run('decide').action, 'incomplete');
});

test('every agent task names its namespaced subagent; the gut-check has none', (t) => {
  const { run } = fixture(t);
  run('init', '--no-adversarial', '--base', 'HEAD');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  assert.equal(plan.prePass.subagentType, undefined);
  for (const task of plan.reviewers) {
    assert.equal(task.subagentType, `magnus:${task.id}`);
    assert.deepEqual([task.execution.claude.model, task.execution.claude.effort], ['opus', 'medium']);
    assert.equal(task.execution.codex.effort, 'high');
    assert.equal(JSON.parse(readFileSync(task.taskFile, 'utf8')).subagentType, `magnus:${task.id}`);
  }
  assert.match(plan.next, /subagentType/);
});

test('a report without the persona proof came from another agent and cannot satisfy coverage', (t) => {
  const { run } = fixture(t);
  run('init', '--no-adversarial', '--base', 'HEAD', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'all files' }));
  const [foreign, ...rest] = plan.reviewers;
  writeFileSync(foreign.outputFile, JSON.stringify({ reviewer: foreign.id, blockingFindings: [], notes: [] }));
  for (const task of rest)
    writeFileSync(task.outputFile, JSON.stringify({ reviewer: task.id, persona: `magnus:${task.id}`, blockingFindings: [], notes: [] }));
  const collected = run('collect');
  assert.equal(collected.action, 'incomplete');
  assert.equal(collected.invalid.length, 1);
  assert.match(collected.invalid[0].errors.join(' '), new RegExp(`subagent_type "magnus:${foreign.id}"`));
  writeFileSync(foreign.outputFile, JSON.stringify({ reviewer: foreign.id, persona: `magnus:${foreign.id}`, blockingFindings: [], notes: [] }));
  run('collect');
  assert.equal(run('decide').verdict, 'clean');
});

test('verdicts without the validator persona proof are refused and the round stays decidable', (t) => {
  const { run } = fixture(t);
  run('init', '--no-adversarial', '--base', 'HEAD', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'all files' }));
  for (const task of plan.reviewers)
    writeFileSync(task.outputFile, JSON.stringify({ reviewer: task.id, persona: `magnus:${task.id}`, notes: [],
      blockingFindings: task.id === 'code-reviewer' ? [{ title: 'Bug', detail: 'boom', file: 'src/a.ts', rootCause: 'boom' }] : [] }));
  const collected = run('collect');
  assert.equal(collected.validator.subagentType, 'magnus:pr-relevance-validator');
  const verdicts = [{ id: 'R1-01', diffCaused: true, confidence: 95 }];
  writeFileSync(collected.validator.outputFile, JSON.stringify({ verdicts }));
  assert.throws(() => run('decide', '--verdicts', collected.validator.outputFile), /subagent_type "magnus:pr-relevance-validator"/);
  assert.equal(run('status').phase, 'decide');
  writeFileSync(collected.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts }));
  assert.notEqual(run('decide', '--verdicts', collected.validator.outputFile).action, 'incomplete');
});

test('existing malformed configuration fails instead of changing routing to defaults', (t) => {
  const { dir } = fixture(t);
  const file = join(dir, 'repo-config.md');
  writeFileSync(file, '## Config\n```json\n{"routing":{"dispatch":"local"},}\n```\n');
  assert.throws(() => loadRepoConfig(file), /Invalid.*config/i);
  writeFileSync(file, '## Config\n```json\n[]\n```\n');
  assert.throws(() => loadRepoConfig(file), /object/);
  writeFileSync(file, '## Config\nnot a JSON block\n');
  assert.throws(() => loadRepoConfig(file), /Config.*JSON|JSON.*Config/);
});

test('invalid known configuration shapes fail while an absent file stays optional', () => {
  assert.throws(() => resolveRepoConfig({ routing: { dispatch: 'cluod' } }), /dispatch/);
  assert.throws(() => resolveRepoConfig({ gates: [] }), /gates/);
  assert.deepEqual(loadRepoConfig('/nonexistent/workflow-configuration.md'), {});
});


test('legacy Claude ledger resumes unfinished reviewers with Codex task manifests', (t) => {
  const { dir, run } = fixture(t);
  run('init', '--no-adversarial', '--base', 'HEAD', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'all files' }));
  for (const task of plan.reviewers.slice(1)) {
    writeFileSync(task.outputFile, JSON.stringify({ reviewer: task.id, persona: `magnus:${task.id}`, blockingFindings: [], notes: [] }));
  }
  const path = join(dir, '.context', 'ISSUE-1', 'ledger.json');
  const old = JSON.parse(readFileSync(path));
  delete old.config;
  delete old.tasks;
  delete old.coverage;
  for (const task of [plan.prePass, ...plan.reviewers]) rmSync(task.taskFile);
  writeFileSync(path, JSON.stringify(old));
  const resumed = run('status');
  assert.equal(resumed.round, 1);
  assert.equal(resumed.tasks.length, 1);
  assert.equal(resumed.tasks[0].id, plan.reviewers[0].id);
  assert.equal(resumed.tasks[0].execution.claude.model, 'opus');
  assert.equal(run('run', '--task', resumed.tasks[0].taskFile, '--runtime', 'codex', '--dry-run').command, 'codex');
  writeFileSync(resumed.tasks[0].outputFile, JSON.stringify({ reviewer: resumed.tasks[0].id, persona: `magnus:${resumed.tasks[0].id}`, blockingFindings: [], notes: [] }));
  run('collect');
  assert.equal(run('decide').verdict, 'clean');
});

test('planning configuration survives a checkout that has no repo config', (t) => {
  const { dir, run } = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  mkdirSync(join(dir, 'docs/agents'), { recursive: true });
  const config = join(dir, 'docs/agents/repo-config.md');
  writeFileSync(config, '## Config\n```json\n' + JSON.stringify({ goldenPaths: { domain: 'lib/canonical.ts' }, routing: { models: { reviewer: { codex: { model: 'custom-reviewer' } } } } }) + '\n```\n');
  git('add', 'docs/agents/repo-config.md');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'planning');
  const ref = git('rev-parse', 'HEAD');
  git('checkout', '--detach', base);
  const output = join(dir, '.context/planning.md');
  run('snapshot', '--ref', ref, '--output', output);
  run('init', '--no-adversarial', '--base', 'HEAD', '--config', output);
  const plan = run('plan', '--changed-files', 'src/new.ts', '--added-files', 'src/new.ts');
  assert.equal(plan.reviewers[0].execution.codex.model, 'custom-reviewer');
  const audit = plan.reviewers.find((task) => task.id === 'codebase-pattern-reviewer');
  assert.match(readFileSync(audit.promptFile, 'utf8'), /lib\/canonical.ts/);
  assert.throws(() => run('model', '--role', 'reviewer', '--runtime', 'codex', '--config', join(dir, 'missing.md')), /Config snapshot not found/);
});

test('deleting a prompt cannot erase a planned reviewer from coverage', (t) => {
  const { run } = fixture(t);
  run('init', '--no-adversarial', '--base', 'HEAD', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  rmSync(plan.reviewers[0].promptFile);
  assert.ok(run('collect').missing.includes(plan.reviewers[0].id));
  assert.equal(run('decide').action, 'incomplete');
});
