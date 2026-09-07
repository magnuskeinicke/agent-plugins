import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayMarker, superviseStep } from '../lib/supervisor.mjs';

test('supervisor follows a baton, restarts one crashed session, and stops on a second crash', async () => {
  const state = { state: 'watching', sessionId: 'one', restarts: 0 };
  const saves = [];
  let restartCount = 0;
  const transport = { status: async () => 'idle', messages: async () => [
    { content: '<!-- magnus:relay {"sessionId":"one","state":"handoff","nextSessionId":"two","runtime":"codex","model":"gpt-5.6-sol","effort":"xhigh"} -->' },
  ], restart: async (value, pending) => {
    assert.equal(saves.at(-1).pendingRestart.sessionId, pending.sessionId);
    restartCount++;
  } };
  const save = async (value) => saves.push(structuredClone(value));
  await superviseStep(state, transport, save);
  assert.equal(state.sessionId, 'two');
  assert.equal(state.runtime, 'codex');
  assert.equal(state.model, 'gpt-5.6-sol');
  transport.messages = async () => [];
  await superviseStep(state, transport, save);
  assert.equal(restartCount, 1);
  await superviseStep(state, transport, save);
  assert.equal(restartCount, 1);
  assert.equal(state.state, 'blocked');
});

test('explicit human blockers and tracker handoffs never trigger duplicate workers', async () => {
  for (const markerState of ['blocked', 'tracker-pending', 'complete']) {
    const state = { state: 'watching', sessionId: 'one' };
    const transport = { status: async () => 'idle', messages: async () => [
      { text: `<!-- magnus:relay ${JSON.stringify({ sessionId: 'one', state: markerState })} -->` },
    ], restart: async () => assert.fail('must not restart') };
    await superviseStep(state, transport, async () => {});
    assert.equal(state.state, markerState);
  }
});

test('a retry after an uncertain create reuses the persisted session identity', async () => {
  const pendingRestart = { sessionId: 'planned-session', messageId: 'planned-message' };
  const state = { state: 'watching', sessionId: 'old', pendingRestart, restarts: 0 };
  const transport = { status: async () => 'idle', messages: async () => [], restart: async (_, pending) => {
    assert.deepEqual(pending, pendingRestart);
  } };
  await superviseStep(state, transport, async () => {});
  assert.equal(state.sessionId, 'planned-session');
});

test('markers from another session cannot complete the current run', () => {
  assert.equal(relayMarker({ text: '<!-- magnus:relay {"sessionId":"old","state":"complete"} -->' }, 'new'), null);
});

test('an overlong running session stops supervision without launching a competing writer', async () => {
  const state = { state: 'watching', sessionId: 'one', sessionStartedAt: '2020-01-01T00:00:00Z' };
  await superviseStep(state, { status: async () => 'working', restart: async () => assert.fail('competing writer') }, async () => {});
  assert.equal(state.state, 'blocked');
});
