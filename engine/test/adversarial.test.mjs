// Gate 5 — the different-provider adversarial review — driven through the real
// CLI against a temp git repo. The runner itself is not executed: the test
// plays the orchestrator by writing the result/status files the emitted
// command would write, so every attestation rule is exercised offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

function makeRepo({ config } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-gate5-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, '.gitignore'), '.context/\n');
  writeFileSync(join(dir, 'app.js'), 'export const a = 1;\n');
  if (config) {
    mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'agents', 'repo-config.md'), `## Config\n\n\`\`\`json\n${JSON.stringify(config)}\n\`\`\`\n`);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: base');
  git('checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, 'app.js'), 'export const a = 2;\n');
  git('commit', '-qam', 'feat: widget');
  const run = (...args) =>
    JSON.parse(execFileSync(process.execPath, [CLI, ...args, '--slice', 'PROJ-1'], { cwd: dir, encoding: 'utf8' }));
  const fail = (...args) => {
    try {
      execFileSync(process.execPath, [CLI, ...args, '--slice', 'PROJ-1'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      return e.stderr;
    }
    throw new Error('expected the command to fail');
  };
  const commit = (content, msg) => {
    writeFileSync(join(dir, 'app.js'), content);
    git('commit', '-qam', msg);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, run, fail, commit };
}

const cleanRound = (run, planArgs = []) => {
  const plan = run('plan', '--changed-files', 'app.js', ...planArgs);
  for (const t of [plan.prePass, ...plan.reviewers].filter(Boolean)) {
    const body = t.id === 'gut-check'
      ? { observations: [], scopeNote: 'read app.js' }
      : { reviewer: t.id, persona: `magnus:${t.id}`, blockingFindings: [], notes: [] };
    writeFileSync(t.outputFile, JSON.stringify(body));
  }
  const collect = run('collect');
  assert.equal(collect.findingCount, 0);
  return run('decide');
};

function providerResult(gate5, git, findings = [], overrides = {}) {
  return {
    host_provider: gate5.host,
    review_provider: gate5.provider,
    requested_model: 'gpt-6.1-sol',
    requested_effort: 'high',
    reviewed_head: git('rev-parse', 'HEAD'),
    reviewed_tree: git('rev-parse', 'HEAD^{tree}'),
    execution_mode: 'local',
    summary: 'reviewed',
    findings,
    positive_observations: [],
    coverage: { files_examined: ['app.js'], limitations: [] },
    ...overrides,
  };
}

const writeRunner = (gate5, result, status = 0) => {
  writeFileSync(gate5.resultFile, JSON.stringify(result));
  writeFileSync(gate5.statusFile, `${status}\n`);
};

const important = {
  severity: 'important', action_class: 'gated_auto', location: 'app.js:1',
  summary: 'a is off by one', evidence: 'a must stay 1 per the contract', recommendation: 'restore 1',
};

test('Gate 5 runs after convergence, its finding is fixed, and it re-attests the final tree', () => {
  const { run, git, commit } = makeRepo();
  const contract = join(mkdtempSync(join(tmpdir(), 'contract-')), 'contract.md');
  writeFileSync(contract, 'PROJ-1: change a. AC: a renders.');
  const init = run('init', '--base', 'main', '--host', 'claude', '--contract-file', contract);
  assert.deepEqual(init.adversarial, { enabled: true, host: 'claude', provider: 'codex', maxCycles: 3 });

  const g1 = cleanRound(run);
  assert.equal(g1.action, 'adversarial-review', 'a converged reviewer pass owes Gate 5');
  assert.equal(g1.provider, 'codex');
  assert.match(g1.command, /run-adversarial-review\.sh' '--host-provider' 'claude' '--provider' 'codex' '--merge-base'/);
  assert.match(g1.command, /--consume-requirements-file/);
  const reqFile = /'--requirements-file' '([^']+)'/.exec(g1.command)[1];
  assert.equal(readFileSync(reqFile, 'utf8'), 'PROJ-1: change a. AC: a renders.');
  assert.equal(statSync(reqFile).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(reqFile)).mode & 0o777, 0o700);
  assert.equal(run('status').phase, 'adversarial');

  writeRunner(g1, providerResult(g1, git, [important, {
    severity: 'suggestion', action_class: 'advisory', location: 'app.js', summary: 'name it better', evidence: 'x', recommendation: 'rename',
  }]));
  const ingest = run('adversarial');
  assert.equal(ingest.action, 'collect');
  assert.deepEqual(ingest.reported, { blocking: 1, advisory: 1 });
  assert.ok(!existsSync(g1.resultFile), 'caller-side cleanup removes the temp files');

  const collect = run('collect');
  assert.equal(collect.findingCount, 1);
  writeFileSync(collect.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R2-01', diffCaused: true, confidence: 90 }] }));
  const fix = run('decide', '--verdicts', collect.validator.outputFile);
  assert.equal(fix.action, 'fix');
  assert.equal(fix.gate, 5);
  assert.equal(fix.adversarialCycle, '1/3');
  assert.equal(fix.targets[0].source, 'adversarial-review');

  const head = commit('export const a = 1; // restored\n', 'fix: restore a');
  writeFileSync(fix.fix.outputFile, JSON.stringify({ summary: 'restored', committed: true, head, testsGreen: true }));
  assert.equal(run('apply-fix', '--result', fix.fix.outputFile).action, 'review');

  const g2 = cleanRound(run);
  assert.equal(g2.action, 'adversarial-review', 'the fix changed the tree, so Gate 5 must attest it again');
  writeRunner(g2, providerResult(g2, git));
  run('adversarial');
  assert.equal(run('collect').findingCount, 0);
  const final = run('decide');
  assert.equal(final.action, 'converged');
  assert.equal(final.verdict, 'converged');

  const report = run('report');
  assert.equal(report.adversarial.attested.tree, git('rev-parse', 'HEAD^{tree}'));
  assert.deepEqual(report.adversarial.advisory, ['[suggestion] app.js: name it better — rename']);
  assert.match(report.independentReview,
    /^Independent review: codex gpt-6\.1-sol; tree [0-9a-f]{40}; change patch [0-9a-f]{40}; blocking findings 1 \(fixed 1\); disagreements decided by the adjudicator 0$/);
});

test('a result that does not attest the prepared tree blocks Gate 5 and never converges', () => {
  const { run, git, dir } = makeRepo();
  run('init', '--base', 'main', '--host', 'claude');
  const g = cleanRound(run);
  writeRunner(g, providerResult(g, git, [], { reviewed_head: 'f'.repeat(40) }));
  const blocked = run('adversarial');
  const blockedFile = join(dir, '.context', 'PROJ-1', 'round-2', 'adversarial-blocked.json');
  assert.ok(existsSync(blockedFile));
  assert.equal(blocked.action, 'blocked');
  assert.match(blocked.verdict, /^blocked — adversarial review \(Gate 5\): reviewed_head/);
  assert.equal(run('report').independentReview, null);

  const retry = run('adversarial', '--retry');
  assert.equal(retry.action, 'adversarial-review');
  writeRunner(retry, providerResult(retry, git, [], { review_provider: 'claude' }));
  assert.match(run('adversarial').verdict, /review_provider "claude" != "codex"/);

  const passing = run('adversarial', '--retry');
  writeRunner(passing, providerResult(passing, git, []));
  assert.equal(run('adversarial').action, 'collect');
  assert.ok(existsSync(join(dir, '.context', 'PROJ-1', 'round-2', 'adversarial-result.json')));
  assert.ok(!existsSync(blockedFile), 'a passing retry clears the stale blocked outcome');
});

test('a failed runner (non-zero status) blocks Gate 5 with its error', () => {
  const { run, dir } = makeRepo();
  run('init', '--base', 'main', '--host', 'codex');
  const g = cleanRound(run);
  assert.equal(g.provider, 'claude', 'a Codex host is reviewed by Claude');
  assert.match(g.command, /2> '[^']+runner\.stderr'/, 'the runner\'s stderr is kept');
  writeFileSync(g.resultFile, '');
  writeFileSync(/2> '([^']+)'/.exec(g.command)[1], 'run-adversarial-review.sh: Claude CLI is unavailable\n');
  writeFileSync(g.statusFile, '1\n');
  assert.match(run('adversarial').verdict, /runner exited 1: run-adversarial-review\.sh: Claude CLI is unavailable/);
  const blockedFile = join(dir, '.context', 'PROJ-1', 'round-2', 'adversarial-blocked.json');
  assert.match(JSON.parse(readFileSync(blockedFile, 'utf8')).errors[0], /Claude CLI is unavailable/, 'the blocked outcome is kept on disk');
  const runs = run('report').adversarial.runs;
  assert.deepEqual(runs.map(({ afterRound, round, ok }) => ({ afterRound, round, ok })), [{ afterRound: 1, round: undefined, ok: false }]);
});

test('a demoted critical/important provider finding becomes a disagreement for the adjudicator', () => {
  const { run, git } = makeRepo();
  run('init', '--base', 'main', '--host', 'claude');
  const g = cleanRound(run);
  writeRunner(g, providerResult(g, git, [important]));
  run('adversarial');
  const collect = run('collect');
  writeFileSync(collect.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R2-01', diffCaused: true, confidence: 65, note: 'the contract allows 2' }] }));
  const decide = run('decide', '--verdicts', collect.validator.outputFile);
  assert.equal(decide.action, 'adjudicate');
  assert.deepEqual(decide.adversarialDisagreements, ['CR-001']);
  const adj = run('adjudicate');
  const prompt = readFileSync(adj.adjudicator.promptFile, 'utf8');
  assert.match(prompt, /Counter-evidence \(the host validator disagreed with the other provider\): host validator demoted it at confidence 65: the contract allows 2/);
  writeFileSync(adj.adjudicator.outputFile, JSON.stringify({ rulings: [{ id: 'CR-001', ruling: 'dismissed', reason: 'contract allows 2' }] }));
  const ruled = run('apply-adjudication', '--rulings', adj.adjudicator.outputFile);
  assert.equal(ruled.verdict, 'converged', 'Gate 5 already attested this tree');
  assert.match(run('report').independentReview, /blocking findings 1 \(fixed 0\); disagreements decided by the adjudicator 1$/);

  // A pre-existing finding may be rejected without a disagreement.
  const other = makeRepo();
  other.run('init', '--base', 'main', '--host', 'claude');
  const g2 = cleanRound(other.run);
  writeRunner(g2, providerResult(g2, other.git, [important]));
  other.run('adversarial');
  const c2 = other.run('collect');
  writeFileSync(c2.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R2-01', diffCaused: false, confidence: 95 }] }));
  assert.equal(other.run('decide', '--verdicts', c2.validator.outputFile).action, 'converged');
});

test('the adversarial fix-cycle cap stalls the loop', () => {
  const { run, git, commit } = makeRepo({ config: { adversarial: { maxCycles: 1 } } });
  run('init', '--base', 'main', '--host', 'claude');
  let g = cleanRound(run);
  writeRunner(g, providerResult(g, git, [important]));
  run('adversarial');
  let c = run('collect');
  writeFileSync(c.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R2-01', diffCaused: true, confidence: 90 }] }));
  const fix = run('decide', '--verdicts', c.validator.outputFile);
  assert.equal(fix.adversarialCycle, '1/1');
  const head = commit('export const a = 3;\n', 'fix: try again');
  writeFileSync(fix.fix.outputFile, JSON.stringify({ summary: 'x', committed: true, head, testsGreen: true }));
  run('apply-fix', '--result', fix.fix.outputFile);

  g = cleanRound(run);
  writeRunner(g, providerResult(g, git, [{ ...important, summary: 'still wrong' }]));
  run('adversarial');
  c = run('collect');
  writeFileSync(c.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: 'R4-01', diffCaused: true, confidence: 90 }] }));
  const stalled = run('decide', '--verdicts', c.validator.outputFile);
  assert.equal(stalled.action, 'stalled');
  assert.match(stalled.verdict, /adversarial fix-cycle cap \(1\) reached$/);
});

test('review-only runs skip Gate 5 unless --adversarial; --inspect and config can disable it', () => {
  const plain = makeRepo();
  assert.equal(plain.run('init', '--base', 'main', '--review-only').adversarial.enabled, false);
  assert.equal(cleanRound(plain.run).action, 'report');

  const asked = makeRepo();
  asked.run('init', '--base', 'main', '--review-only', '--adversarial', '--host', 'claude');
  const g = cleanRound(asked.run);
  assert.equal(g.action, 'adversarial-review', 'validation-only still runs the requested Gate 5');
  writeRunner(g, providerResult(g, asked.git));
  asked.run('adversarial');
  asked.run('collect');
  assert.equal(asked.run('decide').verdict, 'clean');

  const inspect = makeRepo();
  const init = inspect.run('init', '--base', 'main', '--adversarial', '--host', 'claude', '--inspect', 'gh pr diff 7');
  assert.match(init.adversarial.reason, /--inspect run/);

  const off = makeRepo({ config: { adversarial: { enabled: false } } });
  assert.match(off.run('init', '--base', 'main').adversarial.reason, /adversarial\.enabled is false/);
  assert.equal(cleanRound(off.run).action, 'converged');
  assert.equal(off.run('report').independentReview, 'Independent review: not requested');

  const needsHost = makeRepo();
  assert.match(needsHost.fail('init', '--base', 'main'), /pass --host claude\|codex/);
});

test('Gate 5 refuses a dirty worktree', () => {
  const { run, dir } = makeRepo();
  run('init', '--base', 'main', '--host', 'claude');
  writeFileSync(join(dir, 'stray.txt'), 'x');
  const g = cleanRound(run);
  assert.equal(g.action, 'blocked');
  assert.match(g.verdict, /clean committed worktree/);
});

// Regressions from the first real Gate 5 run (Codex reviewing this engine).
function gate5WithFinding(run, git, finding = important, verdict = { diffCaused: true, confidence: 90 }) {
  const g = cleanRound(run);
  assert.equal(g.action, 'adversarial-review');
  writeRunner(g, providerResult(g, git, [finding]));
  const ingest = run('adversarial');
  const c = run('collect');
  assert.equal(c.findingCount, 1, 'a Gate 5 re-raise is never suppressed into deferral');
  writeFileSync(c.validator.outputFile, JSON.stringify({ persona: 'magnus:pr-relevance-validator', verdicts: [{ id: `R${ingest.round}-01`, ...verdict }] }));
  return run('decide', '--verdicts', c.validator.outputFile);
}

function fixWith(run, commit, fix, content) {
  const head = commit(content, 'fix: try');
  writeFileSync(fix.fix.outputFile, JSON.stringify({ summary: 'x', committed: true, head, testsGreen: true }));
  run('apply-fix', '--result', fix.fix.outputFile);
}

test('the same Gate 5 blocker surviving its fix attempts stalls instead of deferring into convergence', () => {
  const { run, git, commit } = makeRepo();
  run('init', '--base', 'main', '--host', 'claude');
  fixWith(run, commit, gate5WithFinding(run, git), 'export const a = 3;\n');
  fixWith(run, commit, gate5WithFinding(run, git), 'export const a = 4;\n');
  const third = gate5WithFinding(run, git);
  assert.equal(third.action, 'stalled');
  assert.match(third.verdict, /^stalled — shipped with 1 open finding\(s\) \(CR-001\) — Gate 5 finding\(s\) CR-001 persisted through 2 fix attempts$/);
});

test('a fixed Gate 5 finding re-raised and then rejected by the validator goes to the adjudicator', () => {
  const { run, git, commit } = makeRepo();
  run('init', '--base', 'main', '--host', 'claude');
  fixWith(run, commit, gate5WithFinding(run, git), 'export const a = 3;\n');
  const second = gate5WithFinding(run, git, important, { diffCaused: true, confidence: 40 });
  assert.equal(second.action, 'adjudicate');
  assert.deepEqual(second.adversarialDisagreements, ['CR-001']);
});

test('review-only with --adversarial never reports clean over an undecided Gate 5 disagreement', () => {
  const { run, git } = makeRepo();
  run('init', '--base', 'main', '--review-only', '--adversarial', '--host', 'claude');
  const decided = gate5WithFinding(run, git, important, { diffCaused: true, confidence: 65 });
  assert.equal(decided.action, 'report');
  assert.equal(decided.verdict, '1 Gate 5 disagreement(s) for you to decide (CR-001)');
});

test('no Independent Review Record while a re-review after a fix is owed or blocked', () => {
  const { run, git, commit } = makeRepo();
  run('init', '--base', 'main', '--host', 'claude');
  fixWith(run, commit, gate5WithFinding(run, git), 'export const a = 3;\n');
  const g = cleanRound(run);
  assert.equal(g.action, 'adversarial-review');
  assert.equal(run('report').independentReview, null, 'pending');
  writeFileSync(g.resultFile, 'timeout');
  writeFileSync(g.statusFile, '124\n');
  assert.equal(run('adversarial').action, 'blocked');
  assert.equal(run('report').independentReview, null, 'blocked — the first attestation is of an older tree');
});
