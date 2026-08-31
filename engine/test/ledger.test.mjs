import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger,
  findingFingerprint,
  ledgerSuppress,
  ledgerIngest,
  ledgerOpenBlocking,
  ledgerScore,
  ledgerProgress,
  ledgerVerdict,
  ledgerApplyFix,
  ledgerReport,
  classifyFindings,
  applyAdjudication,
  gutBlockEntries,
  gutRoutedFindings,
  LEDGER_DEFER_ATTEMPTS,
} from '../lib/ledger.mjs';

const finding = (over = {}) => ({
  id: 'R1-01',
  source: 'code-reviewer',
  title: 'Null deref in parser',
  file: 'src/parse.ts',
  detail: 'x may be null',
  rootCause: 'null-deref-parse',
  ...over,
});

const eligible = (f) => ({ finding: f, cls: 'eligible', confidence: 90, diffCaused: true });

test('fingerprint is line-stable and case/whitespace-insensitive', () => {
  const a = findingFingerprint('code-reviewer', { rootCause: 'Null  Deref', file: 'a.ts', line: 3 });
  const b = findingFingerprint('code-reviewer', { rootCause: 'null deref', file: 'a.ts', line: 99 });
  assert.equal(a, b);
});

test('ingest assigns monotonic CR ids and returns open blocking', () => {
  const l = createLedger();
  const open = ledgerIngest(l, 1, [eligible(finding()), eligible(finding({ id: 'R1-02', title: 'Other', rootCause: 'other' }))]);
  assert.deepEqual(open.map((e) => e.id), ['CR-001', 'CR-002']);
  assert.equal(l.nextId, 3);
});

test('advisory and dropped classifications never become fix targets', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [
    { finding: finding(), cls: 'advisory', confidence: 70, diffCaused: true },
    { finding: finding({ id: 'R1-02', rootCause: 'x', title: 'x' }), cls: 'dropped', confidence: 30, diffCaused: true },
  ]);
  assert.equal(ledgerOpenBlocking(l).length, 0);
  assert.equal(l.entries.find((e) => e.id === 'CR-002').status, 'dropped');
});

test('re-raise after fix reopens the same id; defer after LEDGER_DEFER_ATTEMPTS', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [eligible(finding())]);
  const entry = l.entries[0];
  // fix 1 → re-raise reopens (1 < LEDGER_DEFER_ATTEMPTS)
  ledgerApplyFix([entry], { head: 'h1' });
  assert.equal(entry.status, 'addressed');
  ledgerIngest(l, 2, [eligible(finding())]);
  assert.equal(entry.status, 'open');
  // fix 2 → the fingerprint has now survived LEDGER_DEFER_ATTEMPTS fix
  // attempts; the next re-raise defers instead of reopening
  ledgerApplyFix([entry], { head: 'h2' });
  assert.equal(entry.fixAttempts, LEDGER_DEFER_ATTEMPTS);
  ledgerIngest(l, 3, [eligible(finding())]);
  assert.equal(entry.status, 'deferred');
  assert.equal(l.entries.length, 1, 'no duplicate entry was created');
});

test('suppression removes disputed/deferred fingerprints from a round', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [eligible(finding())]);
  ledgerApplyFix(l.entries, { head: 'h', disputed: [{ title: 'Null deref in parser', evidence: 'spec says nullable' }] });
  assert.equal(l.entries[0].status, 'disputed');
  const { kept, suppressed } = ledgerSuppress(l, [finding(), finding({ title: 'Fresh', rootCause: 'fresh' })]);
  assert.equal(suppressed.length, 1);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'Fresh');
});

test('dropped re-raise never reopens without verification', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [{ finding: finding(), cls: 'dropped', confidence: 10, diffCaused: true }]);
  ledgerIngest(l, 2, [{ finding: finding(), cls: 'dropped', confidence: 20, diffCaused: true }]);
  assert.equal(l.entries[0].status, 'dropped');
  // now verified → revives
  ledgerIngest(l, 3, [eligible(finding())]);
  assert.equal(l.entries[0].status, 'open');
});

test('progress: score drop, gate clear, or a dead blocking id all count', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [eligible(finding())]);
  const r1 = ledgerProgress(null, l, false);
  assert.equal(r1.progressed, true);
  const r2 = ledgerProgress(r1.snapshot, l, false);
  assert.equal(r2.progressed, false, 'same open set, no gate = stalled');
  assert.equal(ledgerProgress(r1.snapshot, l, true).progressed, true, 'gate clear counts');
  ledgerApplyFix(l.entries, { head: 'h' });
  assert.equal(ledgerProgress(r2.snapshot, l, false).progressed, true, 'dead blocking id counts');
});

test('verdict language: converged vs stalled naming open ids', () => {
  const l = createLedger();
  assert.equal(ledgerVerdict(l, true), 'converged');
  ledgerIngest(l, 1, [eligible(finding())]);
  assert.match(ledgerVerdict(l, false), /stalled — shipped with 1 open finding\(s\) \(CR-001\)/);
});

test('classifyFindings thresholds + fail-open on missing verdict', () => {
  const fs = [finding(), finding({ id: 'R1-02' }), finding({ id: 'R1-03' }), finding({ id: 'R1-04' })];
  const out = classifyFindings(fs, [
    { id: 'R1-01', diffCaused: true, confidence: 85 },
    { id: 'R1-02', diffCaused: false, confidence: 95 },
    { id: 'R1-03', diffCaused: true, confidence: 59 },
  ]);
  assert.deepEqual(out.map((v) => v.cls), ['eligible', 'advisory', 'dropped', 'eligible']);
});

test('adjudication: upheld reopens, dismissed stays closed with ruling', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [eligible(finding()), eligible(finding({ id: 'R1-02', title: 'B', rootCause: 'b' }))]);
  ledgerApplyFix(l.entries, {
    head: 'h',
    disputed: [
      { id: 'CR-001', title: 'Null deref in parser', evidence: 'e1' },
      { id: 'CR-002', title: 'B', evidence: 'e2' },
    ],
  });
  const upheld = applyAdjudication(l, [
    { id: 'CR-001', ruling: 'upheld', reason: 'evidence holds' },
    { id: 'CR-002', ruling: 'dismissed', reason: 'implementer right' },
  ]);
  assert.deepEqual(upheld.map((e) => e.id), ['CR-001']);
  assert.equal(l.entries[0].status, 'open');
  assert.equal(l.entries[1].status, 'disputed');
  assert.match(l.entries[1].ruling, /^dismissed/);
  assert.match(ledgerReport(l), /adjudicated: dismissed/);
});

test('gut-check: blocks become blocking entries, routes fall back to code-reviewer', () => {
  const l = createLedger();
  const obs = [
    { title: 'Unasked feature', detail: 'whole new page', disposition: 'block' },
    { title: 'Odd timeout', detail: 'why 30s', disposition: 'route', routeArea: 'performance-oracle' },
    { title: 'Weird import', detail: 'unknown area', disposition: 'route', routeArea: 'nonsense' },
    { title: 'Explained', detail: 'fine', disposition: 'reject' },
  ];
  const blocks = gutBlockEntries(l, 1, obs);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].severity, 'blocking');
  const routed = gutRoutedFindings(obs, ['performance-oracle', 'code-reviewer']);
  assert.deepEqual(routed.map((r) => r.source), ['performance-oracle', 'code-reviewer']);
});

test('score weights open entries only', () => {
  const l = createLedger();
  ledgerIngest(l, 1, [eligible(finding()), { finding: finding({ id: 'R1-02', title: 'adv', rootCause: 'adv' }), cls: 'advisory', confidence: 70, diffCaused: true }]);
  assert.equal(ledgerScore(l), 4.25);
  ledgerApplyFix([l.entries[0]], { head: 'h' });
  assert.equal(ledgerScore(l), 0.25);
});
