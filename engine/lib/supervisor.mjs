import { randomUUID } from 'node:crypto';

export function relayMarker(transcript, sessionId) {
  const markers = [];
  const visit = (value) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/<!-- magnus:relay (\{[^\n]*\}) -->/g)) {
        try {
          const marker = JSON.parse(match[1]);
          if (marker.sessionId === sessionId && ['handoff', 'complete', 'blocked', 'tracker-pending'].includes(marker.state)) markers.push(marker);
        } catch {}
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(transcript);
  return markers.at(-1) || null;
}

export async function superviseStep(state, transport, save) {
  if (['complete', 'blocked', 'tracker-pending'].includes(state.state)) return state;
  const status = await transport.status(state.sessionId);
  if (status !== 'idle') {
    if (!['working', 'running', 'pending', 'queued'].includes(status)) throw new Error(`Unknown session status: ${status}`);
    state.sessionStartedAt ||= new Date().toISOString();
    if (Date.now() - Date.parse(state.sessionStartedAt) > (state.maxSessionMs || 21_600_000)) {
      state.state = 'blocked';
      state.reason = 'Session exceeded the monitoring deadline; inspect the existing worker before resuming';
    }
    await save(state);
    return state;
  }
  const marker = relayMarker(await transport.messages(state.sessionId), state.sessionId);
  if (marker?.state === 'handoff') {
    if (typeof marker.nextSessionId !== 'string' || !marker.nextSessionId || marker.nextSessionId === state.sessionId) {
      throw new Error('Relay handoff requires a different nextSessionId');
    }
    if (!['claude', 'codex'].includes(marker.runtime) || !marker.model || !marker.effort) {
      throw new Error('Relay handoff requires the destination runtime, model and effort');
    }
    state.sessionId = marker.nextSessionId;
    state.runtime = marker.runtime;
    state.model = marker.model;
    state.effort = marker.effort;
    state.sessionStartedAt = new Date().toISOString();
    state.restarts = 0;
    state.pendingRestart = null;
    state.state = 'watching';
  } else if (marker) {
    state.state = marker.state;
    state.reason = marker.reason || '';
  } else {
    if ((state.restarts || 0) >= 1 && !state.pendingRestart) {
      state.state = 'blocked';
      state.reason = 'The replacement session also ended without a relay result';
    } else {
      if (!state.pendingRestart) {
        state.pendingRestart = { sessionId: randomUUID(), messageId: randomUUID() };
        await save(state);
      }
      await transport.restart(state, state.pendingRestart);
      state.sessionId = state.pendingRestart.sessionId;
      state.sessionStartedAt = new Date().toISOString();
      state.pendingRestart = null;
      state.restarts = (state.restarts || 0) + 1;
      state.state = 'watching';
    }
  }
  await save(state);
  return state;
}
