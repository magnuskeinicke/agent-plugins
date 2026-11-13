// End-to-end walk of the CLI state machine against a temp dir — the loop a
// skill drives, without any real agents: plan → collect → decide → apply-fix →
// plan → … → adjudicate. Spawns the real CLI binary so argument parsing and
// state persistence are covered too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

function makeRun() {
  const dir = mkdtempSync(join(tmpdir(), 'engine-cli-'));
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [CLI, ...args, '--slice', 'PROJ-1', '--dir', join(dir, '.context')], {
        encoding: 'utf8',
        cwd: dir,
      }),
    );
  return { dir, run };
}

const findingsFile = (report) => JSON.stringify(report, null, 2);

test('full loop: findings → fix → clean re-review → converged', () => {
  const { run } = makeRun();
  const contract = join(mkdtempSync(join(tmpdir(), 'contract-')), 'contract.md');
  writeFileSync(contract, 'Ticket PROJ-1: add the widget. AC: widget renders.');

  const init = run('init', '--no-adversarial', '--base', 'origin/main', '--contract-file', contract);
  assert.equal(init.resumed, false);

  const plan = run('plan', '--changed-files', 'components/Widget.tsx,server/widget.ts', '--added-files', 'components/Widget.tsx', '--user-facing', 'true', '--head', 'aaa111');
  assert.equal(plan.round, 1);
  assert.ok(plan.prePass, 'round 1 has the gut-check pre-pass');
  const rIds = plan.reviewers.map((r) => r.id);
  assert.ok(rIds.includes('code-reviewer') && rIds.includes('a11y-auditor') && rIds.includes('security-reviewer'));
  const cr = plan.reviewers.find((r) => r.id === 'code-reviewer');
  assert.ok(existsSync(cr.promptFile));
  assert.match(readFileSync(cr.promptFile, 'utf8'), /widget renders/, 'contract embedded in prompt');
  assert.match(readFileSync(cr.promptFile, 'utf8'), /READ-ONLY/);
  const copy = plan.reviewers.find((r) => r.id === 'copy-reviewer');
  assert.ok(copy, 'user-facing frontend changes trigger copy review');
  const copyPrompt = readFileSync(copy.promptFile, 'utf8');
  assert.match(copyPrompt, /# Copy Review Rubric/);
  assert.match(copyPrompt, /## Redundancy Categories/);
  assert.match(copyPrompt, /confidence 75 or higher/);
  assert.match(copyPrompt, /Critical and Important findings into blockingFindings/);
  assert.match(copyPrompt, /Suggestion findings into notes/);

  for (const task of plan.reviewers)
    writeFileSync(task.outputFile, findingsFile({ reviewer: task.id, persona: `magnus:${task.id}`, blockingFindings: [], notes: [] }));
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'read all 2 files vs origin/main' }));
  writeFileSync(cr.outputFile, findingsFile({ reviewer: 'code-reviewer', persona: 'magnus:code-reviewer', blockingFindings: [{ title: 'Missing null check', detail: 'boom on empty', file: 'components/Widget.tsx', rootCause: 'null-widget' }], notes: [] }));
  const reuse = plan.reviewers.find((r) => r.id === 'codebase-pattern-reviewer');
  writeFileSync(reuse.outputFile, findingsFile({ reviewer: 'codebase-pattern-reviewer', persona: 'magnus:codebase-pattern-reviewer', blockingFindings: [], notes: [] }));

  const collect = run('collect');
  assert.equal(collect.findingCount, 1);
  assert.ok(collect.validator, 'validator step emitted');
  writeFileSync(collect.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R1-01', diffCaused: true, confidence: 92 }] }));

  const decide = run('decide', '--verdicts', collect.validator.outputFile, '--tests-green', 'true', '--committed', 'true');
  assert.equal(decide.action, 'fix');
  assert.deepEqual(decide.targets.map((t) => t.id), ['CR-001']);
  assert.match(readFileSync(decide.fix.promptFile, 'utf8'), /CR-001/);

  writeFileSync(decide.fix.outputFile, JSON.stringify({ summary: 'null check added', committed: true, head: 'bbb222', testsGreen: true, testEvidence: 'vitest ok' }));
  const applied = run('apply-fix', '--result', decide.fix.outputFile);
  assert.equal(applied.action, 'review');
  assert.equal(applied.round, 2);

  const plan2 = run('plan', '--changed-files', 'components/Widget.tsx', '--added-files', 'components/Widget.tsx');
  assert.equal(plan2.prePass, null, 'gut-check is round 1 only');
  const ids2 = plan2.reviewers.map((r) => r.id);
  assert.ok(ids2.includes('code-reviewer'), 'always-on re-runs');
  assert.ok(!ids2.includes('codebase-pattern-reviewer'), 'clean reuse pass with unchanged fingerprint skips');
  const cr2 = plan2.reviewers.find((r) => r.id === 'code-reviewer');
  assert.match(readFileSync(cr2.promptFile, 'utf8'), /aaa111\.\.bbb222/, 'fix round reviews the fix range');
  assert.match(readFileSync(cr2.promptFile, 'utf8'), /CR-001 \[addressed\]/, 'ledger history injected');

  for (const r of plan2.reviewers)
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  const collect2 = run('collect');
  assert.equal(collect2.findingCount, 0);
  const decide2 = run('decide');
  assert.equal(decide2.action, 'converged');
  assert.equal(decide2.verdict, 'converged');

  const status = run('status');
  assert.equal(status.phase, 'done');
});

test('gut-check block hard-stops before any validator spend', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(
    plan.prePass.outputFile,
    findingsFile({ observations: [{ title: 'Unasked admin page', detail: 'not in the ticket', disposition: 'block' }], scopeNote: 'all files read' }),
  );
  const collect = run('collect');
  assert.equal(collect.action, 'hard-stop');
  assert.equal(run('status').phase, 'done');
});

test('red gate at init: plan emits a gate fix and NO reviewer prompts', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main', '--tests-green', 'false');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  assert.equal(plan.action, 'gate-fix');
  assert.deepEqual(plan.gateFindings, ['Tests/lint not green']);
  assert.equal(plan.reviewers, undefined, 'no reviewer sees red code');
  writeFileSync(plan.fix.outputFile, JSON.stringify({ summary: 'tests fixed', committed: true, head: 'h1', testsGreen: true, testEvidence: 'ok' }));
  const applied = run('apply-fix', '--result', plan.fix.outputFile);
  assert.equal(applied.round, 2);
  const plan2 = run('plan', '--changed-files', 'src/a.ts');
  assert.ok(plan2.reviewers.length > 0, 'green gates resume the reviewer round');
});

test('red tests gate spends the round on a gate fix, not reviewer findings', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  for (const r of plan.reviewers)
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  run('collect');
  const decide = run('decide', '--tests-green', 'false');
  assert.equal(decide.action, 'fix');
  assert.deepEqual(decide.gateFindings, ['Tests/lint not green']);
  assert.match(readFileSync(decide.fix.promptFile, 'utf8'), /testsGreen/);
});

test('invalid findings files are excluded and reported, never silently eaten', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  const cr = plan.reviewers.find((r) => r.id === 'code-reviewer');
  writeFileSync(cr.outputFile, '{"not": "a report"}');
  for (const r of plan.reviewers.filter((r) => r.id !== 'code-reviewer'))
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  const collect = run('collect');
  assert.equal(collect.invalid.length, 1);
  assert.match(collect.invalid[0].errors.join(' '), /missing required/);
});

test('disputes route through the adjudicator; upheld ships in a stalled verdict', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main');
  let plan = run('plan', '--changed-files', 'src/a.ts', '--head', 'h1');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  const cr = plan.reviewers.find((r) => r.id === 'code-reviewer');
  writeFileSync(cr.outputFile, findingsFile({ reviewer: 'code-reviewer', persona: 'magnus:code-reviewer', blockingFindings: [{ title: 'Race in cache', detail: 'two writers', rootCause: 'cache-race' }], notes: [] }));
  for (const r of plan.reviewers.filter((r) => r.id !== 'code-reviewer'))
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  const collect = run('collect');
  writeFileSync(collect.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R1-01', diffCaused: true, confidence: 95 }] }));
  const decide = run('decide', '--verdicts', collect.validator.outputFile);
  writeFileSync(decide.fix.outputFile, JSON.stringify({ summary: 'disputed instead', committed: true, head: 'h2', testsGreen: true, testEvidence: 'ok', disputed: [{ id: 'CR-001', title: 'Race in cache', evidence: 'single-writer by design, see src/a.ts:10' }] }));
  run('apply-fix', '--result', decide.fix.outputFile);

  // clean round 2 → loop wants to end → adjudication of the dispute
  plan = run('plan', '--changed-files', 'src/a.ts');
  for (const r of plan.reviewers)
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  run('collect');
  const decide2 = run('decide');
  assert.equal(decide2.action, 'adjudicate');
  const adj = run('adjudicate');
  assert.equal(adj.disputed.length, 1);
  writeFileSync(adj.adjudicator.outputFile, JSON.stringify({ rulings: [{ id: 'CR-001', ruling: 'upheld', reason: 'second writer exists in worker.ts' }] }));
  const final = run('apply-adjudication', '--rulings', adj.adjudicator.outputFile);
  assert.deepEqual(final.upheld.map((e) => e.id), ['CR-001']);
  assert.match(final.verdict, /stalled — shipped with 1 open finding/);
});

test('init is idempotent and resumable', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main');
  const again = run('init', '--no-adversarial', '--base', 'origin/other');
  assert.equal(again.resumed, true);
  assert.equal(again.round, 1);
});

test('review-only: findings end the run as a report, no fix pass (magnus:review-code)', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  const cr = plan.reviewers.find((r) => r.id === 'code-reviewer');
  writeFileSync(cr.outputFile, findingsFile({ reviewer: 'code-reviewer', persona: 'magnus:code-reviewer', blockingFindings: [{ title: 'Off-by-one', detail: 'loop bound', file: 'src/a.ts', rootCause: 'loop-bound' }, { title: 'Old wart', detail: 'pre-existing', file: 'src/a.ts', rootCause: 'wart' }, { title: 'Ghost', detail: 'cannot see it', file: 'src/a.ts', rootCause: 'ghost' }], notes: [] }));
  for (const r of plan.reviewers.filter((r) => r.id !== 'code-reviewer'))
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  const collect = run('collect');
  writeFileSync(collect.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [
    { id: 'R1-01', diffCaused: true, confidence: 92 },
    { id: 'R1-02', diffCaused: false, confidence: 90 },
    { id: 'R1-03', diffCaused: true, confidence: 30 },
  ] }));
  const decide = run('decide', '--verdicts', collect.validator.outputFile);
  assert.equal(decide.action, 'report', 'review-only never emits a fix');
  assert.match(decide.verdict, /1 blocking finding\(s\) \(CR-001\)/);
  assert.equal(run('status').phase, 'done');
  const report = run('report');
  assert.deepEqual(report.blocking.map((e) => e.id), ['CR-001']);
  assert.equal(report.blocking[0].confidence, 92);
  assert.deepEqual(report.advisoryNotes.map((e) => e.id), ['CR-002'], 'confident-but-pre-existing is advisory');
  assert.deepEqual(report.unverified.map((e) => e.id), ['CR-003'], 'sub-60 confidence is dropped, still visible');
});

test('review-only with a clean round reports verdict "clean"', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main', '--review-only');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  for (const r of plan.reviewers)
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  run('collect');
  const decide = run('decide');
  assert.equal(decide.action, 'report');
  assert.equal(decide.verdict, 'clean');
});

test('max-rounds caps the loop below the hard cap', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main', '--max-rounds', '1');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  const cr = plan.reviewers.find((r) => r.id === 'code-reviewer');
  writeFileSync(cr.outputFile, findingsFile({ reviewer: 'code-reviewer', persona: 'magnus:code-reviewer', blockingFindings: [{ title: 'Bug', detail: 'boom', file: 'src/a.ts', rootCause: 'boom' }], notes: [] }));
  for (const r of plan.reviewers.filter((r) => r.id !== 'code-reviewer'))
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  const collect = run('collect');
  writeFileSync(collect.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R1-01', diffCaused: true, confidence: 95 }] }));
  const decide = run('decide', '--verdicts', collect.validator.outputFile);
  assert.equal(decide.action, 'stalled', 'round 1 is the cap — no fix pass emitted');
  assert.match(decide.verdict, /stalled — shipped with 1 open finding/);
});

test('inspect override drives every prompt; non-git commands get a --name-only manifest', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main', '--review-only', '--inspect', 'gh pr diff 42');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  const cr = plan.reviewers.find((r) => r.id === 'code-reviewer');
  assert.match(readFileSync(cr.promptFile, 'utf8'), /`gh pr diff 42`/);
  assert.ok(!readFileSync(cr.promptFile, 'utf8').includes('origin/main...HEAD'));
  const gut = readFileSync(plan.prePass.promptFile, 'utf8');
  assert.match(gut, /`gh pr diff 42 --name-only`/);
  assert.ok(!gut.includes('--numstat'), 'no numstat form for a non-git inspect command');
});

test('git inspect override derives name-status/numstat manifest forms', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'HEAD', '--review-only', '--inspect', 'git diff HEAD');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  const gut = readFileSync(plan.prePass.promptFile, 'utf8');
  assert.match(gut, /`git diff --name-status --find-renames HEAD`/);
  assert.match(gut, /`git diff --numstat --find-renames HEAD`/);
  assert.match(readFileSync(plan.reviewers[0].promptFile, 'utf8'), /`git diff HEAD`/);
});

test('collect names reviewers that never wrote their outputFile, and is re-runnable after the re-run', () => {
  const { run } = makeRun();
  run('init', '--no-adversarial', '--base', 'origin/main');
  const plan = run('plan', '--changed-files', 'src/a.ts');
  writeFileSync(plan.prePass.outputFile, findingsFile({ observations: [], scopeNote: 'ok' }));
  const [dead, ...rest] = plan.reviewers;
  for (const r of rest)
    writeFileSync(r.outputFile, findingsFile({ reviewer: r.id, persona: `magnus:${r.id}`, blockingFindings: [], notes: [] }));
  const collect = run('collect');
  assert.deepEqual(collect.missing, [dead.id]);
  assert.match(collect.missingReports, /re-run those reviewers once/);
  // the dead reviewer gets its one re-run, then collect runs again
  writeFileSync(dead.outputFile, findingsFile({ reviewer: dead.id, persona: `magnus:${dead.id}`, blockingFindings: [], notes: [] }));
  const collect2 = run('collect');
  assert.deepEqual(collect2.missing, []);
  assert.equal(run('decide').action, 'converged');
});

test('findings validation requires rootCause on blocking findings', async () => {
  const { validate, FINDINGS_SCHEMA } = await import('../lib/schemas.mjs');
  const report = (finding) => ({ reviewer: 'code-reviewer', persona: 'magnus:code-reviewer', blockingFindings: [finding], notes: [] });
  const missing = validate(report({ title: 'Reworded re-raise', detail: 'boom' }), FINDINGS_SCHEMA);
  assert.ok(missing.some((e) => e.includes('missing required "rootCause"')));
  const withSlug = validate(report({ title: 'Reworded re-raise', detail: 'boom', rootCause: 'null-widget' }), FINDINGS_SCHEMA);
  assert.deepEqual(withSlug, []);
});
