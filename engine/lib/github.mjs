const threadFields = `id isResolved isOutdated path line
  comments(first:100){nodes{databaseId author{login} body createdAt} pageInfo{hasNextPage endCursor}}`;

export async function reviewSnapshot({ owner, repo, pr }, request) {
  const path = `repos/${owner}/${repo}`;
  const head = await request(['api', `${path}/pulls/${pr}`]);
  const reviews = (await request(['api', '--paginate', '--slurp', `${path}/pulls/${pr}/reviews`])).flat();
  const comments = (await request(['api', '--paginate', '--slurp', `${path}/issues/${pr}/comments`])).flat();
  const threads = [];
  let cursor = null;
  do {
    const query = `query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
      repository(owner:$owner,name:$repo){pullRequest(number:$pr){
        reviewThreads(first:100,after:$cursor){nodes{${threadFields}} pageInfo{hasNextPage endCursor}}
      }}}`;
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `pr=${pr}`];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const result = await request(args);
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    const page = result.data.repository.pullRequest.reviewThreads;
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !cursor) throw new Error('Missing thread pagination cursor');
  } while (cursor);
  for (const thread of threads) {
    while (thread.comments.pageInfo.hasNextPage) {
      const after = thread.comments.pageInfo.endCursor;
      if (!after) throw new Error('Missing comment pagination cursor');
      const query = `query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{
        comments(first:100,after:$cursor){nodes{databaseId author{login} body createdAt} pageInfo{hasNextPage endCursor}}
      }}}`;
      const result = await request(['api', 'graphql', '-f', `query=${query}`, '-f', `id=${thread.id}`, '-f', `cursor=${after}`]);
      if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
      const page = result.data.node.comments;
      thread.comments.nodes.push(...page.nodes);
      thread.comments.pageInfo = page.pageInfo;
    }
  }
  const finalHead = await request(['api', `${path}/pulls/${pr}`]);
  if (head.head.sha !== finalHead.head.sha) throw new Error('PR head changed while reading reviews; fetch a fresh snapshot');
  return { owner, repo, pr, head: head.head.sha, state: head.state, draft: head.draft,
    reviews, comments, threads, unresolved: threads.filter((thread) => !thread.isResolved), complete: true };
}

export function currentReviewVerdict(snapshot, state, orderedBotLogins) {
  const reasons = [];
  const configuredBots = orderedBotLogins.filter(Boolean);
  // An unavailable bot (rate-limited, out of quota, erroring, not enabled, never delivered) is skipped,
  // not waited on: the last available bot becomes the terminal reviewer.
  const unavailable = configuredBots.filter((login) => state.bots?.[login]?.unavailable?.reason);
  const requiredBots = configuredBots.filter((login) => !unavailable.includes(login));
  const finalReviewer = requiredBots.at(-1);
  if (!snapshot.complete) reasons.push('review snapshot is incomplete');
  if (snapshot.state !== 'open') reasons.push('PR is not open');
  if (!snapshot.head || state.ciHead !== snapshot.head) reasons.push('CI evidence does not match the current head');
  for (const login of requiredBots) {
    const satisfiedHead = state.bots?.[login]?.satisfiedHead;
    if (!satisfiedHead) reasons.push(`${login} has not completed its review phase`);
    else if (login === finalReviewer && satisfiedHead !== snapshot.head) reasons.push(`${login} has not reviewed the current head`);
  }
  if (snapshot.unresolved.length) reasons.push(`${snapshot.unresolved.length} unresolved threads`);
  return { verdict: reasons.length ? 'NOT MET' : 'GOAL MET', head: snapshot.head, reasons,
    skippedBots: unavailable.map((login) => ({ login, reason: state.bots[login].unavailable.reason })) };
}

export function deliveredReviews(snapshot, login, trigger) {
  if (trigger.head !== snapshot.head) return [];
  return snapshot.reviews.filter((review) => review.user?.login === login && review.commit_id === snapshot.head &&
    new Date(review.submitted_at).getTime() >= new Date(trigger.at).getTime());
}
