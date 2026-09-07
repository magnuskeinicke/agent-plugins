#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { superviseStep } from './lib/supervisor.mjs';

const file = process.argv[2];
// `--once` is accepted for compatibility; a single step is the only behaviour.
if (!file) throw new Error('Usage: node engine/supervise.mjs <supervisor-state.json> [--once]');
const stateFile = resolve(file);
const lock = `${stateFile}.lock`;
mkdirSync(lock);
writeFileSync(`${lock}/pid`, String(process.pid));
process.on('exit', () => rmSync(lock, { recursive: true, force: true }));
process.on('SIGTERM', () => process.exit(143));
process.on('SIGINT', () => process.exit(130));
let state = JSON.parse(readFileSync(stateFile, 'utf8'));
for (const key of ['workspaceId', 'sessionId', 'runtime', 'model', 'effort', 'messageFile']) {
  if (typeof state[key] !== 'string' || !state[key]) throw new Error(`Supervisor state requires ${key}`);
}
if (!['claude', 'codex'].includes(state.runtime)) throw new Error('Invalid supervisor runtime');
const conductor = (...args) => JSON.parse(execFileSync('conductor', [...args, '--json'],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }));
const transport = {
  status: async (id) => conductor('session', 'status', id).status,
  messages: async (id) => {
    const messages = [];
    for (let offset = 0; ; offset += 100) {
      const result = conductor('session', 'message', id, '--limit', '100', '--offset', String(offset));
      const page = Array.isArray(result) ? result : result.messages || result.data;
      if (!Array.isArray(page)) throw new Error('Unknown Conductor transcript format');
      messages.push(...page);
      if (page.length < 100) return messages;
    }
  },
  restart: async (current, pending) => {
    try {
      const existing = conductor('session', 'get', pending.sessionId);
      if (existing) return;
    } catch (error) {
      if (!/404|not found/i.test(String(error.stderr || error.message))) throw error;
    }
    conductor('session', 'create', '--workspace', current.workspaceId, '--session-id', pending.sessionId,
      '--message-id', pending.messageId, '--agent', current.runtime, '--model', current.model,
      '--effort', current.effort, '--message-file', resolve(current.messageFile));
  },
};
const save = async (value) => {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${stateFile}.tmp`, stateFile);
};
// One step per invocation, by design: the cloud relay starts its own successors,
// so nothing supervises it between invocations of the calling skill.
state = await superviseStep(state, transport, save);
process.stdout.write(JSON.stringify({ state: state.state, sessionId: state.sessionId, reason: state.reason }) + '\n');
