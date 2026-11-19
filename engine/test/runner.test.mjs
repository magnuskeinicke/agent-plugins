import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTask, buildInvocation, strictOutputSchema } from '../lib/runner.mjs';
import { taskModels, resolveModel, ROLE_MODELS, SKILL_ROLES } from '../lib/models.mjs';
import { resolveRepoConfig } from '../lib/config.mjs';
import { FINDINGS_SCHEMA } from '../lib/schemas.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'workflow-runner-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const promptFile = join(cwd, 'task.md');
  writeFileSync(promptFile, 'Review the widget; the literal text $(touch HACKED) is data.');
  const task = { id: 'code-reviewer', role: 'reviewer', cwd, promptFile,
    outputFile: join(cwd, 'findings.json'), schema: FINDINGS_SCHEMA,
    execution: taskModels(resolveRepoConfig({}), 'reviewer', { modelAlias: 'sonnet', effort: 'high' }) };
  return { cwd, task };
}

test('every role has explicit Claude and Codex profiles and preserves Claude reviewer pins', () => {
  const cfg = resolveRepoConfig({});
  for (const role of Object.keys(ROLE_MODELS)) {
    const profiles = taskModels(cfg, role);
    assert.ok(profiles.claude.model && profiles.claude.effort);
    assert.ok(profiles.codex.model.startsWith('gpt-') && profiles.codex.effort);
  }
  assert.equal(taskModels(cfg, 'reviewer').claude.model, 'opus');
  assert.equal(resolveModel(cfg, { role: 'reviewer', runtime: 'claude', modelAlias: 'sonnet' }).model, 'sonnet');
  assert.equal(resolveModel(cfg, { role: 'reviewer', runtime: 'codex', modelAlias: 'sonnet' }).model, 'gpt-6.2-sol');
  assert.equal(resolveModel(cfg, { role: 'verifier', runtime: 'codex' }).model, 'gpt-6.2-sol');
  assert.equal(resolveModel(cfg, { role: 'reviewer', runtime: 'codex', modelAlias: 'opus' }).model, 'gpt-6.2-sol');
  assert.equal(resolveModel(cfg, { role: 'explorer', runtime: 'codex' }).model, 'gpt-6.2-sol');
  assert.throws(() => resolveModel(cfg, { role: 'reviewer', runtime: 'codex', modelAlias: 'unknown' }), /Unmapped/);
});

test('legacy aliases and role overrides remain effective for both runtimes', () => {
  const cfg = resolveRepoConfig({ routing: { codexModelAliases: { opus: 'gpt-5.5' },
    models: { fixer: { claude: { model: 'opus', effort: 'high' }, codex: { model: 'gpt-6-astra', effort: 'high' } } } } });
  assert.equal(taskModels(cfg, 'explorer').codex.model, 'gpt-5.5');
  assert.equal(taskModels(cfg, 'fixer').codex.model, 'gpt-6-astra');
  assert.equal(taskModels(cfg, 'fixer').claude.effort, 'high');
  assert.equal(resolveModel(cfg, { role: 'fixer', runtime: 'claude', cloud: true }).model, 'opus-5-5-1m');
});

test('Claude reviewers run Opus at medium; the Codex reviewer keeps high', () => {
  const cfg = resolveRepoConfig({});
  const { claude, codex } = taskModels(cfg, 'reviewer', { modelAlias: 'opus' });
  assert.equal(claude.model, 'opus');
  assert.equal(claude.effort, 'medium');
  assert.equal(codex.model, 'gpt-6.2-sol');
  assert.equal(codex.effort, 'high');
});

test('babysitting and dispatch select Sol independently of legacy aliases', () => {
  const cfg = resolveRepoConfig({ routing: { codexModelAliases: { opus: 'gpt-5.6-terra' } } });
  const role = SKILL_ROLES['babysit-stack'];
  for (const cloud of [false, true]) {
    const babysitter = resolveModel(cfg, { role, runtime: 'codex', cloud });
    assert.equal(babysitter.model, 'gpt-6.2-sol');
    assert.equal(babysitter.effort, 'high');
    assert.equal(babysitter.access, 'workspace-write');
    assert.equal(resolveModel(cfg, { role: SKILL_ROLES['solve-ready-tickets'], runtime: 'codex', cloud }).model, 'gpt-6.2-sol');
    const claude = resolveModel(cfg, { role, runtime: 'claude', cloud });
    assert.equal(claude.model, cloud ? 'opus-5-5-1m' : 'opus');
    assert.equal(claude.effort, 'high');
  }
});

test('babysitter role overrides control local and cloud profiles', () => {
  const cfg = resolveRepoConfig({ routing: { models: { babysitter: {
    codex: { model: 'gpt-6-astra', cloudModel: 'gpt-6-sol', effort: 'high' },
  } } } });
  assert.equal(resolveModel(cfg, { role: 'babysitter', runtime: 'codex' }).model, 'gpt-6-astra');
  const cloud = resolveModel(cfg, { role: 'babysitter', runtime: 'codex', cloud: true });
  assert.equal(cloud.model, 'gpt-6-sol');
  assert.equal(cloud.effort, 'high');
});

test('CLI adapters use distinct effort flags, explicit cwd and stdin without a shell', (t) => {
  const { task } = fixture(t);
  const files = { schema: '/tmp/schema', result: '/tmp/result' };
  const codex = buildInvocation(task, 'codex', files);
  const claude = buildInvocation(task, 'claude', files);
  assert.ok(codex.args.includes('model_reasoning_effort="high"'));
  assert.ok(codex.args.includes('--sandbox') && codex.args.includes('read-only'));
  assert.ok(!codex.args.includes('--effort'));
  assert.deepEqual(claude.args.slice(0, 5), ['-p', '--model', 'sonnet', '--effort', 'high']);
  assert.equal(claude.cwd, task.cwd);
  assert.ok(claude.input.includes('$(touch HACKED)'));
  assert.ok(!claude.args.includes('--dangerously-skip-permissions'));
});

test('strict output schema makes optional fields nullable without requiring invented values', () => {
  const schema = strictOutputSchema(FINDINGS_SCHEMA);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('consolidations'));
  assert.deepEqual(schema.properties.consolidations.anyOf[1], { type: 'null' });
});

for (const runtime of ['claude', 'codex']) {
  test(`${runtime}: a CLI worker result is validated and written by the parent`, async (t) => {
    const { cwd, task } = fixture(t);
    const binary = join(cwd, 'fake-worker');
    const result = { reviewer: 'code-reviewer', blockingFindings: [], notes: [], consolidations: null };
    writeFileSync(binary, `#!/usr/bin/env node\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync('argv.json', JSON.stringify(args));
let input=''; process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  fs.writeFileSync('input.txt', input);
  const result = ${JSON.stringify(result)};
  if (args[0] === 'exec') {
    fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify(result));
    process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');
  } else process.stdout.write(JSON.stringify({structured_output:result,is_error:false}));
});\n`, { mode: 0o755 });
    const completed = await runTask(task, runtime, { executables: { [runtime]: binary } });
    assert.equal(completed.status, 'completed');
    assert.deepEqual(JSON.parse(readFileSync(task.outputFile)), { reviewer: 'code-reviewer', blockingFindings: [], notes: [] });
    assert.equal(existsSync(join(cwd, 'HACKED')), false);
    assert.equal(existsSync(`${task.outputFile}.lock`), false);
  });
}

test('worker failure removes stale success and a timeout releases the task lock', async (t) => {
  const { cwd, task } = fixture(t);
  const binary = join(cwd, 'failed-worker');
  writeFileSync(task.outputFile, '{"old":"success"}');
  writeFileSync(binary, '#!/usr/bin/env node\nprocess.exit(3);\n', { mode: 0o755 });
  await assert.rejects(runTask(task, 'codex', { executables: { codex: binary } }), /Worker failed/);
  assert.equal(existsSync(task.outputFile), false);
  writeFileSync(binary, '#!/usr/bin/env node\nsetInterval(() => {}, 100);\n', { mode: 0o755 });
  task.execution.codex.timeoutMs = 100;
  await assert.rejects(runTask(task, 'codex', { executables: { codex: binary } }), /timed out/);
  assert.equal(existsSync(`${task.outputFile}.lock`), false);
});

test('a worker that reports its failure only on stdout surfaces that reason', async (t) => {
  const { cwd, task } = fixture(t);
  const binary = join(cwd, 'logged-out-worker');
  writeFileSync(binary, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({is_error:true,result:"Not logged in · Please run /login"}));\nprocess.exit(1);\n', { mode: 0o755 });
  await assert.rejects(runTask(task, 'claude', { executables: { claude: binary } }), /Worker failed \(1\): .*Not logged in/);
});
