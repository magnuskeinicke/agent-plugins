import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSnapshot, currentReviewVerdict, deliveredReviews } from '../lib/github.mjs';

test('snapshots include later review pages, thread pages and comment pages', async () => {
  const seen = [];
  const request = async (args) => {
    seen.push(args);
    if (args[1] !== 'graphql') {
      if (args.includes('repos/o/r/pulls/1')) return { head: { sha: 'head' }, state: 'open', draft: true };
      if (args.at(-1).endsWith('/reviews')) return [[{ id: 1 }], [{ id: 2 }]];
      return [[{ id: 3 }], [{ id: 4 }]];
    }
    if (args.includes('id=t1')) return { data: { node: { comments: { nodes: [{ body: 'later comment' }], pageInfo: { hasNextPage: false } } } } };
    const second = args.includes('cursor=next');
    const thread = second ? { id: 't2', isResolved: false, comments: { nodes: [], pageInfo: { hasNextPage: false } } }
      : { id: 't1', isResolved: true, comments: { nodes: [{ body: 'first comment' }], pageInfo: { hasNextPage: true, endCursor: 'comment-next' } } };
    return { data: { repository: { pullRequest: { reviewThreads: {
      nodes: [thread], pageInfo: { hasNextPage: !second, endCursor: second ? null : 'next' },
    } } } } };
  };
  const snapshot = await reviewSnapshot({ owner: 'o', repo: 'r', pr: 1 }, request);
  assert.equal(snapshot.reviews.length, 2);
  assert.equal(snapshot.comments.length, 2);
  assert.equal(snapshot.threads[0].comments.nodes.length, 2);
  assert.deepEqual(snapshot.unresolved.map((thread) => thread.id), ['t2']);
  assert.equal(seen.filter((args) => args.includes('--paginate') && args.includes('--slurp')).length, 2);
});

test('the final reviewer covers fixes from later review phases', () => {
  const snapshot = { complete: true, state: 'open', head: 'B', unresolved: [], reviews: [
    { user: { login: 'copilot' }, commit_id: 'A', submitted_at: '2026-09-07T12:01:00Z' },
  ] };
  const state = { ciHead: 'B', bots: { copilot: { satisfiedHead: 'A' }, rabbit: { satisfiedHead: 'B' } } };
  assert.equal(currentReviewVerdict(snapshot, state, ['copilot', 'rabbit']).verdict, 'GOAL MET');
  assert.deepEqual(deliveredReviews(snapshot, 'copilot', { head: 'B', at: '2026-09-07T12:00:00Z' }), []);
});

test('the final configured reviewer must cover the current head', () => {
  const snapshot = { complete: true, state: 'open', head: 'B', unresolved: [], reviews: [] };
  const state = { ciHead: 'B', bots: { copilot: { satisfiedHead: 'A' }, rabbit: { satisfiedHead: 'A' } } };
  const twoBots = currentReviewVerdict(snapshot, state, ['copilot', 'rabbit']);
  assert.equal(twoBots.verdict, 'NOT MET');
  assert.deepEqual(twoBots.reasons, ['rabbit has not reviewed the current head']);

  const oneBot = currentReviewVerdict(snapshot, state, ['copilot']);
  assert.equal(oneBot.verdict, 'NOT MET');
  assert.deepEqual(oneBot.reasons, ['copilot has not reviewed the current head']);
});

test('every earlier reviewer must complete before the final reviewer can satisfy the verdict', () => {
  const snapshot = { complete: true, state: 'open', head: 'B', unresolved: [], reviews: [] };
  const state = { ciHead: 'B', bots: { rabbit: { satisfiedHead: 'B' } } };
  const result = currentReviewVerdict(snapshot, state, ['copilot', 'rabbit']);
  assert.equal(result.verdict, 'NOT MET');
  assert.deepEqual(result.reasons, ['copilot has not completed its review phase']);
});

test('an unavailable bot is skipped and the last available bot is the terminal reviewer', () => {
  const snapshot = { complete: true, state: 'open', head: 'B', unresolved: [], reviews: [] };
  const rateLimited = { unavailable: { reason: 'rate limit exceeded', head: 'B' } };
  const finalSkipped = currentReviewVerdict(snapshot,
    { ciHead: 'B', bots: { copilot: { satisfiedHead: 'B' }, rabbit: rateLimited } }, ['copilot', 'rabbit']);
  assert.equal(finalSkipped.verdict, 'GOAL MET');
  assert.deepEqual(finalSkipped.skippedBots, [{ login: 'rabbit', reason: 'rate limit exceeded' }]);

  const staleFallback = currentReviewVerdict(snapshot,
    { ciHead: 'B', bots: { copilot: { satisfiedHead: 'A' }, rabbit: rateLimited } }, ['copilot', 'rabbit']);
  assert.deepEqual(staleFallback.reasons, ['copilot has not reviewed the current head']);

  const firstSkipped = currentReviewVerdict(snapshot,
    { ciHead: 'B', bots: { copilot: rateLimited, rabbit: { satisfiedHead: 'B' } } }, ['copilot', 'rabbit']);
  assert.equal(firstSkipped.verdict, 'GOAL MET');

  const noneAvailable = currentReviewVerdict(snapshot,
    { ciHead: 'B', bots: { copilot: rateLimited, rabbit: rateLimited } }, ['copilot', 'rabbit']);
  assert.equal(noneAvailable.verdict, 'GOAL MET');
  assert.equal(noneAvailable.skippedBots.length, 2);
});

test('skipping an unavailable bot never waives CI or unresolved threads', () => {
  const snapshot = { complete: true, state: 'open', head: 'B', unresolved: [{ id: 't1' }], reviews: [] };
  const state = { ciHead: 'A', bots: { rabbit: { unavailable: { reason: 'review failed' } } } };
  assert.deepEqual(currentReviewVerdict(snapshot, state, ['rabbit']).reasons,
    ['CI evidence does not match the current head', '1 unresolved threads']);
});
