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

test('later bot fixes invalidate earlier bot approval and stale reviews cannot deliver a new round', () => {
  const snapshot = { complete: true, state: 'open', head: 'B', unresolved: [], reviews: [
    { user: { login: 'copilot' }, commit_id: 'A', submitted_at: '2026-09-07T12:01:00Z' },
  ] };
  const state = { ciHead: 'B', bots: { copilot: { satisfiedHead: 'A' }, rabbit: { satisfiedHead: 'B' } } };
  assert.equal(currentReviewVerdict(snapshot, state, ['copilot', 'rabbit']).verdict, 'NOT MET');
  assert.deepEqual(deliveredReviews(snapshot, 'copilot', { head: 'B', at: '2026-09-07T12:00:00Z' }), []);
  state.bots.copilot.satisfiedHead = 'B';
  assert.equal(currentReviewVerdict(snapshot, state, ['copilot', 'rabbit']).verdict, 'GOAL MET');
});
