export const meta = {
  name: 'solve-ready-loop',
  description:
    'Solve one agent:ready ticket, depth-scaled by a triage step: triage → implement (Opus) → review (scaled) → at most one fix round. Lighter than work-slice-loop (no slice/stack framing, cap 1, no human gate). Returns a summary for the draft PR.',
  phases: [
    {
      title: 'Triage',
      detail:
        'one Sonnet agent sizes the ticket → trivial | standard | escalate',
      model: 'sonnet',
    },
    {
      title: 'Implement',
      detail: 'Opus agent; TDD for standard, lighter for trivial',
      model: 'opus',
    },
    {
      title: 'Review',
      detail:
        'trivial: baseline only · standard: diff-matched web/server lanes (+ Opus Playwright if user-facing) · reuse reviewer whenever files were added or modified',
      model: 'sonnet',
    },
    {
      title: 'Fix',
      detail: 'Opus resolves blocking findings — at most ONE round',
      model: 'opus',
    },
  ],
};

// ── args (passed by the skill) ──────────────────────────────────────────────
// { issueId, title, acceptanceCriteria, baseBranch, worktree, repoConfig }
// Normalised via the shared parseWorkflowArgs (hoisted from the registry block
// below) so A.issueId etc. resolve even when args arrive as a JSON string.
const A = parseWorkflowArgs(args);
// >>> shared:repo-config-defaults — generated from the plugin's shared/repo-config-defaults.js; edit there and run shared/sync.sh
// Generic, host-agnostic fallbacks for every `repoConfig` key. A host repo
// overrides any subset from its docs/agents/repo-config.md `## Config` block;
// resolveRepoConfig() in shared/reviewer-engine.js merges the two, two levels
// deep. Nothing here may name a framework, path, package, or skill that only
// one repo has — that is what the host file is for. See CONTRACT.md.
//
// Empty string / empty object means "not knowable generically": the skill or
// workflow degrades gracefully and says so rather than guessing.
const REPO_CONFIG_DEFAULTS = {
  // '' → resolve at runtime from the repo's default branch
  // (`git symbolic-ref --short refs/remotes/origin/HEAD`).
  integrationBranch: '',
  // Roots a reuse search starts from. [] → search the whole tree.
  sourceDirs: [],
  conventionsFile: 'CLAUDE.md',
  // Commands that prove the repo's definition of done. '' → the skill discovers
  // them (package.json scripts, CI config) and says which it used.
  gates: {
    all: '',
    format: '',
    test: '',
    traps: [],
  },
  // Issue tracker. kind: 'linear' | 'github' | ''. '' → GitHub Issues via `gh`.
  tracker: {
    kind: '',
    team: '',
    teamId: '',
    issuePrefix: '',
    docPath: 'docs/agents/issue-tracker.md',
    statuses: { readyForDev: '', inProgress: '', inReview: '', done: '' },
  },
  // Managed label names. '' → the skill skips that piece of machinery.
  labels: {
    docPath: 'docs/agents/triage-labels.md',
    agentReady: '',
    needsHuman: '',
    sliceNext: '',
    managerSkip: '',
    typePrefix: 'type:',
    riskPrefix: 'risk:',
  },
  pr: {
    titleRule: '',
    scopes: [],
    stackTool: '',
    botReviewer: '',
    cliReviewer: '',
  },
  // Repo-owned skills the suite hands off to. '' → no handoff; do it inline.
  skills: {
    createIssue: '',
    createPr: '',
    startWork: '',
    migrations: '',
    i18n: '',
    e2e: '',
    prototype: '',
  },
  // Browser verification. '' → the Playwright reviewer is skipped and says so.
  devServerCommand: '',
  e2eDir: '',
  browserGuidePath: '',
  // area → path patterns (regex sources; object form `{re, flags}` carries
  // flags). Language-generic on purpose — a host repo replaces these wholesale.
  areaPaths: {
    frontend: ['\\.(tsx|jsx|vue|svelte)$', '(^|/)(components?|ui|views?)/'],
    backend: ['(^|/)(server|api|backend|services?)/'],
    database: [
      '(^|/)(migrations?|schemas?)/',
      '\\.sql$',
      '(^|/)(prisma|drizzle)/',
    ],
    i18n: [
      '(^|/)(i18n|intl|locales?|translations?)/',
      '(^|/)messages\\.(ts|js|json)$',
    ],
    security: [{ re: 'auth', flags: 'i' }, '\\.env'],
  },
  // layer → canonical exemplar file. {} → implementers discover exemplars.
  goldenPaths: {},
  // lib path → one-line purpose; the reuse reviewer's search index.
  // {} → the reuse reviewer searches sourceDirs blind (slower, still strict).
  libMap: {},
  // Per-area reviewer lens. Generic by design: no framework, path or skill
  // names. A host repo sharpens any subset via `repoConfig.reviewers`.
  reviewers: {
    frontend: {
      skills: '',
      focus:
        'component structure and composition, design-system token/component reuse (no magic numbers, no ad-hoc styles where a token exists), loading/empty/error states for every async path, and accessibility (semantics, labels, focus order, keyboard operability).',
    },
    backend: {
      skills: '',
      focus:
        'layering and module boundaries, request/handler validation, authorization at the entry point, cache invalidation, and error handling that matches the repo idiom. Plus server performance: N+1 query patterns, sequential awaits where a parallel fetch fits, over-fetching, query volume on hot paths.',
    },
    database: {
      skills: '',
      focus:
        'schema and relation correctness, migrations generated and sequenced by the repo tool (never hand-renumbered), reversibility/backfill safety, and query patterns that match the repo idiom. Plus query performance: indexes matching new query patterns, join/subquery cost on large tables.',
    },
    i18n: {
      skills: '',
      focus:
        'every user-facing string goes through the translation layer (no hardcoded copy), every key resolves in the source catalogue, and placeholder/plural/select syntax is valid.',
    },
    security: {
      skills: '',
      focus:
        'authorization on every mutating entry point, secret/env handling, input validation, injection, file-upload safety, and no secret leakage into client bundles.',
    },
    // client-side lens only — server performance lives in backend/database above
    performance: {
      skills: '',
      focus:
        'data-fetching waterfalls, work done on the client that belongs on the server, memoization, bundle size and dynamic imports, render cost on hot paths.',
    },
  },
};
// <<< shared:repo-config-defaults
const CFG = resolveRepoConfig(A.repoConfig); // host docs/agents/repo-config.md
// over the plugin's generic defaults — every key below is always present.
const RVW = resolveReviewers(CFG);
const BASELINE = baselineDef(CFG);
const REUSE = reuseDef(CFG);
const CONV = conventionsFile(CFG);
const SRC_ROOTS = sourceRootsText(CFG);
const REPO_SKILLS = repoSkillsText(CFG);
// How an implementer proves the change is green; '' → it discovers the commands.
const GATE_TEXT = CFG.gates.all
  ? `\`${CFG.gates.all}\``
  : "the repo's own lint/test/build commands";

const ISSUE = A.issueId || '(unknown issue)';
const TITLE = A.title ? String(A.title) : '';
const BASE =
  A.baseBranch || CFG.integrationBranch || 'origin/HEAD';
const WORKTREE = A.worktree ? String(A.worktree) : '';
const AC = Array.isArray(A.acceptanceCriteria)
  ? A.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
  : String(A.acceptanceCriteria || '(see ticket — derive from description)');
const DEV_SERVER = CFG.devServerCommand;
const E2E_DIR = CFG.e2eDir;
const BROWSER_GUIDE = CFG.browserGuidePath;
const LIB_MAP = buildLibMap(CFG);

// >>> shared:reviewer-engine — generated from the plugin's shared/reviewer-engine.js; edit there and run shared/sync.sh
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
- blockingFindings: verified correctness bugs, security vulnerabilities, data-loss/race/resource-leak risks, or broken error handling. Each with title, file, line, detail, and a concrete suggestedFix.
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
  required: ['title', 'detail'],
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
// <<< shared:reviewer-engine

const AREA_COMPILED = compileAreaPaths(CFG.areaPaths);

// ── schemas (loop-specific; shared ones live in the registry block) ──────────
const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tier: {
      type: 'string',
      enum: ['trivial', 'standard', 'escalate'],
      description:
        'trivial = copy/constant/dep-bump/lint/single-file mechanical, no real logic. standard = small bounded feature/bugfix with real logic in one or few areas. escalate = bigger / multi-area / ambiguous / migration- or auth-touching than an agent:ready ticket should be — kick back to a human.',
    },
    reason: {
      type: 'string',
      description: 'One or two sentences justifying the tier.',
    },
    whereToLook: {
      type: 'string',
      description:
        'Discovered code-layer pointers — files/dirs/sibling to mirror.',
    },
    touchedAreas: {
      type: 'array',
      items: { type: 'string', enum: KNOWN_AREAS },
      description: 'Best guess at the semantic areas this will touch.',
    },
    userFacing: {
      type: 'boolean',
      description:
        'Will this plausibly change user-visible behaviour? Bias true when unsure.',
    },
  },
  required: ['tier', 'reason', 'touchedAreas', 'userFacing'],
};

// ── prompt builders ──────────────────────────────────────────────────────────
const CONTRACT = `Ticket: ${ISSUE}${TITLE ? ` — ${TITLE}` : ''}
Base branch: ${BASE}${
  WORKTREE
    ? `
Working directory: ${WORKTREE} — \`cd\` into this git worktree before ANY file read/edit, test, build, or git command. All implementation, tests, commits, and diffs happen HERE on the current branch, NEVER in the main checkout. Run \`git diff ${BASE}...HEAD\` from inside the worktree.`
    : ''
}

Acceptance criteria:
${AC}`;

function triagePrompt() {
  return `You are sizing one ticket that was already labelled \`agent:ready\` (a triage step judged it low-risk and single-PR). Your job is to pick the EFFORT TIER for solving it, and to bail if the label looks wrong.

${CONTRACT}

Do a QUICK read-only scan of the repo to ground your call (grep/glob/read a few files near the change — do NOT implement anything). Then classify:

- "trivial": copy/text/constant change, dependency bump, lint/format fix, a single-file mechanical edit, or a small isolated test — no real branching logic, one area at most.
- "standard": a small bounded feature or bug fix with real logic, in one or a few areas. Still single-PR.
- "escalate": on inspection this is BIGGER or riskier than an agent:ready ticket should be — multiple unrelated areas, ambiguous/underspecified acceptance criteria, a DB migration with schema change, auth/billing/security/clinical-data surface, or anything needing product/architecture judgement. Choose this to kick the ticket back to a human rather than ship a bad PR.

Return: tier, reason (1–2 sentences), whereToLook (concrete files/dirs/sibling to mirror), touchedAreas (best guess), userFacing (bias true when unsure). When torn between two tiers, pick the heavier one.`;
}

function implPrompt(tier, where) {
  const tdd =
    tier === 'trivial'
      ? '- This is a trivial change. Keep it minimal. Add or adjust a test only where a `jest.config` already exists for the touched lib; do not scaffold new test infrastructure.'
      : '- Work TEST-FIRST: one tracer-bullet test → impl per acceptance criterion (vertical slice — never all-tests-then-all-impl).';
  return `You are the Opus implementer for one agent:ready ticket. Implement EXACTLY what the acceptance criteria require — no more, no less (scope creep becomes a review/compliance problem later).

${CONTRACT}

Where to look (starting map — mirror the named sibling): ${where || '(discover from the codebase)'}

Rules:
${tdd}
- Follow ${CONV}${REPO_SKILLS ? ` and the relevant repo skills (${REPO_SKILLS})` : ' and the relevant repo skills'}. Mirroring the named sibling is BINDING — a deviation is allowed only when declared in the provenance table with a concrete reason, never silently.
- NO new helper/util/hook/component without first searching ${SRC_ROOTS} (and the design system) for an existing equivalent. Found one → use it.${LIB_MAP ? `\n  Existing libs (search index):\n${LIB_MAP}` : ''}
- For UI, reuse design-system tokens/components — no magic numbers.
- Run the affected tests + lint/typecheck with ${GATE_TEXT} before finishing and make them PASS. Set testsGreen=true ONLY if you ran them in THIS session and saw them pass — never assume or claim green without running. Report the exact commands + final summary lines in testEvidence.
- Commit on the current branch with a message starting with the ticket id (${ISSUE}).

Return the structured result: summary, committed, changedFiles (\`git diff --name-only ${BASE}...HEAD\`), addedFiles (\`git diff --name-only --diff-filter=A ${BASE}...HEAD\`), provenance (one row per added file: mirroredFrom = the exemplar you actually followed, or deviation = why none fits — never both blank), touchedAreas (declare security/performance explicitly when relevant), userFacingImpact (bias true), testsGreen, testEvidence (commands + summary lines), diffStat (\`git diff --stat ${BASE}...HEAD\`), notes.`;
}

function fixPrompt(feedback) {
  return `You are the Opus implementer. A review round found BLOCKING problems. Resolve every one of them TEST-FIRST (RED→GREEN where behaviour changes). Do not address style nits or out-of-scope items, and do not pull in new scope.

If a finding is FACTUALLY WRONG, do not code around it — return it in \`disputed\` with concrete evidence (file:line, test output, spec text). Dispute only what you can prove; when torn, fix. Everything not disputed must be resolved. Disputed findings surface to the human on the draft PR.

${CONTRACT}

Blocking findings to resolve:
${feedback}

Rules: stay in scope; sibling-mirroring stays BINDING (declare any deviation in provenance, never silently); no new helper without a ${SRC_ROOTS} search; run affected tests + lint/typecheck with ${GATE_TEXT} and make them PASS (testsGreen=true only if you ran them THIS session and saw them pass — report commands + summary lines in testEvidence); commit with a message starting with ${ISSUE}.
Return the structured result (same shape as before) — recompute changedFiles/addedFiles/provenance/touchedAreas/userFacingImpact/diffStat vs ${BASE} (whole change, not just this fix).`;
}

function reviewerPrompt(area, def) {
  return `You are an INDEPENDENT, READ-ONLY reviewer for the "${area}" area of one agent:ready ticket. You MUST NOT edit any files — only report.

${CONTRACT}

Inspect the diff with \`git diff ${BASE}...HEAD\` (and read surrounding files as needed).
${skillsLine(def)}Focus on: ${def.focus}

Report ONLY:
- blockingFindings: correctness bugs, missed acceptance criteria, or convention/reuse violations in YOUR area. Each with title, file, line, detail, and a concrete suggestedFix. If none, return an empty array.
- notes: judgement-call / debatable points that should NOT block.
Set "area" to "${area}". Do not invent problems to look productive — an empty blockingFindings array is the correct result for clean code.`;
}

function reusePrompt(addedFiles, changedFiles, provenance) {
  const modified = changedFiles.filter((f) => !addedFiles.includes(f));
  const provRows = (provenance || [])
    .map(
      (p) =>
        `- ${p.file} → ${p.mirroredFrom ? `mirrors ${p.mirroredFrom}` : `[deviation: ${p.deviation || 'MISSING'}]`}`,
    )
    .join('\n');
  return `You are the INDEPENDENT, READ-ONLY reuse/consolidation reviewer for one agent:ready ticket. You MUST NOT edit any files — only report.

${CONTRACT}

Files ADDED by this change (inspect them via \`git diff ${BASE}...HEAD\`):
${addedFiles.length ? addedFiles.map((f) => `- ${f}`).join('\n') : '(none)'}

Files MODIFIED by this change (in scope for intra-diff DRY + YAGNI):
${modified.length ? modified.map((f) => `- ${f}`).join('\n') : '(none)'}

Provenance the implementer attested (VERIFY it — open each cited exemplar and check the file actually mirrors it):
${provRows || (addedFiles.length ? '(none attested — every added file above is missing a provenance row: that is a blocking finding per file)' : '(no added files — nothing to audit)')}
${LIB_MAP ? `\nExisting libs (search index for equivalents):\n${LIB_MAP}` : ''}

Focus on: ${REUSE.focus}

Report ONLY:
- blockingFindings: (a) an added function/component/hook/util/type that duplicates an existing lib/design-system equivalent — name the equivalent, the fix is "use it, delete the copy"; (b) the same logic repeated within the diff where a small local helper would remove it; (c) a provenance row that is missing, cites a non-existent exemplar, or claims a mirror the code visibly doesn't follow. Each with title, file, line, detail, concrete suggestedFix.
- consolidations: genuinely generalizable NEW code that belongs in an existing lib as follow-up work — title, detail (what + which call sites would adopt it), targetLib. NEVER put these in blockingFindings; they surface as notes for the human, not in-PR scope.
- notes: judgement-call points that should not block.
Set "area" to "reuse". Do not invent problems to look productive — empty arrays are the correct result for clean code.`;
}

function playwrightPrompt() {
  return `You are the READ-ONLY Playwright user-story reviewer for one ready-to-solve ticket. Verify the user-facing behaviour in a real browser. You MUST NOT edit application code.

${CONTRACT}

First READ \`${BROWSER_GUIDE}\` in the repo for login steps, seeded users, routes, the core SOAP flow, selectors, and the microphone fake-media flags. Then:
1. Start the app in the background and capture its URL: \`${DEV_SERVER}\` (wait until it serves).
2. Author a throwaway Playwright spec (reuse the \`${E2E_DIR}\` config + the \`login.spec.ts\` dev-login pattern) driving ISOLATED HEADLESS Chromium with \`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream\`, \`video: 'on'\`, baseURL = the running app.
3. Dev-login as the seeded user matching the ticket, then exercise EACH acceptance-criterion user story. Capture a screenshot for EVERY criterion — PASS and FAIL alike — under the gitignored test-output dir, named \`ac-<n>-<pass|fail>.png\`. These are QA evidence: they get uploaded to the ticket after the run, so each screenshot must actually show the behaviour it proves (or the breakage), plus keep the run video.
4. CLEAN UP before returning: delete the throwaway spec file you authored (and any other source files you created under ${SRC_ROOTS} or the repo root). It relies on hand-seeded DB rows and is NOT a maintainable test — it must NOT be committed or left untracked, or the pre-push lint hook fails on it. Keep ONLY the screenshots/video under the gitignored test-output dir for proofPaths. Then run \`git -C <worktree> status --porcelain\` and confirm it lists ONLY the implementer's committed change set — no untracked *.spec.ts or other new source files. Remove any of your artifacts that remain.
5. Return: criteria (criterion + pass + screenshot path), blockingFindings (one per broken user story — a failed criterion is BLOCKING, include the screenshot), proofPaths (screenshots + video), notes (e.g. console errors). "Couldn't verify" counts as a failed criterion, not a pass. Set "area" to "playwright".`;
}

// ── run ───────────────────────────────────────────────────────────────────────
phase('Triage');
log(`Triaging ${ISSUE}`);
const triage = await agent(triagePrompt(), {
  label: `triage:${ISSUE}`,
  phase: 'Triage',
  model: 'sonnet',
  schema: TRIAGE_SCHEMA,
});

if (!triage) {
  return {
    issueId: ISSUE,
    escalate: true,
    tier: 'escalate',
    reason: 'triage agent failed',
    shipped: false,
  };
}

if (triage.tier === 'escalate') {
  log(`${ISSUE}: triage → escalate. ${triage.reason}`);
  return {
    issueId: ISSUE,
    escalate: true,
    tier: 'escalate',
    reason: triage.reason,
    shipped: false,
  };
}

const TIER = triage.tier; // 'trivial' | 'standard'

phase('Implement');
log(`Implementing ${ISSUE} (tier: ${TIER})`);
const impl = await agent(implPrompt(TIER, triage.whereToLook), {
  label: `impl:${ISSUE}`,
  phase: 'Implement',
  model: 'opus',
  schema: IMPL_SCHEMA,
});

if (!impl) {
  return {
    issueId: ISSUE,
    escalate: false,
    tier: TIER,
    reason: 'implementation agent failed',
    shipped: false,
  };
}

let changedFiles = impl.changedFiles || [];
let addedFiles = impl.addedFiles || [];
let provenance = impl.provenance || [];
const userFacing =
  impl.userFacingImpact !== false || triage.userFacing === true;
const declaredAreas = [
  ...new Set([...(impl.touchedAreas || []), ...(triage.touchedAreas || [])]),
];
let diffStat = impl.diffStat || '';
const carriedNotes = [...(impl.notes || [])];
const consolidations = []; // reuse reviewer's follow-up candidates for the human
const playwrightProof = [];

// ── Tests gate: reviewers never see red code ─────────────────────────────────
// One dedicated tests-fix pass; if still red after it, skip review entirely and
// hand back to the human — the orchestrator surfaces testsGreen=false on the PR.
let testsGreen = impl.testsGreen !== false;
if (!testsGreen) {
  phase('Fix');
  log(
    `${ISSUE}: tests not green after implementation — tests-fix pass before review.`,
  );
  const tf = await agent(
    fixPrompt(
      `1. [${TESTS_GATE_FINDING.area}] ${TESTS_GATE_FINDING.title}\n   ${TESTS_GATE_FINDING.detail}`,
    ),
    {
      label: `tests-fix:${ISSUE}`,
      phase: 'Fix',
      model: 'opus',
      schema: IMPL_SCHEMA,
    },
  );
  if (tf) {
    changedFiles = tf.changedFiles || changedFiles;
    addedFiles = tf.addedFiles || addedFiles;
    provenance = tf.provenance || provenance;
    diffStat = tf.diffStat || diffStat;
    testsGreen = tf.testsGreen !== false;
    if (tf.notes) carriedNotes.push(...tf.notes);
  }
  if (!testsGreen) {
    carriedNotes.push(
      '[tests] Still red after a dedicated tests-fix pass — review skipped, shipped=false for human triage.',
    );
    return {
      issueId: ISSUE,
      escalate: false,
      tier: TIER,
      triageReason: triage.reason,
      summary: impl.summary,
      shipped: false,
      testsGreen: false,
      diffStat,
      reviewersRun: [],
      blockingFound: 0,
      fixedCount: 0,
      notes: [...new Set(carriedNotes)],
      provenance,
      consolidations: [],
      playwrightProof,
      playwrightCriteria: [],
    };
  }
}

// ── Review (scaled by tier) ──────────────────────────────────────────────────
// trivial → baseline reviewer only, no Playwright.
// standard → baseline + diff-matched area reviewers (+ Playwright if user-facing).
phase('Review');
const areas =
  TIER === 'trivial'
    ? []
    : selectAreas(AREA_COMPILED, changedFiles, declaredAreas);
const laneEntries = TIER === 'trivial' ? [] : groupAreasByLane(areas);
const runPlaywright = TIER === 'standard' && userFacing;
const runReuse = changedFiles.length + addedFiles.length > 0; // both tiers — added or modified files earn the reuse check
const reviewersRun = [
  'baseline',
  ...laneEntries.map(([lane, members]) => `${lane}[${members.join('+')}]`),
  ...(runReuse ? ['reuse'] : []),
  'coderabbit',
  ...(runPlaywright ? ['playwright'] : []),
];
log(`${ISSUE}: reviewers = ${reviewersRun.join(', ')}`);

const thunks = [
  () =>
    agent(reviewerPrompt('baseline', BASELINE), {
      label: 'review:baseline',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
];
for (const [lane, members] of laneEntries) {
  thunks.push(() =>
    agent(reviewerPrompt(lane, laneDef(members, RVW)), {
      label: `review:${lane}`,
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
  );
}
if (runReuse) {
  thunks.push(() =>
    agent(reusePrompt(addedFiles, changedFiles, provenance), {
      label: 'review:reuse',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
  );
}
// CodeRabbit CLI wrapper — this loop has a single review round, so this IS the
// first-round-only slot; the one fix round below never re-runs it.
thunks.push(() =>
  agent(
    coderabbitPrompt(
      CONTRACT,
      `coderabbit review --agent --committed --base-commit "$(git merge-base ${BASE} HEAD)" -c ${CONV}`,
    ),
    {
      label: 'review:coderabbit',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    },
  ),
);
if (runPlaywright) {
  thunks.push(() =>
    agent(playwrightPrompt(), {
      label: 'review:playwright',
      phase: 'Review',
      model: 'opus',
      schema: PLAYWRIGHT_SCHEMA,
    }),
  );
}

const reviews = (await parallel(thunks)).filter(Boolean);
let playwrightCriteria = [];
for (const r of reviews) {
  if (r.proofPaths) playwrightProof.push(...r.proofPaths);
  if (r.criteria) playwrightCriteria = r.criteria; // per-AC verdicts from the Playwright reviewer = QA evidence
  if (r.notes) carriedNotes.push(...r.notes.map((n) => `[${r.area}] ${n}`));
  if (r.consolidations) consolidations.push(...r.consolidations);
}
const blocking = reviews.flatMap((r) =>
  (r.blockingFindings || []).map((f) => ({ ...f, area: r.area })),
);

// ── Fix (at most ONE round — the cap-1 the loop is built around) ─────────────
let fixedCount = 0;
if (blocking.length > 0) {
  const feedback = blocking
    .map(
      (f, i) =>
        `${i + 1}. [${f.area}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}\n   ${f.detail}${f.suggestedFix ? `\n   Suggested fix: ${f.suggestedFix}` : ''}`,
    )
    .join('\n');

  phase('Fix');
  log(
    `${ISSUE}: ${blocking.length} blocking finding(s) — single Opus fix round.`,
  );
  const fix = await agent(fixPrompt(feedback), {
    label: `fix:${ISSUE}`,
    phase: 'Fix',
    model: 'opus',
    schema: IMPL_SCHEMA,
  });
  if (fix) {
    const disputed = fix.disputed || [];
    fixedCount = blocking.length - disputed.length;
    for (const d of disputed) {
      carriedNotes.push(
        `[disputed:${d.area || '?'}] ${d.title} — ${d.evidence}`,
      );
    }
    changedFiles = fix.changedFiles || changedFiles;
    addedFiles = fix.addedFiles || addedFiles;
    provenance = fix.provenance || provenance;
    diffStat = fix.diffStat || diffStat;
    testsGreen = fix.testsGreen !== false;
    if (fix.notes) carriedNotes.push(...fix.notes);
  } else {
    // Fix agent died — carry the findings out as residual notes; don't loop.
    carriedNotes.push(
      ...blocking.map((f) => `[unresolved:${f.area}] ${f.title} — ${f.detail}`),
    );
  }
}
// Cap is 1: we do NOT re-review after the fix. The draft PR is where the human
// verifies — residual/judgement-call points ride out as notes, not another loop.

return {
  issueId: ISSUE,
  escalate: false,
  tier: TIER,
  triageReason: triage.reason,
  summary: impl.summary,
  shipped: impl.committed !== false && testsGreen,
  testsGreen,
  diffStat,
  reviewersRun,
  blockingFound: blocking.length,
  fixedCount,
  notes: [...new Set(carriedNotes)], // judgement-call / disputed / agent-flagged points for the PR comment, deduped
  provenance, // final attested provenance table (added file → mirroredFrom | deviation) — goes on the PR
  consolidations: [
    ...new Map(consolidations.map((c) => [c.title, c])).values(),
  ], // reuse follow-up candidates for the human, deduped by title
  playwrightProof,
  playwrightCriteria, // per-AC PASS/FAIL + screenshot paths — the QA evidence table
};
