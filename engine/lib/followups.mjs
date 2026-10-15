// Follow-up tickets from the reuse audit's `consolidations`. The orchestrating
// skill files exactly what `followups` returns — the filter, dedupe and cap
// live here so a run cannot drift into one ticket per reviewer hunch.
//
// A candidate qualifies only with two real call sites outside the diff (the
// duplication already exists; the diff would be the third copy). Qualified
// candidates: at most FOLLOWUP_TICKET_CAP become their own ticket, the rest
// are appended to one rolling follow-ups ticket. Everything else is demoted.
import { createHash } from 'node:crypto';

export const FOLLOWUP_TICKET_CAP = 1;
export const FOLLOWUP_MIN_CALL_SITES = 2;

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function followupFingerprint(c) {
  return createHash('sha1')
    .update(`${slug(c.targetLib)}|${slug(c.rootCause || c.title)}`)
    .digest('hex')
    .slice(0, 12);
}

// Merges one round's consolidations into the run's candidate list: a re-raise
// (same fingerprint) only unions its call sites, so five rounds of the same
// idea stay one candidate.
export function mergeFollowups(candidates, consolidations, round) {
  for (const c of consolidations || []) {
    const fingerprint = followupFingerprint(c);
    const sites = (c.existingCallSites || []).filter(Boolean);
    const existing = candidates.find((e) => e.fingerprint === fingerprint);
    if (existing) {
      existing.existingCallSites = [...new Set([...existing.existingCallSites, ...sites])];
      continue;
    }
    candidates.push({
      fingerprint,
      round,
      title: c.title,
      detail: c.detail,
      targetLib: c.targetLib || '',
      rootCause: c.rootCause || slug(c.title),
      existingCallSites: [...new Set(sites)],
    });
  }
  return candidates;
}

const normPath = (p) => p.trim().replace(/^\.\//, '');

// `siteExists(path, line)` and `inDiff(path)` are injected so the selection
// stays pure; the CLI backs them with the work tree and the run's diff.
export function selectFollowups(candidates, { siteExists, inDiff }) {
  const qualified = [];
  const demoted = [];
  for (const c of candidates) {
    const valid = [];
    for (const site of c.existingCallSites) {
      const m = /^(.+?):(\d+)/.exec(site);
      if (!m) continue;
      const path = normPath(m[1]);
      if (inDiff(path) || !siteExists(path, Number(m[2]))) continue;
      valid.push(`${path}:${m[2]}`);
    }
    const sites = [...new Set(valid)];
    if (sites.length < FOLLOWUP_MIN_CALL_SITES) {
      demoted.push({
        fingerprint: c.fingerprint,
        title: c.title,
        reason: `${sites.length} verified call site(s) outside the diff — needs ${FOLLOWUP_MIN_CALL_SITES}`,
      });
      continue;
    }
    qualified.push({
      fingerprint: c.fingerprint,
      marker: `magnus:followup:${c.fingerprint}`,
      title: c.title,
      detail: c.detail,
      targetLib: c.targetLib,
      callSites: sites,
      round: c.round,
    });
  }
  // Strongest evidence gets the own-ticket slot; ties go to the earliest raise.
  qualified.sort((a, b) => b.callSites.length - a.callSites.length || a.round - b.round);
  return {
    cap: FOLLOWUP_TICKET_CAP,
    file: qualified.slice(0, FOLLOWUP_TICKET_CAP),
    batch: qualified.slice(FOLLOWUP_TICKET_CAP),
    demoted,
  };
}
