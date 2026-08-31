// The finding ledger — review economics for the loop skills.
// Inspired by kramme-cc-workflow (MIT) —
// https://github.com/Abildtoft/kramme-cc-workflow
//
// One ledger per run, persisted to `.context/<slice-id>/ledger.json` by the
// CLI. Every validated finding gets a stable `CR-NNN` id (monotonic, never
// recycled), a fingerprint (source reviewer + file + root cause — never line
// numbers, lines shift across fix commits), and a lifecycle status:
// open | addressed | deferred | disputed | dropped. `addressed` records the
// fix commit hash; disputed/deferred fingerprints auto-suppress re-raises;
// dropped repeats stay visible and are re-validated.

export const LEDGER_WEIGHTS = { blocking: 4, suggestion: 1, advisory: 0.25 };
// Two consecutive reviewer rounds without material progress → stop (stalled).
export const LEDGER_STALL_LIMIT = 2;
// A fingerprint that survives this many fix attempts is deferred, not re-targeted.
export const LEDGER_DEFER_ATTEMPTS = 2;
// Hard round cap — a safety boundary, not a target; the debt-score stop
// conditions are expected to end the loop first.
export const LEDGER_HARD_CAP = 5;

export function createLedger() {
  return { entries: [], nextId: 1 };
}

export function findingFingerprint(source, f) {
  const cause = String(f.rootCause || f.title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${source}|${f.file || '?'}|${cause}`;
}

// Auto-suppression: a re-raised finding whose fingerprint matches a disputed or
// deferred entry never re-enters the round and never scores.
export function ledgerSuppress(ledger, findings) {
  const kept = [];
  const suppressed = [];
  for (const f of findings) {
    const fp = findingFingerprint(f.source, f);
    const hit = ledger.entries.find(
      (e) =>
        e.fingerprint === fp &&
        (e.status === 'disputed' || e.status === 'deferred'),
    );
    (hit ? suppressed : kept).push(f);
  }
  return { kept, suppressed };
}

// Route one round's validated findings into the ledger. `validated` rows are
// { finding (carrying .source and a round-local .id), cls, confidence,
// diffCaused } from classifyFindings. Returns the open blocking entries this
// round should fix.
export function ledgerIngest(ledger, round, validated) {
  for (const v of validated) {
    const f = v.finding;
    const fp = findingFingerprint(f.source, f);
    const existing = ledger.entries.find((e) => e.fingerprint === fp);
    if (!existing) {
      ledger.entries.push({
        id: `CR-${String(ledger.nextId++).padStart(3, '0')}`,
        fingerprint: fp,
        source: f.source,
        title: f.title,
        file: f.file,
        line: f.line,
        detail: f.detail,
        suggestedFix: f.suggestedFix,
        round,
        severity: v.cls === 'eligible' ? 'blocking' : 'advisory',
        status: v.cls === 'dropped' ? 'dropped' : 'open',
        confidence: v.confidence,
        diffCaused: v.diffCaused,
        fixAttempts: 0,
      });
      continue;
    }
    if (existing.status === 'disputed' || existing.status === 'deferred')
      continue; // suppressed upstream; belt-and-braces
    if (existing.status === 'open') {
      existing.line = f.line ?? existing.line;
      continue;
    }
    if (v.cls === 'dropped') continue; // unverified re-raise never reopens
    if (existing.status === 'addressed') {
      // Re-raised after a fix: the same CR id reopens — unless the fingerprint
      // already survived LEDGER_DEFER_ATTEMPTS fix attempts, then it is
      // deferred and stops being targeted.
      if ((existing.fixAttempts || 0) >= LEDGER_DEFER_ATTEMPTS) {
        existing.status = 'deferred';
        continue;
      }
    }
    // addressed (re-raised) or dropped (now verified): reopen/revive
    existing.status = 'open';
    existing.severity = v.cls === 'eligible' ? 'blocking' : 'advisory';
    existing.confidence = v.confidence;
    existing.diffCaused = v.diffCaused;
    existing.detail = f.detail || existing.detail;
    existing.line = f.line ?? existing.line;
  }
  return ledgerOpenBlocking(ledger);
}

export function ledgerOpenBlocking(ledger) {
  return ledger.entries.filter(
    (e) => e.status === 'open' && e.severity === 'blocking',
  );
}

export function ledgerScore(ledger) {
  let s = 0;
  for (const e of ledger.entries)
    if (e.status === 'open') s += LEDGER_WEIGHTS[e.severity] ?? 1;
  return s;
}

// Material progress: the debt score dropped ≥1, an open blocking finding died,
// or a previously-failing gate (tests/commit) cleared. Measured after each
// reviewer round's ingest; anything else is a stalled round.
export function ledgerProgress(prev, ledger, gateCleared) {
  const score = ledgerScore(ledger);
  const openIds = [...new Set(ledgerOpenBlocking(ledger).map((e) => e.id))];
  const progressed =
    !prev ||
    gateCleared ||
    prev.score - score >= 1 ||
    (prev.openIds || []).some((id) => !openIds.includes(id));
  return { progressed, snapshot: { score, openIds } };
}

// Verdict language used everywhere the loop result is reported (skill return,
// PR comment, magnus:babysit-stack input): `converged`, or an explicit stalled
// verdict naming what shipped unresolved — never a silently exhausted cap.
export function ledgerVerdict(ledger, converged) {
  if (converged) return 'converged';
  const open = ledgerOpenBlocking(ledger);
  return open.length
    ? `stalled — shipped with ${open.length} open finding(s) (${open
        .map((e) => e.id)
        .join(', ')})`
    : 'stalled — no open findings, but the loop could not verify convergence';
}

// Feedback/finding view of a ledger entry — feeds fix prompts and `outstanding`.
export function ledgerEntryFinding(e) {
  return {
    id: e.id,
    source: e.source,
    title: e.title,
    file: e.file,
    line: e.line,
    detail: e.detail,
    suggestedFix: e.suggestedFix,
  };
}

// Mark a fix pass's outcome on the entries it targeted. `addressed` requires
// the fix commit hash; disputes carry the implementer's evidence for the
// closeout adjudicator.
export function ledgerApplyFix(targets, fix) {
  const disputed = fix.disputed || [];
  const ids = new Set(disputed.map((d) => d.id).filter(Boolean));
  const titles = new Set(disputed.map((d) => d.title));
  for (const e of targets) {
    e.fixAttempts = (e.fixAttempts || 0) + 1;
    if (ids.has(e.id) || titles.has(e.title)) {
      e.status = 'disputed';
      const d = disputed.find((x) => x.id === e.id || x.title === e.title);
      e.disputeEvidence = d ? d.evidence : '';
    } else {
      e.status = 'addressed';
      e.fixCommit = fix.head || '';
    }
  }
}

// Cross-round memory injected into every reviewer prompt from round 2 on.
export function ledgerHistoryText(ledger) {
  if (!ledger.entries.length) return '';
  const lines = ledger.entries
    .map((e) => `- ${e.id} [${e.status}] (${e.source}) ${e.title}`)
    .join('\n');
  return `

Finding ledger from prior rounds (stable ids, statuses shown):
${lines}
- "addressed": verify the fix where it falls in your focus — re-raise ONLY if it is demonstrably wrong or incomplete (a re-raise reopens the same id).
- "disputed" / "deferred": do NOT re-raise — re-raises are auto-suppressed (disputed goes to the human on the PR; deferred survived ${LEDGER_DEFER_ATTEMPTS} fix attempts and is out of loop scope).
- "dropped": judged unverified by the relevance gate — re-raise only with concrete NEW evidence (file:line proof).
Beyond that, report only NEW problems introduced by the fix diff. Do not sweep for fresh nitpicks in code that already passed earlier rounds.`;
}

// Ledger block for the final PR comment / report: exactly what survived, by
// status, so the human review surface shows the whole story.
export function ledgerReport(ledger) {
  const fmt = (e) =>
    `- ${e.id} [${e.status}] (${e.source}) ${e.title}${e.file ? ` — ${e.file}` : ''}${
      e.disputeEvidence ? `\n  dispute evidence: ${e.disputeEvidence}` : ''
    }${e.ruling ? `\n  adjudicated: ${e.ruling}` : ''}`;
  const open = ledger.entries.filter((e) => e.status === 'open');
  const rest = ledger.entries.filter(
    (e) => e.status === 'deferred' || e.status === 'disputed',
  );
  if (!open.length && !rest.length) return '';
  return [
    open.length ? `Open:\n${open.map(fmt).join('\n')}` : '',
    rest.length ? `Deferred / disputed:\n${rest.map(fmt).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// Shared feedback formatter for fix-pass prompts and validator input.
export function fmtFeedback(blocking) {
  return blocking
    .map(
      (f, i) =>
        `${i + 1}. ${f.id ? `[id: ${f.id}] ` : ''}[${f.source}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}\n   ${f.detail}${f.suggestedFix ? `\n   Suggested fix: ${f.suggestedFix}` : ''}`,
    )
    .join('\n');
}

// Thresholds: confidence ≥80 AND diff-caused → eligible for the fix pass.
// Confidence 60–79, or ≥80 but pre-existing → advisory (a PR note or a
// consolidations follow-up — never fixed in-slice). Below 60 → dropped as
// UNVERIFIED (recorded in the ledger so a repeat is visible). A missing
// verdict (validator died or skipped one) fails open: the finding stays
// eligible rather than silently dying.
export function classifyFindings(findings, verdicts) {
  const map = new Map((verdicts || []).map((v) => [v.id, v]));
  return findings.map((f) => {
    const v = map.get(f.id);
    if (!v)
      return {
        finding: f,
        cls: 'eligible',
        confidence: null,
        diffCaused: true,
      };
    const cls =
      v.confidence < 60
        ? 'dropped'
        : v.confidence >= 80 && v.diffCaused
          ? 'eligible'
          : 'advisory';
    return {
      finding: f,
      cls,
      confidence: v.confidence,
      diffCaused: v.diffCaused,
    };
  });
}

export function applyAdjudication(ledger, rulings) {
  const upheld = [];
  for (const r of rulings || []) {
    const e = ledger.entries.find(
      (x) => x.id === r.id && x.status === 'disputed',
    );
    if (!e) continue;
    e.ruling = `${r.ruling}: ${r.reason}`;
    if (r.ruling === 'upheld') {
      e.status = 'open';
      upheld.push(e);
    }
  }
  return upheld;
}

// Gut-check `block` observations become open blocking ledger entries (stable
// CR ids) so the hard stop shows up in the verdict and ledger report like any
// other unresolved finding.
export function gutBlockEntries(ledger, round, observations) {
  return (observations || [])
    .filter((o) => o.disposition === 'block')
    .map((o) => {
      const entry = {
        id: `CR-${String(ledger.nextId++).padStart(3, '0')}`,
        fingerprint: findingFingerprint('gut-check', o),
        source: 'gut-check',
        title: o.title,
        file: o.file,
        line: o.line,
        detail: `${o.detail} (gut-check BLOCK: work outside the ticket's requirements — the human decides)`,
        round,
        severity: 'blocking',
        status: 'open',
        fixAttempts: 0,
      };
      ledger.entries.push(entry);
      return entry;
    });
}

// route → finding rows for the round's raw findings; the routeArea names the
// reviewer (or area) best placed to judge — unknown values fall back to the
// general code-reviewer so nothing routed is lost.
export function gutRoutedFindings(observations, knownSources) {
  return (observations || [])
    .filter((o) => o.disposition === 'route')
    .map((o) => ({
      title: o.title,
      file: o.file,
      line: o.line,
      detail: o.detail,
      rootCause: o.rootCause,
      source:
        knownSources && knownSources.includes(o.routeArea)
          ? o.routeArea
          : 'code-reviewer',
    }));
}
