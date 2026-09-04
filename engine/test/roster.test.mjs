import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectReviewers, overlayFor, ROSTER, OFF_LOOP } from '../lib/roster.mjs';
import { compileAreaPaths, selectAreas } from '../lib/areas.mjs';
import { REPO_CONFIG_DEFAULTS } from '../lib/defaults.mjs';
import { resolveRepoConfig, focusOverlay, loadRepoConfig } from '../lib/config.mjs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'agents');
const ids = (sel) => sel.selected.map((r) => r.id);

test('every roster + off-loop id has a vendored agent file', () => {
  for (const id of [...ROSTER.map((r) => r.id), ...OFF_LOOP])
    assert.ok(existsSync(join(AGENTS_DIR, `${id}.md`)), `agents/${id}.md missing`);
});

test('round 1 minimal diff: always-on + round1 tier, no unmet conditionals', () => {
  const sel = selectReviewers({ round: 1, changedFiles: ['src/util.ts'] });
  const got = ids(sel);
  for (const id of ['code-reviewer', 'silent-failure-hunter', 'deslop-reviewer', 'lean-reviewer', 'code-simplifier', 'codebase-pattern-reviewer', 'comment-analyzer'])
    assert.ok(got.includes(id), `${id} should always run round 1`);
  for (const id of ['injection-reviewer', 'a11y-auditor', 'removal-planner', 'pr-test-analyzer'])
    assert.ok(!got.includes(id), `${id} should not trigger`);
});

test('security area launches the whole bundle together', () => {
  const areas = selectAreas(compileAreaPaths(REPO_CONFIG_DEFAULTS.areaPaths), ['src/auth/login.ts'], []);
  assert.ok(areas.includes('security'));
  const got = ids(selectReviewers({ round: 1, areas, changedFiles: ['src/auth/login.ts'] }));
  for (const id of ['injection-reviewer', 'auth-reviewer', 'data-reviewer', 'logic-reviewer'])
    assert.ok(got.includes(id), `${id} missing from security bundle`);
});

test('backend force-adds security, frontend force-adds performance', () => {
  const compiled = compileAreaPaths(REPO_CONFIG_DEFAULTS.areaPaths);
  assert.ok(selectAreas(compiled, ['server/handler.ts'], []).includes('security'));
  const fe = selectAreas(compiled, ['components/Button.tsx'], []);
  assert.ok(fe.includes('performance'));
  const got = ids(selectReviewers({ round: 1, areas: fe, changedFiles: ['components/Button.tsx'], userFacing: true }));
  assert.ok(got.includes('a11y-auditor'));
  assert.ok(got.includes('copy-reviewer'));
  assert.ok(got.includes('performance-oracle'));
});

test('conditional triggers: tests, types, deletions, conventions gate, overengineering gate', () => {
  const base = { round: 1, changedFiles: ['src/a.test.ts'] };
  assert.ok(ids(selectReviewers(base)).includes('pr-test-analyzer'));
  assert.ok(ids(selectReviewers({ round: 1, changedFiles: ['src/schema.prisma'] })).includes('type-design-analyzer'));
  assert.ok(ids(selectReviewers({ round: 1, changedFiles: ['a.ts'], deletedFiles: ['b.ts'] })).includes('removal-planner'));
  const many = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
  assert.ok(ids(selectReviewers({ round: 1, changedFiles: many })).includes('convention-drift-reviewer'));
  assert.ok(!ids(selectReviewers({ round: 1, changedFiles: ['a.ts'] })).includes('overengineering-reviewer'));
  assert.ok(ids(selectReviewers({ round: 1, changedFiles: ['a.ts'], insertions: 151 })).includes('overengineering-reviewer'));
  assert.ok(ids(selectReviewers({ round: 1, changedFiles: ['a.ts'], addedFiles: ['n.ts'] })).includes('overengineering-reviewer'));
});

test('fix rounds: always-on + open-finding owners + reuse rerun until clean', () => {
  const sel = selectReviewers({
    round: 2,
    changedFiles: ['src/fix.ts'],
    openSources: ['performance-oracle'],
    reuseClean: false,
  });
  const got = ids(sel);
  assert.ok(got.includes('code-reviewer'));
  assert.ok(got.includes('performance-oracle'), 'open-finding owner re-runs');
  assert.ok(got.includes('codebase-pattern-reviewer'), 're-runs until clean pass');
  assert.ok(!got.includes('lean-reviewer'), 'round1 tier does not re-run');
  assert.ok(!got.includes('comment-analyzer'), 'round1 tier does not re-run on a code-only fix range');
  const docsFix = ids(selectReviewers({ round: 2, changedFiles: ['docs/adr/0003-x.md'], openSources: [], reuseClean: true }));
  assert.ok(docsFix.includes('comment-analyzer'), 'docs touched in the fix range re-triggers it');
  const clean = ids(selectReviewers({ round: 2, changedFiles: ['src/fix.ts'], openSources: [], reuseClean: true }));
  assert.ok(!clean.includes('codebase-pattern-reviewer'), 'clean reuse pass skips');
});

test('overlay: generalists get all triggered areas, specialists their own, deslop none', () => {
  const cfg = resolveRepoConfig({ reviewers: { security: { focus: 'tenant isolation on org id' }, frontend: { focus: 'use the DS Button' } } });
  const overlays = focusOverlay(cfg, ['security', 'frontend']);
  assert.equal(overlays.length, 2);
  assert.equal(overlayFor('code-reviewer', ['security', 'frontend'], overlays).length, 2);
  const auth = overlayFor('auth-reviewer', ['security', 'frontend'], overlays);
  assert.deepEqual(auth.map((o) => o.area), ['security']);
  assert.equal(overlayFor('deslop-reviewer', ['security', 'frontend'], overlays).length, 0);
});

test('config merge: two levels deep, empty never wins, arrays replace wholesale', () => {
  const cfg = resolveRepoConfig({
    integrationBranch: 'origin/development',
    gates: { all: 'pnpm nx affected -t lint test build', format: '' },
    reviewers: { database: { focus: 'drizzle only' } },
    areaPaths: { frontend: [] },
  });
  assert.equal(cfg.integrationBranch, 'origin/development');
  assert.equal(cfg.gates.all, 'pnpm nx affected -t lint test build');
  assert.equal(cfg.gates.format, '', 'empty string keeps the (empty) default');
  assert.equal(cfg.reviewers.database.focus, 'drizzle only');
  assert.equal(cfg.reviewers.frontend.focus, REPO_CONFIG_DEFAULTS.reviewers.frontend.focus, 'unset lane keeps generic lens');
  assert.deepEqual(cfg.areaPaths.frontend, [], '[] replaces wholesale (disables triggers)');
});

test('loadRepoConfig: missing file and missing block are supported states', () => {
  assert.deepEqual(loadRepoConfig('/nonexistent/repo-config.md'), {});
});
