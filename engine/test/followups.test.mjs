import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFollowups, selectFollowups, followupFingerprint } from '../lib/followups.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

const all = { siteExists: () => true, inDiff: () => false };

test('a re-raised consolidation stays one candidate and unions its call sites', () => {
  const c = [];
  mergeFollowups(c, [{ title: 'Share date formatting', detail: 'd', targetLib: 'libs/date', rootCause: 'dup-date-format', existingCallSites: ['a.ts:1'] }], 1);
  mergeFollowups(c, [{ title: 'Extract the date formatter', detail: 'd', targetLib: 'libs/date', rootCause: 'dup-date-format', existingCallSites: ['b.ts:2'] }], 2);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, 'Share date formatting');
  assert.deepEqual(c[0].existingCallSites, ['a.ts:1', 'b.ts:2']);
  assert.equal(c[0].round, 1);
});

test('fingerprint ignores case and punctuation in the slug', () => {
  assert.equal(
    followupFingerprint({ targetLib: 'libs/date', rootCause: 'Dup Date Format' }),
    followupFingerprint({ targetLib: 'libs/date', rootCause: 'dup-date-format' }),
  );
});

test('fewer than two verified call sites outside the diff → demoted, never filed', () => {
  const c = mergeFollowups([], [
    { title: 'speculative', detail: 'd', rootCause: 'maybe-later' },
    { title: 'one site', detail: 'd', rootCause: 'one', existingCallSites: ['a.ts:1'] },
    { title: 'in diff', detail: 'd', rootCause: 'diff', existingCallSites: ['new.ts:1', 'a.ts:1'] },
    { title: 'missing file', detail: 'd', rootCause: 'gone', existingCallSites: ['gone.ts:1', 'a.ts:1'] },
    { title: 'duplicate site', detail: 'd', rootCause: 'same', existingCallSites: ['a.ts:1', './a.ts:1'] },
  ], 1);
  const sel = selectFollowups(c, {
    siteExists: (p) => p !== 'gone.ts',
    inDiff: (p) => p === 'new.ts',
  });
  assert.deepEqual(sel.file, []);
  assert.deepEqual(sel.batch, []);
  assert.equal(sel.demoted.length, 5);
});

test('at most one own ticket; the rest go to the rolling ticket, strongest evidence first', () => {
  const c = mergeFollowups([], [
    { title: 'two sites', detail: 'd', rootCause: 'two', existingCallSites: ['a.ts:1', 'b.ts:1'] },
    { title: 'three sites', detail: 'd', rootCause: 'three', existingCallSites: ['a.ts:1', 'b.ts:1', 'c.ts:1'] },
    { title: 'also two', detail: 'd', rootCause: 'also', existingCallSites: ['a.ts:2', 'b.ts:2'] },
  ], 1);
  const sel = selectFollowups(c, all);
  assert.equal(sel.cap, 1);
  assert.deepEqual(sel.file.map((f) => f.title), ['three sites']);
  assert.deepEqual(sel.batch.map((f) => f.title), ['two sites', 'also two']);
  assert.match(sel.file[0].marker, /^magnus:followup:[0-9a-f]{12}$/);
});

test('cli: only the reuse audit feeds follow-ups, and call sites are checked against the work tree and diff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-followups-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'one\ntwo\n');
  writeFileSync(join(dir, 'src/b.ts'), 'one\ntwo\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'src/new.ts'), 'copy\n');
  git('add', '.');
  git('commit', '-qm', 'feat: new');

  const run = (...args) =>
    JSON.parse(execFileSync(process.execPath, [CLI, ...args, '--slice', 'PROJ-1', '--dir', join(dir, '.context')], { encoding: 'utf8', cwd: dir }));
  run('init', '--no-adversarial', '--base', 'main');
  const plan = run('plan', '--changed-files', 'src/new.ts', '--added-files', 'src/new.ts');
  for (const task of plan.reviewers)
    writeFileSync(task.outputFile, JSON.stringify({ reviewer: task.id, blockingFindings: [], notes: [] }));
  writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'ok' }));
  const reuse = plan.reviewers.find((r) => r.id === 'codebase-pattern-reviewer');
  writeFileSync(reuse.outputFile, JSON.stringify({ reviewer: reuse.id, blockingFindings: [], notes: [], consolidations: [
    { title: 'Share the copy', detail: 'd', targetLib: 'src', rootCause: 'dup-copy', existingCallSites: ['src/a.ts:2', 'src/b.ts:1'] },
    { title: 'Counts the diff', detail: 'd', targetLib: 'src', rootCause: 'diff-site', existingCallSites: ['src/new.ts:1', 'src/a.ts:1'] },
    { title: 'Past EOF', detail: 'd', targetLib: 'src', rootCause: 'eof', existingCallSites: ['src/a.ts:99', 'src/b.ts:1'] },
  ] }));
  const other = plan.reviewers.find((r) => r.id === 'code-reviewer');
  writeFileSync(other.outputFile, JSON.stringify({ reviewer: other.id, blockingFindings: [], notes: [], consolidations: [
    { title: 'Not my lane', detail: 'd', rootCause: 'stray', existingCallSites: ['src/a.ts:1', 'src/b.ts:1'] },
  ] }));
  run('collect');

  const sel = run('followups');
  assert.deepEqual(sel.file.map((f) => f.title), ['Share the copy']);
  assert.deepEqual(sel.batch, []);
  assert.deepEqual(sel.demoted.map((d) => d.title).sort(), ['Counts the diff', 'Past EOF']);
});

test('cli: no diff file list → every candidate demoted (fails closed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-followups-nogit-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'one\n');
  writeFileSync(join(dir, 'src/b.ts'), 'one\n');
  const run = (...args) =>
    JSON.parse(execFileSync(process.execPath, [CLI, ...args, '--slice', 'PROJ-2', '--dir', join(dir, '.context')], { encoding: 'utf8', cwd: dir }));
  run('init', '--no-adversarial', '--base', 'main');
  const plan = run('plan', '--changed-files', 'src/new.ts', '--added-files', 'src/new.ts');
  for (const task of plan.reviewers)
    writeFileSync(task.outputFile, JSON.stringify({ reviewer: task.id, blockingFindings: [], notes: [] }));
  writeFileSync(plan.prePass.outputFile, JSON.stringify({ observations: [], scopeNote: 'ok' }));
  const reuse = plan.reviewers.find((r) => r.id === 'codebase-pattern-reviewer');
  writeFileSync(reuse.outputFile, JSON.stringify({ reviewer: reuse.id, blockingFindings: [], notes: [], consolidations: [
    { title: 'Share the copy', detail: 'd', rootCause: 'dup-copy', existingCallSites: ['src/a.ts:1', 'src/b.ts:1'] },
  ] }));
  run('collect');

  const sel = run('followups');
  assert.deepEqual(sel.file, []);
  assert.equal(sel.demoted.length, 1);
  assert.match(sel.warning, /failed/);
});
