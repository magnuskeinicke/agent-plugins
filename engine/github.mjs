#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { reviewSnapshot, currentReviewVerdict } from './lib/github.mjs';

const [pr, stateFile] = process.argv.slice(2);
if (!/^\d+$/.test(pr || '')) throw new Error('Usage: node engine/github.mjs <PR number> [per-pr-state.json]');
const request = async (args) => JSON.parse(execFileSync('gh', args,
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }));
const { nameWithOwner } = await request(['repo', 'view', '--json', 'nameWithOwner']);
const [owner, repo] = nameWithOwner.split('/');
const snapshot = await reviewSnapshot({ owner, repo, pr: Number(pr) }, request);
const state = stateFile ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
if (state && (!Array.isArray(state.requiredBots) || state.requiredBots.some((login) => typeof login !== 'string' || !login))) {
  throw new Error('Verdict state requires requiredBots (explicit [] only for a repo with no configured bots)');
}
const result = state ? currentReviewVerdict(snapshot, state, state.requiredBots) : snapshot;
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
