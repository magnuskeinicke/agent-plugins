import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, createWriteStream } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { validate } from './schemas.mjs';

export function strictOutputSchema(schema) {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => {
      const child = strictOutputSchema(value);
      return [key, (schema.required || []).includes(key) ? child : { anyOf: [child, { type: 'null' }] }];
    }));
    return { ...schema, properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (schema.type === 'array') return { ...schema, items: strictOutputSchema(schema.items) };
  return schema;
}

function omitOptionalNulls(value, schema) {
  if (schema.type === 'array' && Array.isArray(value)) return value.map((entry) => omitOptionalNulls(entry, schema.items));
  if (schema.type !== 'object' || value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => entry !== null || (schema.required || []).includes(key))
    .map(([key, entry]) => [key, schema.properties?.[key] ? omitOptionalNulls(entry, schema.properties[key]) : entry]));
}

export function buildInvocation(task, runtime, files) {
  const execution = task.execution?.[runtime];
  if (!execution || !['claude', 'codex'].includes(runtime)) throw new Error(`Task has no execution profile for ${runtime}`);
  const { model, effort, access, timeoutMs } = execution;
  if (!model || !effort || !['read-only', 'workspace-write'].includes(access) || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Invalid task execution profile');
  }
  const body = task.agentFile ? readFileSync(task.agentFile, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') : '';
  const prompt = [readFileSync(task.promptFile, 'utf8'),
    'Return the result as your final JSON response. The parent writes the output file; do not write it yourself.'].join('\n\n');
  if (runtime === 'codex') {
    return { command: 'codex', args: ['exec', '--model', model, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
      '-c', 'approval_policy="never"', '--sandbox', access, '--cd', task.cwd, '--ephemeral', '--json',
      '--output-schema', files.schema, '--output-last-message', files.result, '-'],
    input: [body, prompt].filter(Boolean).join('\n\n'), cwd: task.cwd, timeoutMs };
  }
  const args = ['-p', '--model', model, '--effort', effort, '--output-format', 'json',
    '--json-schema', JSON.stringify(strictOutputSchema(task.schema)), '--no-session-persistence',
    '--permission-mode', 'dontAsk'];
  if (access === 'read-only') {
    args.push('--tools', 'Read,Glob,Grep,Bash', '--allowedTools',
      'Read', 'Glob', 'Grep', 'Bash(git diff *)', 'Bash(git show *)', 'Bash(git log *)',
      'Bash(git status *)', 'Bash(git ls-files *)', 'Bash(rg *)', 'Bash(cat *)', 'Bash(sed *)',
      'Bash(gh pr view *)', 'Bash(gh pr diff *)');
  } else {
    args.push('--allowedTools', 'Read', 'Glob', 'Grep', 'Edit', 'Write');
  }
  if (body) args.push('--append-system-prompt', body);
  return { command: 'claude', args, input: prompt, cwd: task.cwd, timeoutMs };
}

async function execute(invocation, logPath, executables) {
  return new Promise((resolveResult, reject) => {
    const log = createWriteStream(logPath);
    const child = spawn(executables?.[invocation.command] || invocation.command, invocation.args,
      { cwd: invocation.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflow = false;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, invocation.timeoutMs);
    child.stdout.on('data', (chunk) => {
      log.write(chunk);
      stdout += chunk;
      if (stdout.length > 16_000_000) { overflow = true; kill(); }
    });
    child.stderr.on('data', (chunk) => { log.write(chunk); stderr = (stderr + chunk).slice(-16_000); });
    child.stdin.on('error', () => {});
    child.once('error', (error) => { clearTimeout(timer); log.end(); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      log.end();
      if (timedOut) reject(new Error(`Worker timed out after ${invocation.timeoutMs}ms`));
      else if (overflow) reject(new Error('Worker output exceeded 16 MB'));
      else if (code !== 0) reject(new Error(`Worker failed (${code ?? signal}): ${stderr}`));
      else resolveResult(stdout);
    });
    child.stdin.end(invocation.input);
  });
}

export async function runTask(task, runtime, { dryRun = false, executables } = {}) {
  if (!task.cwd || !task.promptFile || !task.outputFile || !task.schema) throw new Error('Incomplete task manifest');
  const output = resolve(task.outputFile);
  const workDir = join(dirname(output), '.workers', basename(output));
  const files = { schema: join(workDir, 'schema.json'), result: join(workDir, 'response.json'), log: join(workDir, 'worker.log') };
  const invocation = buildInvocation(task, runtime, files);
  if (dryRun) return { ...invocation, input: undefined, outputFile: output };
  mkdirSync(dirname(output), { recursive: true });
  const lock = `${output}.lock`;
  mkdirSync(lock);
  try {
    mkdirSync(workDir, { recursive: true });
    rmSync(output, { force: true });
    rmSync(files.result, { force: true });
    writeFileSync(files.schema, JSON.stringify(strictOutputSchema(task.schema)));
    const stdout = await execute(invocation, files.log, executables);
    let result;
    if (runtime === 'codex') {
      for (const line of stdout.split('\n').filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type === 'turn.failed' || event.type === 'error') throw new Error(`Codex worker reported ${event.type}`);
      }
      result = JSON.parse(readFileSync(files.result, 'utf8'));
    } else {
      const envelope = JSON.parse(stdout);
      if (envelope.is_error) throw new Error(`Claude worker failed: ${envelope.result || envelope.subtype}`);
      result = envelope.structured_output;
      if (result === undefined) throw new Error('Claude worker returned no structured_output');
    }
    result = omitOptionalNulls(result, task.schema);
    const errors = validate(result, task.schema);
    if (result?.reviewer && result.reviewer !== task.id) errors.push('reviewer identity mismatch');
    if (errors.length) throw new Error(`Invalid worker result: ${errors.join('; ')}`);
    writeFileSync(`${output}.tmp`, JSON.stringify(result, null, 2) + '\n');
    renameSync(`${output}.tmp`, output);
    return { status: 'completed', id: task.id, runtime, model: task.execution[runtime].model, outputFile: output, logFile: files.log };
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
