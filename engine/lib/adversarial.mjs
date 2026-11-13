// Gate 5 — the different-provider adversarial review, ported from trackbed's
// pr:review-convergence (MIT, formerly kramme-cc-workflow; see
// agents/sources.yaml). The review itself is the vendored
// skills/adversarial-review runner, verbatim upstream behaviour: one generic
// adversarial prompt, a read-only HEAD snapshot locally, a new session in the
// current workspace on Conductor cloud. This module owns what the convergence
// policy owns: when Gate 5 runs, how its result is attested, how its findings
// enter the ledger, and the cycle cap.

import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findingFingerprint } from './ledger.mjs';

export const ADVERSARIAL_SOURCE = 'adversarial-review';
export const PROVIDERS = ['claude', 'codex'];
const BLOCKING_SEVERITIES = ['critical', 'important'];
const ACTION_CLASSES = {
  critical: ['gated_auto', 'manual'],
  important: ['gated_auto', 'manual'],
  suggestion: ['advisory'],
  fyi: ['advisory'],
};
const OID_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const MODEL_RE = /^[A-Za-z0-9._:/][A-Za-z0-9._:/-]*$/;

export function otherProvider(host) {
  return host === 'claude' ? 'codex' : 'claude';
}

// Resolve Gate 5 for one run from the pinned config and init flags. Review-only
// runs (validation-only in upstream terms) and fix loops both honour it; an
// --inspect run reviews a diff it has not checked out, so the runner — which
// needs the clean committed HEAD — cannot attest it.
export function resolveAdversarial(cfg, { flag, host, reviewOnly, inspect }) {
  const conf = cfg.adversarial || {};
  const requested = flag === undefined ? (reviewOnly ? false : conf.enabled !== false) : flag;
  if (!requested) return { enabled: false, reason: flag === false ? 'disabled by --no-adversarial' : reviewOnly ? 'review-only run without --adversarial' : 'adversarial.enabled is false' };
  if (inspect) return { enabled: false, reason: '--inspect run: Gate 5 needs the clean committed HEAD checked out' };
  if (!PROVIDERS.includes(host)) throw new Error('Gate 5 is enabled: pass --host claude|codex (the runtime this loop runs in)');
  const provider = conf.provider || otherProvider(host);
  if (!PROVIDERS.includes(provider)) throw new Error(`adversarial.provider must be claude or codex, got "${provider}"`);
  if (provider === host) throw new Error('adversarial.provider must differ from the host provider: a fresh same-provider context is not model diversity');
  const model = conf.model || '';
  if (model && !MODEL_RE.test(model)) throw new Error(`invalid adversarial.model: ${model}`);
  const maxCycles = conf.maxCycles ?? 3;
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 5) throw new Error('adversarial.maxCycles must be an integer 1..5');
  return { enabled: true, host, provider, model, maxCycles, cycles: 0, runs: [], attested: null, blockedReason: null };
}

// The exact runner invocation, mirroring skills/adversarial-review Step 3. The
// requirements file lives in a private 0700 directory outside the repository
// (the runner consumes it); result and status files sit beside it.
export function prepareInvocation({ runner, host, provider, model, mergeBase, requirements }) {
  if (!OID_RE.test(mergeBase || '')) throw new Error(`merge base is not a full object id: ${mergeBase}`);
  const runDir = mkdtempSync(join(tmpdir(), 'magnus-adversarial-'));
  chmodSync(runDir, 0o700);
  const requirementsFile = join(runDir, 'requirements.md');
  writeFileSync(requirementsFile, requirements, { mode: 0o600, flag: 'wx' });
  const resultFile = join(runDir, 'result.json');
  const statusFile = join(runDir, 'status');
  const argv = ['--host-provider', host, '--provider', provider, '--merge-base', mergeBase,
    ...(model ? ['--model', model] : []),
    '--requirements-file', requirementsFile, '--consume-requirements-file'];
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const command = `RUNNER_STATUS=0; ${q(runner)} ${argv.map(q).join(' ')} < /dev/null > ${q(resultFile)} || RUNNER_STATUS=$?; printf '%s\\n' "$RUNNER_STATUS" > ${q(statusFile)}`;
  return { runDir, requirementsFile, resultFile, statusFile, runner, argv, command };
}

// Validate the runner's normalized result against the identities captured when
// Gate 5 was emitted and the live repository state. Any failure blocks Gate 5 —
// never a clean result, never a same-provider fallback.
export function checkResult(result, expected, live) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['result is not a JSON object'];
  if (result.host_provider !== expected.host) errors.push(`host_provider "${result.host_provider}" != "${expected.host}"`);
  if (result.review_provider !== expected.provider) errors.push(`review_provider "${result.review_provider}" != "${expected.provider}"`);
  if (result.review_provider === result.host_provider) errors.push('review provider equals the host provider');
  if (result.reviewed_head !== expected.head) errors.push(`reviewed_head ${result.reviewed_head} != prepared HEAD ${expected.head}`);
  if (result.reviewed_tree !== expected.tree) errors.push(`reviewed_tree ${result.reviewed_tree} != prepared tree ${expected.tree}`);
  if (live.head !== expected.head || live.tree !== expected.tree) errors.push('HEAD or its tree changed while Gate 5 ran');
  if (live.branch !== expected.branch) errors.push(`branch changed while Gate 5 ran (${expected.branch} → ${live.branch})`);
  if (live.dirty) errors.push('worktree is not clean after Gate 5');
  if (typeof result.summary !== 'string' || !result.summary.trim()) errors.push('summary missing');
  if (!Array.isArray(result.positive_observations)) errors.push('positive_observations missing');
  const files = result.coverage?.files_examined;
  if (!Array.isArray(files) || !files.length || files.some((f) => typeof f !== 'string' || !f)) errors.push('coverage.files_examined must list at least one file');
  if (!Array.isArray(result.coverage?.limitations)) errors.push('coverage.limitations missing');
  if (!Array.isArray(result.findings)) errors.push('findings missing');
  else result.findings.forEach((f, i) => {
    for (const key of ['location', 'summary', 'evidence', 'recommendation'])
      if (typeof f?.[key] !== 'string' || !f[key].trim()) errors.push(`findings[${i}].${key} missing`);
    if (!ACTION_CLASSES[f?.severity]) errors.push(`findings[${i}].severity "${f?.severity}" invalid`);
    else if (!ACTION_CLASSES[f.severity].includes(f.action_class)) errors.push(`findings[${i}] action_class "${f.action_class}" does not fit severity "${f.severity}"`);
  });
  return errors;
}

function parseLocation(location) {
  const m = /^(.+?):(\d+)(?:[-:]\d+)?$/.exec(location.trim());
  return m ? { file: m[1], line: Number(m[2]) } : { file: location.trim() };
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'finding';
}

// Provider findings → the engine's findings report. Critical/important become
// blocking candidates for the validator (their reported severity is kept,
// immutable); suggestion/fyi stay advisory notes and never block.
export function toFindingsReport(result) {
  const blockingFindings = [];
  const notes = [];
  for (const f of result.findings) {
    if (BLOCKING_SEVERITIES.includes(f.severity)) {
      blockingFindings.push({
        title: f.summary,
        ...parseLocation(f.location),
        detail: `[${f.severity}, ${f.action_class}] ${f.evidence}`,
        suggestedFix: f.recommendation,
        rootCause: slug(f.summary),
      });
    } else {
      notes.push(`[${f.severity}] ${f.location}: ${f.summary} — ${f.recommendation}`);
    }
  }
  return { reviewer: ADVERSARIAL_SOURCE, blockingFindings, notes };
}

// Every provider finding was reported as critical/important when it reached the
// ledger. Rejecting or demoting one for any reason other than "pre-existing /
// outside the diff" is a disagreement with the other provider: upstream hands
// it to the user; this unattended loop hands it to the adjudicator instead.
export function disputeDemoted(ledger, validated, verdicts = []) {
  const notes = new Map(verdicts.map((v) => [v.id, v.note || '']));
  const disputed = [];
  for (const v of validated) {
    if (v.finding.source !== ADVERSARIAL_SOURCE || v.cls === 'eligible' || v.diffCaused === false) continue;
    const fp = findingFingerprint(ADVERSARIAL_SOURCE, v.finding);
    const entry = ledger.entries.find((e) => e.fingerprint === fp);
    // `addressed` too: a fixed finding the other provider raises again and the
    // validator then rejects is a renewed disagreement, not a silent drop.
    if (!entry || !['open', 'dropped', 'addressed'].includes(entry.status)) continue;
    entry.status = 'disputed';
    entry.severity = 'blocking';
    entry.dispute = `validator ${v.cls === 'dropped' ? 'rejected' : 'demoted'} a ${ADVERSARIAL_SOURCE} finding the other provider reported as critical/important (confidence ${v.confidence ?? 'n/a'})`;
    // The adjudicator weighs the provider's evidence (detail) against the host
    // validator's: its note is this side of the disagreement.
    entry.disputeEvidence = `host validator ${v.cls === 'dropped' ? 'rejected' : 'demoted'} it at confidence ${v.confidence ?? 'n/a'}: ${notes.get(v.finding.id) || '(no note)'}`;
    disputed.push(entry);
  }
  return disputed;
}

export function readResultFiles(resultFile, statusFile) {
  let status;
  try { status = readFileSync(statusFile, 'utf8').trim(); } catch { return { error: 'status file missing — a host stop or timeout; the review is blocked' }; }
  if (status !== '0') {
    let output = '';
    try { output = readFileSync(resultFile, 'utf8').slice(0, 4000); } catch {}
    return { error: `runner exited ${status}${output ? `: ${output}` : ''}` };
  }
  try { return { result: JSON.parse(readFileSync(resultFile, 'utf8')) }; } catch (e) { return { error: `result is not JSON: ${e.message}` }; }
}

// Upstream's Independent Review Record one-liner, for the PR body.
// null while Gate 5 is owed, pending or blocked, and when its last attestation
// is not of the loop's final tree (a later in-loop fix was never re-reviewed).
export function independentReviewLine(adv, ledger, phase) {
  if (!adv?.enabled) return 'Independent review: not requested';
  if (!adv.attested || adv.blockedReason || adv.pending) return null;
  if (phase === 'adversarial' || phase === 'adversarial-blocked') return null;
  if (adv.lastLoopTree && adv.attested.tree !== adv.lastLoopTree) return null;
  const mine = ledger.entries.filter((e) => e.source === ADVERSARIAL_SOURCE && e.severity === 'blocking' && e.status !== 'dropped');
  const fixed = mine.filter((e) => e.status === 'addressed').length;
  const decided = mine.filter((e) => e.ruling).length;
  const { provider, model, tree, patchId } = adv.attested;
  return `Independent review: ${provider} ${model || 'provider default unresolved'}; tree ${tree}; change patch ${patchId}; blocking findings ${mine.length} (fixed ${fixed}); disagreements decided by the adjudicator ${decided}`;
}
