// Shared reviewer ENGINE for the feature-dev workflow scripts. Plugin-owned and
// host-agnostic: it holds the review machinery (lane composition, finding
// schemas, the ledger, the relevance validator, the closeout adjudicator, the
// scope-fidelity lane) and NO repo-specific knowledge.
//
// Everything repo-specific arrives as `repoConfig` — the host repo's
// docs/agents/repo-config.md `## Config` block, passed through the skill into
// the workflow args. Missing keys fall back to REPO_CONFIG_DEFAULTS, which is
// deliberately generic: a repo that supplies nothing still gets a working
// (blunter) review. See the plugin's CONTRACT.md.
//
// Workflow scripts must be self-contained — they cannot import this file — so
// shared/sync.sh copies it verbatim into each target between the
// `// >>> shared:reviewer-engine` / `// <<< shared:reviewer-engine` markers
// (`--check` fails on drift). Edit HERE, never in the generated blocks.
// Assumes the `shared:repo-config-defaults` block (REPO_CONFIG_DEFAULTS)
// appears ABOVE this block in every target — sync.sh maintains both.

// Runtime quirk: the Workflow runtime can deliver `args` as a JSON *string*.
function parseWorkflowArgs(raw) {
  let a = raw || {};
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      a = {};
    }
  }
  return a || {};
}

// Merge the host's repoConfig over the generic defaults, two levels deep so a
// host that sets only `reviewers.database` keeps the generic lens for the rest.
// Arrays and strings replace wholesale; empty values never win.
function resolveRepoConfig(rawConfig) {
  const cfg = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const out = { ...REPO_CONFIG_DEFAULTS };
  for (const [k, v] of Object.entries(cfg)) {
    if (v === null || v === undefined || v === '') continue;
    const base = REPO_CONFIG_DEFAULTS[k];
    if (!isPlain(base) || !isPlain(v)) {
      out[k] = v;
      continue;
    }
    out[k] = { ...base };
    for (const [ik, iv] of Object.entries(v)) {
      if (iv === null || iv === undefined || iv === '') continue;
      out[k][ik] =
        isPlain(base[ik]) && isPlain(iv) ? { ...base[ik], ...iv } : iv;
    }
  }
  return out;
}

function buildLibMap(cfg) {
  const map = (cfg && cfg.libMap) || REPO_CONFIG_DEFAULTS.libMap;
  return map && Object.keys(map).length
    ? Object.entries(map)
        .map(([lib, purpose]) => `- ${lib}: ${purpose}`)
        .join('\n')
    : '';
}

// Where a reuse search starts. Host repos name their own source roots; with
// none configured the reviewers search the whole tree.
function sourceRootsText(cfg) {
  const dirs = (cfg && cfg.sourceDirs) || REPO_CONFIG_DEFAULTS.sourceDirs;
  return dirs && dirs.length ? dirs.join(', ') : "the repo's source tree";
}

// The repo's written conventions file (CLAUDE.md, AGENTS.md, CONTRIBUTING.md …).
function conventionsFile(cfg) {
  return (
    (cfg && cfg.conventionsFile) ||
    REPO_CONFIG_DEFAULTS.conventionsFile ||
    'the repo conventions file'
  );
}

const KNOWN_AREAS = [
  'frontend',
  'backend',
  'database',
  'i18n',
  'security',
  'performance',
];

// Per-area reviewer definition = { skills, focus }. The host repo overrides any
// subset via `repoConfig.reviewers`; whatever it does not name keeps the
// generic lens from REPO_CONFIG_DEFAULTS, which names no framework, path, or
// repo skill.
function resolveReviewers(cfg) {
  const host = (cfg && cfg.reviewers) || {};
  const out = {};
  for (const area of KNOWN_AREAS) {
    const base = REPO_CONFIG_DEFAULTS.reviewers[area] || {};
    const over = host[area] || {};
    out[area] = {
      skills: over.skills || base.skills || '',
      focus: over.focus || base.focus || '',
    };
  }
  return out;
}

// Prompt line naming the repo skills a lane should consult. Empty when the host
// repo names none for that lane — the reviewer then works from its focus alone.
function skillsLine(def) {
  return def && def.skills
    ? `Apply the conventions from the ${def.skills} skill(s) — consult them via the Skill tool if available, otherwise apply their known rules.\n`
    : '';
}

// Every repo skill the host names across its reviewer lanes — the implementer's
// "consult these" list. Empty string when the host names none.
function repoSkillsText(cfg) {
  const rvw = resolveReviewers(cfg);
  const all = [
    ...new Set(
      Object.values(rvw)
        .flatMap((d) => (d.skills || '').split(', '))
        .filter(Boolean),
    ),
  ];
  return all.join(', ');
}

function baselineDef(cfg) {
  const conv = conventionsFile(cfg);
  return {
    skills: `${conv} conventions`,
    focus: `correctness bugs, missed acceptance criteria, convention/reuse misses, and test quality — NOT style nits. Comment hygiene IS in scope (${conv} comment rules, not a style nit): flag comments that restate the code, narrate the change, or compensate for an unclear name — the fix is deleting the comment or renaming so the code self-documents; a comment that survives states a non-obvious why in one line. Dead code and leftovers are in scope too: commented-out code, unused exports/params/variables, stray console.log/debug artifacts, and code orphaned by the change itself.`,
  };
}

// The reuse/consolidation reviewer — always its own agent, gated on the diff
// adding OR modifying files. Duplicate-of-existing-lib = BLOCKING; generalizable-new-code =
// `consolidations` (filed as follow-up tickets, never blocking). The provenance
// audit is a separate field so ad-hoc reviews (no provenance table) can omit it.
function reuseDef(cfg) {
  return {
    skills: `${conventionsFile(cfg)} conventions`,
    focus: `every function/component/hook/util/type ADDED by the diff — in new files OR added to modified files: search ${sourceRootsText(cfg)} and the design system for an existing equivalent BEFORE accepting it (use repoConfig.libMap as the search index when provided). An equivalent exists → BLOCKING finding: use it and delete the copy. New code that is genuinely generalizable → a \`consolidations\` entry naming the target lib — NOT a blocking finding. Also DRY within the change itself (added AND modified files): the same logic/markup/query shape repeated across the diff → BLOCKING when a small local helper/component would remove it, a \`consolidations\` entry when the extraction is big enough to be follow-up work. Only flag real duplication (same reason to change) — never force an abstraction over incidental similarity. Also YAGNI/speculative abstraction: options/params/config no call site passes, wrapper layers with a single caller, generality no current caller needs → BLOCKING when the fix is inlining/deleting the speculation; a note when debatable.`,
    provenanceFocus:
      "Also audit the implementer's provenance table: every added file must cite a real `mirroredFrom` exemplar (verify it exists and is actually mirrored) or an explicit `deviation` reason — a missing, false, or hand-wavy row is a BLOCKING finding.",
  };
}

// The CodeRabbit reviewer — wraps the CodeRabbit CLI (`coderabbit review
// --agent`) as one extra reviewer agent. It runs ONCE per workflow run, in the
// FIRST reviewer round only (rate-limited external service; one round of
// external signal is enough) — fix rounds re-run only our own lanes. The
// wrapper agent verifies CodeRabbit's findings against the actual code before
// reporting, so hallucinated or stale findings don't enter the fix loop.
function coderabbitPrompt(contractText, crCmd) {
  return `You are the CodeRabbit reviewer for this change — a READ-ONLY wrapper around the CodeRabbit CLI. You MUST NOT edit any files — only report.

${contractText}

Run the CodeRabbit CLI review via Bash (long-running — use a generous timeout, up to 10 minutes):
\`${crCmd}\`

Then translate its output into the structured report:
- VERIFY each CodeRabbit finding against the actual code (open the cited file/line) before reporting it — drop anything that does not hold up.
- blockingFindings: verified correctness bugs, security vulnerabilities, data-loss/race/resource-leak risks, or broken error handling. Each with title, file, line, detail, a concrete suggestedFix, and rootCause (a short stable slug of the underlying cause — reuse the exact slug when re-raising a prior finding).
- notes: style/naming/docs/nit-level suggestions worth a human glance — never blocking.
- If the CLI is missing, unauthenticated, rate-limited, or errors out: return an empty blockingFindings array plus a single note "CodeRabbit CLI unavailable: <reason>". Do NOT fall back to reviewing the code yourself — the other reviewer lanes cover that.
Set "area" to "coderabbit". Do not pad findings to look productive — empty arrays are the correct result for a clean run.`;
}

// area → path patterns (regex sources; object form `{re, flags}` carries flags).
// Overridable per run via `repoConfig.areaPaths`; the default comes straight
// from docs/agents/repo-config.md via the generated repo-config-defaults block.
const DEFAULT_AREA_PATHS = REPO_CONFIG_DEFAULTS.areaPaths;

function compileAreaPaths(map) {
  return Object.entries(map || {}).map(([area, patterns]) => [
    area,
    (patterns || []).map((p) =>
      typeof p === 'string' ? new RegExp(p) : new RegExp(p.re, p.flags || ''),
    ),
  ]);
}

// deterministic path → area mapping, unioned with agent-declared areas
function selectAreas(compiledAreaPaths, changedFiles, declaredAreas) {
  const set = new Set();
  for (const f of changedFiles || [])
    for (const [area, regexes] of compiledAreaPaths)
      if (regexes.some((r) => r.test(f))) set.add(area);
  for (const a of declaredAreas || []) if (KNOWN_AREAS.includes(a)) set.add(a);
  return [...set];
}

// Triggered areas group into two composite review LANES (at most baseline + 2
// reviewers per round); a lane's prompt merges its triggered members' skills + focus.
const AREA_LANES = {
  frontend: 'web',
  i18n: 'web',
  performance: 'web',
  backend: 'server',
  database: 'server',
  security: 'server',
};

// Defensive enrichment: frontend always pulls the performance lens, backend
// always pulls security (those two areas rarely trigger by path alone).
function groupAreasByLane(areas) {
  const set = new Set(areas);
  if (set.has('frontend')) set.add('performance');
  if (set.has('backend')) set.add('security');
  const lanes = {};
  for (const a of set) {
    const lane = AREA_LANES[a];
    if (!lane) continue;
    (lanes[lane] = lanes[lane] || []).push(a);
  }
  return Object.entries(lanes);
}

// Composite reviewer def for a lane's triggered member areas. `reviewers` is
// the resolved per-area map from resolveReviewers(cfg).
function laneDef(memberAreas, reviewers) {
  const rvw = reviewers || {};
  const def = (a) => rvw[a] || { skills: '', focus: '' };
  return {
    skills: [
      ...new Set(
        memberAreas.flatMap((a) => def(a).skills.split(', ')).filter(Boolean),
      ),
    ].join(', '),
    focus: memberAreas.map((a) => `\n- ${a}: ${def(a).focus}`).join(''),
  };
}

const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'number' },
    detail: { type: 'string' },
    suggestedFix: { type: 'string' },
    rootCause: {
      type: 'string',
      description:
        'Short slug naming the underlying cause (what is wrong, not where) — powers the cross-round finding identity, so keep it stable across re-raises.',
    },
  },
  required: ['title', 'detail', 'rootCause'],
};

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    blockingFindings: { type: 'array', items: FINDING },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Judgement-call / debatable points; never block.',
    },
    consolidations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: {
            type: 'string',
            description:
              'What is generalizable, and which existing call sites would adopt it.',
          },
          targetLib: {
            type: 'string',
            description:
              'The existing lib the code should be consolidated into.',
          },
        },
        required: ['title', 'detail'],
      },
      description:
        'Reuse reviewer only: generalizable-new-code that belongs in an existing lib as FOLLOW-UP work. Never blocking — the orchestrator files these as tickets, keeping the slice diff small.',
    },
  },
  required: ['area', 'blockingFindings', 'notes'],
};

// ── Review economics: ledger, validator, debt score, adjudicator, scope lane ──
// Inspired by kramme-cc-workflow (MIT) —
// https://github.com/Abildtoft/kramme-cc-workflow
//
// One ledger per workflow run. Every validated finding gets a stable `CR-NNN`
// id (monotonic, never recycled), a fingerprint (reviewer lane + file + root
// cause — never line numbers, lines shift across fix commits), and a lifecycle
// status: open | addressed | deferred | disputed | dropped. `addressed`
// records the fix commit hash; disputed/deferred fingerprints auto-suppress
// re-raises; dropped repeats stay visible and are re-validated.

const LEDGER_WEIGHTS = { blocking: 4, suggestion: 1, advisory: 0.25 };
// Two consecutive reviewer rounds without material progress → stop (stalled).
const LEDGER_STALL_LIMIT = 2;
// A fingerprint that survives this many fix attempts is deferred, not re-targeted.
const LEDGER_DEFER_ATTEMPTS = 2;
// Hard round cap — a safety boundary, not a target; the debt-score stop
// conditions are expected to end the loop first.
const LEDGER_HARD_CAP = 5;

function createLedger() {
  return { entries: [], nextId: 1 };
}

function findingFingerprint(area, f) {
  const cause = String(f.rootCause || f.title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${area}|${f.file || '?'}|${cause}`;
}

// Auto-suppression: a re-raised finding whose fingerprint matches a disputed or
// deferred entry never re-enters the round and never scores.
function ledgerSuppress(ledger, findings) {
  const kept = [];
  const suppressed = [];
  for (const f of findings) {
    const fp = findingFingerprint(f.area, f);
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
// { finding (carrying .area and a round-local .id), cls, confidence,
// diffCaused } from classifyFindings. Returns the open blocking entries this
// round should fix.
function ledgerIngest(ledger, round, validated) {
  for (const v of validated) {
    const f = v.finding;
    const fp = findingFingerprint(f.area, f);
    const existing = ledger.entries.find((e) => e.fingerprint === fp);
    if (!existing) {
      ledger.entries.push({
        id: `CR-${String(ledger.nextId++).padStart(3, '0')}`,
        fingerprint: fp,
        area: f.area,
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

function ledgerOpenBlocking(ledger) {
  return ledger.entries.filter(
    (e) => e.status === 'open' && e.severity === 'blocking',
  );
}

function ledgerScore(ledger) {
  let s = 0;
  for (const e of ledger.entries)
    if (e.status === 'open') s += LEDGER_WEIGHTS[e.severity] ?? 1;
  return s;
}

// Material progress: the debt score dropped ≥1, an open blocking finding died,
// or a previously-failing gate (tests/commit) cleared. Measured after each
// reviewer round's ingest; anything else is a stalled round.
function ledgerProgress(prev, ledger, gateCleared) {
  const score = ledgerScore(ledger);
  const openIds = new Set(ledgerOpenBlocking(ledger).map((e) => e.id));
  const progressed =
    !prev ||
    gateCleared ||
    prev.score - score >= 1 ||
    [...prev.openIds].some((id) => !openIds.has(id));
  return { progressed, snapshot: { score, openIds } };
}

// Verdict language used everywhere the loop result is reported (workflow
// return, PR comment, magnus:babysit-stack input): `converged`, or an explicit
// stalled verdict naming what shipped unresolved — never a silently
// exhausted cap.
function ledgerVerdict(ledger, converged) {
  if (converged) return 'converged';
  const open = ledgerOpenBlocking(ledger);
  return open.length
    ? `stalled — shipped with ${open.length} open finding(s) (${open
        .map((e) => e.id)
        .join(', ')})`
    : 'stalled — no open findings, but the loop could not verify convergence';
}

// Feedback/finding view of a ledger entry — feeds fmtFeedback and `outstanding`.
function ledgerEntryFinding(e) {
  return {
    id: e.id,
    area: e.area,
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
function ledgerApplyFix(targets, fix) {
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
function ledgerHistoryText(ledger) {
  if (!ledger.entries.length) return '';
  const lines = ledger.entries
    .map((e) => `- ${e.id} [${e.status}] (${e.area}) ${e.title}`)
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
function ledgerReport(ledger) {
  const fmt = (e) =>
    `- ${e.id} [${e.status}] (${e.area}) ${e.title}${e.file ? ` — ${e.file}` : ''}${
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
function fmtFeedback(blocking) {
  return blocking
    .map(
      (f, i) =>
        `${i + 1}. ${f.id ? `[id: ${f.id}] ` : ''}[${f.area}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}\n   ${f.detail}${f.suggestedFix ? `\n   Suggested fix: ${f.suggestedFix}` : ''}`,
    )
    .join('\n');
}

// ── Relevance + confidence validator (post-aggregation, pre-fix) ─────────────
// One Sonnet agent per round classifies the raw findings before any fix pass:
// (a) caused by this diff or pre-existing/out-of-scope, (b) confidence 0–100
// that the finding is real and correctly located. It classifies — it may NOT
// add findings of its own.

const VALIDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'The [id] tag of the finding being classified — echo it verbatim.',
          },
          diffCaused: {
            type: 'boolean',
            description:
              'True when the problem is introduced by this diff; false when it is pre-existing or out of scope.',
          },
          confidence: {
            type: 'number',
            description:
              '0–100 confidence the finding is real AND correctly located, after checking the actual code. 90–100 only when traced or reproduced; below 60 means unverified.',
          },
          note: { type: 'string' },
        },
        required: ['id', 'diffCaused', 'confidence'],
      },
    },
  },
  required: ['verdicts'],
};

function validatorPrompt(contractText, findingsText, diffCmd) {
  return `You are the relevance/confidence validator for one review round. You CLASSIFY the findings below — you may NOT add findings of your own, and you MUST NOT edit any files.

${contractText}

The diff under review: \`${diffCmd}\`. Open the cited files and check every finding against the actual code before classifying it.

Findings to classify:
${findingsText}

Return one verdict per finding: its [id] echoed verbatim, diffCaused (introduced by this diff vs pre-existing/out-of-scope — a real problem the diff merely sits next to is NOT diff-caused), and confidence 0–100 that the finding is real and correctly located (90–100 only when you traced or reproduced it; below 60 means unverified). Classify every finding — no verdict means the finding passes through unfiltered.`;
}

// Thresholds: confidence ≥80 AND diff-caused → eligible for the fix pass.
// Confidence 60–79, or ≥80 but pre-existing → advisory (a PR note or a
// consolidations follow-up — never fixed in-slice). Below 60 → dropped as
// UNVERIFIED (recorded in the ledger so a repeat is visible). A missing
// verdict (validator died or skipped one) fails open: the finding stays
// eligible rather than silently dying.
function classifyFindings(findings, verdicts) {
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

// ── Independent closeout adjudicator ─────────────────────────────────────────
// When the loop ends with disputed entries, ONE fresh Opus agent rules each of
// them on evidence only: the final diff, the reviewer's original evidence, and
// the implementer's dispute evidence — never the fix agent's free-text
// justifications. Upheld findings reopen as `open` (reported in the stalled
// verdict); adjudicator/reviewer deadlock is never re-looped — it is reported
// on the PR for the human.

const ADJUDICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          ruling: { type: 'string', enum: ['upheld', 'dismissed'] },
          reason: { type: 'string' },
        },
        required: ['id', 'ruling', 'reason'],
      },
    },
  },
  required: ['rulings'],
};

function adjudicatorPrompt(contractText, disputedEntries, diffCmd) {
  const rows = disputedEntries
    .map(
      (e) =>
        `- [id: ${e.id}] (${e.area}) ${e.title}${e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : ''}
  Reviewer's evidence: ${e.detail}
  Implementer's dispute evidence: ${e.disputeEvidence || '(none recorded)'}`,
    )
    .join('\n');
  return `You are the INDEPENDENT closeout adjudicator for a review loop that ended with disputed findings. You are fresh — judge on evidence only, not on rhetoric. You MUST NOT edit any files.

${contractText}

Final diff: \`${diffCmd}\` — read it, plus the cited files, and check BOTH sides' evidence against the actual code.

Disputed findings:
${rows}

Rule EACH finding:
- "upheld": the reviewer's evidence holds — the problem is real and unresolved.
- "dismissed": the implementer's dispute evidence holds — the finding is factually wrong.
When the evidence is genuinely inconclusive, rule "upheld": a wrong dismissal silently removes a real finding, a wrong uphold costs one human glance.`;
}

function applyAdjudication(ledger, rulings) {
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

// ── Scope-fidelity lane ──────────────────────────────────────────────────────
// Optional reviewer lane, gated on the diff adding new files or >~150 inserted
// lines. Two passes inside one agent: a loose finder (full recall, no
// threshold) lists everything not traceable to the ticket's acceptance
// criteria, then a strict justifier keeps a finding only by citing a specific
// AC, a documented repo rule, or a concrete failure path the extra code
// prevents. Necessity comes from the frozen AC as written — never inferred
// from the diff. Output feeds the normal ledger and validator gate.

const SCOPE_LANE_INSERTION_GATE = 150;

function scopeLaneGate(addedFiles, diffStat) {
  if ((addedFiles || []).length > 0) return true;
  const m = /(\d+) insertions?/.exec(diffStat || '');
  return Boolean(m && Number(m[1]) > SCOPE_LANE_INSERTION_GATE);
}

function scopeFidelityPrompt(contractText, diffCmd, cfg) {
  const conv = conventionsFile(cfg);
  return `You are the INDEPENDENT, READ-ONLY scope-fidelity reviewer for this change. You MUST NOT edit any files — only report.

${contractText}

Inspect the diff with \`${diffCmd}\` (and read surrounding files as needed). Work in two passes:

Pass 1 — loose finder (full recall, no threshold): list EVERYTHING in the diff that is not directly traceable to the acceptance criteria above — extra options/params/config, wrapper layers, generalisation beyond current callers, speculative branches, unasked-for behaviour, added surface area.
Pass 2 — strict justifier: keep an item ONLY when you can cite (a) a specific acceptance criterion it serves, (b) a documented repo rule (${conv} or a repo skill) that requires it, or (c) a concrete failure path the extra code prevents. Justified items are dropped. "Peer code does it too" alone is NOT a justification — such items become notes (judgement calls), never blockingFindings. Necessity comes from the acceptance criteria as written — never infer it from the diff itself.

Report ONLY:
- blockingFindings: additions that survived pass 2 with NO citable justification. Each with title, file, line, detail (why no AC / repo rule / failure path covers it), a concrete suggestedFix (usually delete or inline), and rootCause.
- notes: judgement-call items (including "peer code does it too" cases).
Set "area" to "scope". Do not invent problems to look productive — an empty blockingFindings array is the correct result for a tight diff.`;
}
