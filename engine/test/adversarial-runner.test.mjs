// The vendored adversarial-review runner reads the reviewer's reply from a
// Conductor transcript. These fixtures mirror real transcripts: a Codex
// session (the first cloud Gate 5 run failed because only `assistant`
// messages were matched), a raw Claude payload, and a normalized message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'adversarial-review', 'scripts', 'run-adversarial-review.sh');
const REPLIES_JQ = /CONDUCTOR_REPLIES_JQ='([\s\S]*?)'\n/.exec(readFileSync(RUNNER, 'utf8'))[1];
const review = { summary: 'ok', findings: [], positive_observations: [], coverage: { files_examined: ['a.ts'], limitations: [] } };

const extract = (transcript) => JSON.parse(execFileSync('jq', ['-c', `${REPLIES_JQ} | last`], { input: JSON.stringify(transcript), encoding: 'utf8' }));

const codexItem = (phase, text) => ({ type: 'agent', content: { type: 'agent', rawPayload: { event: { type: 'item.completed', item: { type: 'agentMessage', phase, text } } } } });

test('a Codex session reply is its final-answer agentMessage, not commentary or the prompt', () => {
  const transcript = { data: [
    { type: 'userMessage', content: { type: 'userMessage', message: 'Act as an independent adversarial reviewer…' } },
    { type: 'agent', content: { rawPayload: { event: { type: 'thread.started' } } } },
    { type: 'agent', content: { rawPayload: { event: { type: 'item.started', item: { type: 'agentMessage', phase: 'final_answer', text: '' } } } } },
    codexItem('commentary', 'Reading the patch now.'),
    codexItem('final_answer', JSON.stringify(review)),
    { type: 'agent', content: { rawPayload: { event: { type: 'turn.completed' } } } },
  ] };
  assert.deepEqual(JSON.parse(extract(transcript)), review);
});

test('a raw Claude assistant payload and a normalized assistant message still match', () => {
  const claude = { data: [{ type: 'agent', content: { rawPayload: { type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify(review) }] } } } }] };
  assert.deepEqual(JSON.parse(extract(claude)[0].text), review);
  const normalized = { data: [{ type: 'assistant', content: review }] };
  assert.deepEqual(extract(normalized), review);
});

test('a transcript with only the prompt has no reply', () => {
  const out = execFileSync('jq', ['-c', `${REPLIES_JQ} | length`], { input: JSON.stringify({ data: [{ type: 'userMessage', content: {} }] }), encoding: 'utf8' });
  assert.equal(out.trim(), '0');
});
