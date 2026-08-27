export const meta = {
  name: 'work-slice-loop',
  description:
    'Implement one PRD slice (Opus, TDD), loop targeted reviewers in parallel ⇄ fixes until the finding ledger converges or stalls (hard cap 5), then run a dedicated Playwright user-story loop (max 3) on user-facing changes. Returns a structured summary for the human gate.',
  phases: [
    {
      title: 'Implement',
      detail: 'Opus agent, test-first per acceptance criterion',
      model: 'opus',
    },
    {
      title: 'Review',
      detail:
        'gut-check pre-pass opens the first round, then baseline + diff-matched web/server lanes + reuse + scope-fidelity reviewers in parallel (Sonnet), findings gated by a relevance validator; CodeRabbit CLI joins the first round only',
      model: 'sonnet',
    },
    {
      title: 'Fix',
      detail: 'Opus resolves all blocking findings test-first',
      model: 'opus',
    },
    {
      title: 'Playwright',
      detail:
        'dedicated post-convergence user-story loop (verify Sonnet ⇄ fix Opus), max 3',
      model: 'sonnet',
    },
  ],
};

// ── args (passed by the main session) ──────────────────────────────────────
// { sliceId, sliceKind, acceptanceCriteria, whereToLook, conventionContract,
//   figma, baseBranch, prdContract, repoConfig }
// Normalised via the shared parseWorkflowArgs (hoisted from the registry block
// below) so A.sliceId etc. resolve even when args arrive as a JSON string.
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

const SLICE = A.sliceId || '(unknown slice)';
const BASE =
  A.baseBranch || CFG.integrationBranch || 'origin/HEAD';
const AC = Array.isArray(A.acceptanceCriteria)
  ? A.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
  : String(A.acceptanceCriteria || '(see slice ticket)');
const WHERE = A.whereToLook
  ? String(A.whereToLook)
  : '(none given — discover from the codebase)';
const FIGMA = A.figma ? String(A.figma) : '';
const PRD = A.prdContract ? String(A.prdContract) : '';
// 'skeleton' (foundation walking skeleton — makes the cross-layer decisions) or
// 'delta' (behaviour delta — mirrors the skeleton, adds ≤1 novel decision).
const SLICE_KIND = A.sliceKind === 'skeleton' ? 'skeleton' : 'delta';
// The slice's "Convention contract" section: exemplar per layer, must-use libs.
const CONVENTION = A.conventionContract ? String(A.conventionContract) : '';
// How implement/fix agents commit. Stacking is gh-stack: branches are plain git
// locally and only linked into the stack at PR time, so plain git commits are
// correct. Overridable via args for a repo whose stack tool wraps commit.
const COMMIT_CMD = A.commitCmd
  ? String(A.commitCmd)
  : 'git add -A && git commit -m';
const COMMIT_LINE = `STACKING: commit with \`${COMMIT_CMD} "<msg>"\`. NEVER \`git push\` and never open a PR — the main session owns push/PR/stack linkage after review.`;
const LIB_MAP = buildLibMap(CFG);
const MAX_ROUNDS = 5;
const PW_MAX_ROUNDS = 3;
const DEV_SERVER = CFG.devServerCommand;
const E2E_DIR = CFG.e2eDir;
const BROWSER_GUIDE = CFG.browserGuidePath;

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

// >>> shared:loop-schemas — generated from the plugin's shared/loop-schemas.js; edit there and run shared/sync.sh
// Shared implement/fix-loop schemas — used only by loop-shaped workflows
// (work-slice-loop + iterate-pr; solve-ready-loop does not carry this block).
// Synced by the plugin's `shared/sync.sh` between the
// `// >>> shared:loop-schemas` / `// <<< shared:loop-schemas` markers; edit
// HERE, never in the generated blocks. Depends on the reviewer-registry block
// (KNOWN_AREAS, FINDING, findingFingerprint) being synced above it in the target.

// Injected by the tests gate: reviewers never see red code — a red round is
// spent on a dedicated tests-fix pass instead of reviewers.
const TESTS_GATE_FINDING = {
  area: 'tests',
  title: 'Tests/lint not green',
  detail:
    'The implementer reported testsGreen=false. Run the affected tests + lint/typecheck with `pnpm nx`, fix every failure until they ACTUALLY pass in this session, and report the commands + final summary lines in testEvidence. Nothing goes to review red.',
};

// Injected by the commit gate: reviewers inspect `git diff <base>...HEAD`,
// which cannot see uncommitted work — an uncommitted round is spent committing.
const UNCOMMITTED_FINDING = {
  area: 'process',
  title: 'Work not committed',
  detail:
    'The implementer reported committed=false. Reviewers inspect `git diff <base>...HEAD`, which cannot see uncommitted work. Commit everything with the slice commit command (message starts with the slice id) and report committed=true plus the new `head`.',
};

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: 'One-line description of what was implemented/fixed.',
    },
    committed: { type: 'boolean' },
    head: {
      type: 'string',
      description: 'Output of `git rev-parse HEAD` AFTER committing.',
    },
    changedFiles: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repo-relative paths touched.',
    },
    addedFiles: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Repo-relative paths ADDED vs base (`git diff --name-only --diff-filter=A <base>...HEAD`). Empty array when nothing was added. Gates the reuse reviewer.',
    },
    provenance: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', description: 'The added file.' },
          mirroredFrom: {
            type: 'string',
            description: 'Exemplar file whose shape this file mirrors.',
          },
          deviation: {
            type: 'string',
            description:
              'Why no exemplar was mirrored — required when mirroredFrom is absent.',
          },
        },
        required: ['file'],
      },
      description:
        'One row per ADDED file: mirroredFrom (the exemplar followed) OR deviation (why none exists/fits). Silent deviation is forbidden — the reuse reviewer blocks on missing or false rows. Empty array when no files were added.',
    },
    touchedAreas: {
      type: 'array',
      items: { type: 'string', enum: KNOWN_AREAS },
      description:
        'Semantic areas this change affects (declare security/performance even when paths look neutral).',
    },
    userFacingImpact: {
      type: 'boolean',
      description:
        'Does this change plausibly alter user-visible behaviour? Bias toward true when unsure.',
    },
    testsGreen: {
      type: 'boolean',
      description:
        'True ONLY if tests + lint/typecheck were RUN in this session and seen passing — never assumed.',
    },
    testEvidence: {
      type: 'string',
      description:
        'Exact test/lint commands run this session + their final summary lines. Proof behind testsGreen.',
    },
    disputed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'The [id] shown on the finding being disputed — echo it verbatim.',
          },
          title: {
            type: 'string',
            description: 'Verbatim title of the finding being disputed.',
          },
          area: { type: 'string' },
          evidence: {
            type: 'string',
            description:
              'Concrete proof the finding is factually wrong (file:line, test output, spec text).',
          },
        },
        required: ['title', 'evidence'],
      },
      description:
        'Findings NOT fixed because they are factually wrong. Dispute only with concrete evidence — when torn, fix instead. Disputed findings go to the human, not back into the loop.',
    },
    diffStat: {
      type: 'string',
      description: 'Output of `git diff --stat <base>...HEAD`.',
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary',
    'committed',
    'head',
    'changedFiles',
    'addedFiles',
    'provenance',
    'touchedAreas',
    'userFacingImpact',
    'testsGreen',
    'testEvidence',
  ],
};

const PLAYWRIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          pass: { type: 'boolean' },
          screenshot: { type: 'string' },
        },
        required: ['criterion', 'pass'],
      },
    },
    blockingFindings: { type: 'array', items: FINDING },
    proofPaths: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'criteria', 'blockingFindings', 'notes'],
};

// ── Gut-check pre-pass ───────────────────────────────────────────────────────
// Inspired by kramme-cc-workflow (MIT) —
// https://github.com/Abildtoft/kramme-cc-workflow
//
// Rubric-free first read of the whole diff — one question: does anything jump
// out as strange, unusual, or unnecessary? Runs ONCE per workflow run, in the
// first reviewer round only and BEFORE the reviewer lanes, so a `block`
// observation stops the round before any lane spend. Mirrors the standalone
// `gut-check` skill. Dispositions per observation:
//   route  — a real oddity a structured reviewer should judge; enters the
//            round's raw findings (validator → ledger) like any lane finding.
//   reject — it made the reader pause, but the surrounding code explains it.
//   block  — work outside the ticket's requirements → hard stop, human decides.

const GUT_ROUTE_AREAS = [...KNOWN_AREAS, 'baseline', 'reuse', 'scope'];

const GUT_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          detail: {
            type: 'string',
            description:
              'Why it looks strange, unusual, or unnecessary — and what would make it ordinary (an explanation, a rationale, or its removal).',
          },
          disposition: {
            type: 'string',
            enum: ['route', 'reject', 'block'],
          },
          routeArea: {
            type: 'string',
            description:
              'route only: the owning reviewer area (frontend|backend|database|i18n|security|performance|reuse|scope|baseline).',
          },
          rootCause: {
            type: 'string',
            description:
              'route only: short stable slug of the underlying cause — powers the ledger fingerprint.',
          },
        },
        required: ['title', 'detail', 'disposition'],
      },
      description:
        'Everything that made the first read pause. An empty array — nothing jumps out — is a valid, complete answer.',
    },
    scopeNote: {
      type: 'string',
      description:
        'One sentence: the base ref, how many files the manifest covered, and any file whose hunks were not fully read.',
    },
  },
  required: ['observations', 'scopeNote'],
};

function gutCheckPrompt(contractText, baseRef) {
  return `You are the gut-check pre-pass — a rubric-free FIRST READ of this change, before any structured reviewer runs. You MUST NOT edit any files — only report. One question, answered honestly: does anything in this diff jump out as strange, unusual, or unnecessary? "Nothing jumps out" (an empty observations array) is a valid, complete, and frequently correct answer — do not manufacture observations.

${contractText}

Read in three tiers:
1. Manifest — every changed file, ALWAYS: \`git diff --name-status --find-renames ${baseRef}...HEAD\` and \`git diff --numstat --find-renames ${baseRef}...HEAD\`. Unrelated files, drive-by renames, whole-file reformats riding along with real work, deletions, stray scratch files, and generated output moving without the source that would produce it are all visible here without reading a single hunk.
2. Hunks — as many files as fit: \`git diff ${baseRef}...HEAD\`, working file by file in ASCENDING changed-line count so truncation costs the fewest files. Never let a partial read report as a complete pass — name any file you did not fully read in scopeNote.
3. Full files — on suspicion only: open the whole file around a hunk that looks strange. Half a function often looks stranger than the whole one; drop anything the surrounding code explains.

Things that count as jumping out: a change nobody asked for (unrelated file, drive-by rename, reformat alongside real work); something surprising on its face (magic constant, disabled or skipped test, commented-out block, shortened timeout, widened permission, swallowed error, a new dependency pulled in for one call, leftover TODO or debug statement); a hunk you still cannot explain after reading the surrounding file; a deletion whose behaviour has no visible replacement; config/credential/version churn beside unrelated work; anything contradicting the acceptance criteria above. Not exhaustive and not a checklist — anything that made you pause counts, and nothing counts merely because it is listed.

Things that do NOT count: style preferences, naming taste, missing test coverage, general code-quality findings — the reviewer lanes own those. No minimum count, no padding. For a credential, token, or other secret, name the file and line only — never reproduce the value.

Give every observation a disposition:
- "route": a real oddity a structured reviewer should judge — set routeArea to the owning area (frontend|backend|database|i18n|security|performance|reuse|scope; unsure → baseline) plus a stable rootCause slug. It enters the round's findings like any reviewer's.
- "reject": it made you pause, but the surrounding code, the acceptance criteria, or the branch's purpose explains it — record it and move on.
- "block": work clearly OUTSIDE the ticket's stated requirements (an unasked-for feature, unrelated work riding along at scale). This HARD-STOPS the run for the human — use it only when you can name the requirement the work exceeds, never for something a routed finding covers.

End scopeNote with one sentence naming what you looked at: the base ref, the number of changed files the manifest covered (always all of them), and any file whose hunks you did not fully read.`;
}

// route → finding rows for the round's raw findings; an unknown routeArea
// falls back to baseline so nothing routed is lost.
function gutRoutedFindings(observations) {
  return (observations || [])
    .filter((o) => o.disposition === 'route')
    .map((o) => ({
      title: o.title,
      file: o.file,
      line: o.line,
      detail: o.detail,
      rootCause: o.rootCause,
      area: GUT_ROUTE_AREAS.includes(o.routeArea) ? o.routeArea : 'baseline',
    }));
}

// block → open blocking ledger entries (stable CR ids) so the hard stop shows
// up in the verdict and ledger report like any other unresolved finding.
function gutBlockEntries(ledger, round, observations) {
  return (observations || [])
    .filter((o) => o.disposition === 'block')
    .map((o) => {
      const entry = {
        id: `CR-${String(ledger.nextId++).padStart(3, '0')}`,
        fingerprint: findingFingerprint('gut-check', o),
        area: 'gut-check',
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
// <<< shared:loop-schemas

const AREA_COMPILED = compileAreaPaths(CFG.areaPaths);

// ── prompt builders ──────────────────────────────────────────────────────────
const CONTRACT = `Slice: ${SLICE}
Base branch: ${BASE}

WORKING DIRECTORY: operate in the CURRENT working directory — the slice's branch is already checked out in this worktree. Do NOT create a worktree, switch branches, or cd elsewhere; run every file edit, git, and pnpm/nx command here and commit on the current branch.
${COMMIT_LINE}
Acceptance criteria:
${AC}
${PRD ? `\nParent PRD contract:\n${PRD}` : ''}
${CONVENTION ? `\nConvention contract (BINDING — the named exemplars/libs are not advisory):\n${CONVENTION}` : ''}`;

function implPrompt(round, feedback) {
  if (round === 0) {
    const kindGuidance =
      SLICE_KIND === 'skeleton'
        ? `This is the stack's WALKING SKELETON: the full end-to-end path with the REAL contract (schema, types, API shape, UI shell, one happy-path behaviour, tests wired) and stubbed/minimal behaviour elsewhere. Every cross-layer decision lands HERE — downstream delta slices mirror this code, so its shape IS the feature's convention. Clone the exemplar's shape from the convention contract / "Where to look"; do not invent structure an exemplar already settles.`
        : `This is a BEHAVIOUR DELTA on the stack's walking skeleton: the skeleton (this feature's own earlier slices, already on the base branch) is the primary pattern to mirror — sibling features are the fallback. Prefer APPENDING onto the skeleton (new handler branch, new component, new test) over modifying it, and introduce at most the one novel decision the slice ticket names.`;
    return `You are the implementer for one PRD slice. Implement it TEST-FIRST.

${CONTRACT}

${kindGuidance}

Where to look (starting map — mirror it): ${WHERE}
${FIGMA ? `\nDesign (fetch the screenshot fresh via the Figma MCP from this node; reuse design-system tokens/components, no magic numbers):\n${FIGMA}` : ''}
${LIB_MAP ? `\nExisting libs (check here BEFORE writing any new helper/util/component):\n${LIB_MAP}` : ''}

Rules:
- One tracer-bullet test → impl per acceptance criterion (vertical slice — never all-tests-then-all-impl).
- Follow ${CONV}${REPO_SKILLS ? ` and the relevant repo skills (${REPO_SKILLS})` : ' and the relevant repo skills'}. The convention contract's exemplars are BINDING: mirror them; a deviation is allowed only when declared in the provenance table with a concrete reason — silent deviation is a review-blocking offence.
- NO new helper/util/hook/component without first searching ${SRC_ROOTS} (and the design system) for an existing equivalent. Found one → use it.
- Consolidation scope: extracting shared code into a lib is in-scope ONLY when it stays within this slice's own new code plus at most ONE existing call site. Anything wider → record it in notes as a consolidation candidate; do not refactor other features in this slice.
- Stay strictly inside THIS slice's scope. If you find it needs something a later slice owns, record it in notes — do not pull future work forward.${SLICE_KIND === 'delta' ? "\n- CONTRACT FREEZE: never alter the skeleton's published contract (schema, types, API shape). If this delta genuinely requires a contract change, STOP implementing that part and record it in notes as a contract-freeze violation for the human — the stack needs restructuring, not a quiet edit." : ''}
- Run the slice's tests + lint/typecheck with ${GATE_TEXT} before finishing and make them PASS. Set testsGreen=true ONLY if you ran them in THIS session and saw them pass — never assume or claim green without running. Report the exact commands + final summary lines in testEvidence.
- Commit with \`${COMMIT_CMD} "<slice-id> …"\` (message starts with the slice id). Never \`git push\`.

Return the structured result: summary, committed, head (\`git rev-parse HEAD\` after committing), changedFiles (run \`git diff --name-only ${BASE}...HEAD\`), addedFiles (\`git diff --name-only --diff-filter=A ${BASE}...HEAD\`), provenance (one row per added file: mirroredFrom = the exemplar you actually followed, or deviation = why none fits — never both blank), touchedAreas (declare security/performance explicitly when relevant), userFacingImpact (bias true), testsGreen, testEvidence (commands + summary lines), diffStat (\`git diff --stat ${BASE}...HEAD\`), notes.`;
  }
  return `You are the implementer. A review round found BLOCKING problems. Resolve every one of them TEST-FIRST (RED→GREEN where behaviour changes). Do not address style nits or out-of-scope items.

If a finding is FACTUALLY WRONG, do not code around it — return it in \`disputed\` with concrete evidence (file:line, test output, spec text), echoing the finding's [id] and title verbatim so it can be matched. Dispute only what you can prove; when torn, fix. Everything not disputed must be resolved. Disputed findings go to the human on the PR, not back into the loop.

${CONTRACT}

Blocking findings to resolve:
${feedback}

Rules: stay in slice scope; the convention contract's exemplars stay BINDING (declare any deviation in provenance, never silently); no new helper without a ${SRC_ROOTS} search; run tests + lint/typecheck with ${GATE_TEXT} and make them PASS (testsGreen=true only if you ran them THIS session and saw them pass — report commands + summary lines in testEvidence); commit with \`${COMMIT_CMD} "<slice-id> …"\` (never \`git push\`).
Return the structured result (same shape as before) — recompute changedFiles/addedFiles/provenance/touchedAreas/userFacingImpact/diffStat vs ${BASE} (whole slice, not just this fix), plus head (\`git rev-parse HEAD\` after committing).`;
}

function reviewerPrompt(area, def, history, fixDelta) {
  const inspect = fixDelta
    ? `PRIMARY diff to review: the latest fix delta — \`${fixDelta}\`. The full slice diff (\`git diff ${BASE}...HEAD\`) is available for context, but do not re-sweep code that already passed earlier rounds.`
    : `Inspect the slice diff with \`git diff ${BASE}...HEAD\` (and read surrounding files as needed).`;
  return `You are an INDEPENDENT, READ-ONLY reviewer for the "${area}" scope of one PRD slice. You MUST NOT edit any files — only report.

${CONTRACT}

${inspect}
${skillsLine(def)}Focus on: ${def.focus}${history || ''}

Report ONLY:
- blockingFindings: correctness bugs, missed acceptance criteria, or convention/reuse violations in YOUR scope. Each with title, file, line, detail, a concrete suggestedFix, and rootCause (a short stable slug of the underlying cause — reuse the exact slug when re-raising a prior finding). If none, return an empty array.
- notes: judgement-call / debatable points that should NOT block.
Set "area" to "${area}". Do not invent problems to look productive — an empty blockingFindings array is the correct result for clean code.`;
}

function reusePrompt(addedFiles, changedFiles, provenance, history) {
  const modified = changedFiles.filter((f) => !addedFiles.includes(f));
  const provRows = (provenance || [])
    .map(
      (p) =>
        `- ${p.file} → ${p.mirroredFrom ? `mirrors ${p.mirroredFrom}` : `[deviation: ${p.deviation || 'MISSING'}]`}`,
    )
    .join('\n');
  return `You are the INDEPENDENT, READ-ONLY reuse/consolidation reviewer for one PRD slice. You MUST NOT edit any files — only report.

${CONTRACT}

Files ADDED by this slice (inspect them via \`git diff ${BASE}...HEAD\`):
${addedFiles.length ? addedFiles.map((f) => `- ${f}`).join('\n') : '(none)'}

Files MODIFIED by this slice (in scope for intra-diff DRY + YAGNI):
${modified.length ? modified.map((f) => `- ${f}`).join('\n') : '(none)'}

Provenance the implementer attested (VERIFY it — open each cited exemplar and check the file actually mirrors it):
${provRows || (addedFiles.length ? '(none attested — every added file above is missing a provenance row: that is a blocking finding per file)' : '(no added files — nothing to audit)')}
${LIB_MAP ? `\nExisting libs (search index for equivalents):\n${LIB_MAP}` : ''}

Focus on: ${REUSE.focus} ${REUSE.provenanceFocus}${history || ''}

Report ONLY:
- blockingFindings: (a) an added function/component/hook/util/type that duplicates an existing lib/design-system equivalent — name the equivalent, the fix is "use it, delete the copy"; (b) the same logic repeated within the diff where a small local helper would remove it; (c) a provenance row that is missing, cites a non-existent exemplar, or claims a mirror the code visibly doesn't follow. Each with title, file, line, detail, concrete suggestedFix.
- consolidations: genuinely generalizable NEW code that belongs in an existing lib as follow-up work — title, detail (what + which call sites would adopt it), targetLib. NEVER put these in blockingFindings; they become follow-up tickets, not slice scope.
- notes: judgement-call points that should not block.
Set "area" to "reuse". Do not invent problems to look productive — empty arrays are the correct result for clean code.`;
}

function playwrightPrompt(priorFailures, finalRound) {
  const prior = (priorFailures || []).length
    ? `

A prior Playwright round failed these criteria (the implementer has since shipped a fix — verify them extra closely, and still re-run ALL criteria to catch regressions):
${priorFailures.map((t) => `- ${t}`).join('\n')}`
    : '';
  return `You are the READ-ONLY Playwright user-story reviewer for one PRD slice. Verify the slice's user-facing behaviour in a real browser. You MUST NOT edit application code.

${CONTRACT}${prior}

First READ \`${BROWSER_GUIDE}\` in the repo for login steps, seeded users, routes, the core SOAP flow, selectors, and the microphone fake-media flags. Then:
1. A dev server from a prior round may still be running — probe its URL first and reuse it. Only if none serves, start the app in the background and capture its URL: \`${DEV_SERVER}\` (wait until it serves).
2. A prior round may have parked its spec at \`${E2E_DIR}test-output/slice-verify.spec.ts.parked\` (gitignored) — if it exists, restore it into the e2e dir as your throwaway spec and adapt it instead of re-authoring. Otherwise author a throwaway Playwright spec (reuse the \`${E2E_DIR}\` config + the \`login.spec.ts\` dev-login pattern) driving ISOLATED HEADLESS Chromium with \`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream\`, \`video: 'on'\`, baseURL = the running app.
3. Dev-login as the seeded user matching the slice, then exercise EACH acceptance-criterion user story. Capture a screenshot for EVERY criterion — PASS and FAIL alike — under the gitignored test-output dir, named \`ac-<n>-<pass|fail>.png\`. These are QA evidence: they get uploaded to the ticket after the run, so each screenshot must actually show the behaviour it proves (or the breakage), plus keep the run video.
4. CLEAN UP before returning: the throwaway spec relies on hand-seeded DB rows and is NOT a maintainable test — it must NOT be committed or left untracked in a source dir, or the pre-push lint hook fails on it and the next fix pass's \`git add -A\` would commit it. ${finalRound ? 'This is the FINAL round: delete the spec (and any parked copy) outright.' : `If every criterion passed, delete the spec (and any parked copy). If any failed, MOVE it to \`${E2E_DIR}test-output/slice-verify.spec.ts.parked\` (gitignored) so the next round reuses it.`} Delete any other source files you created under ${SRC_ROOTS} or the repo root. Keep the screenshots/video under the gitignored test-output dir for proofPaths. Then run \`git status --porcelain\` and confirm it lists ONLY the implementer's committed change set — no untracked *.spec.ts or other new source files. Remove any of your artifacts that remain.
5. Return: criteria (criterion + pass + screenshot path), blockingFindings (one per broken user story — a failed criterion is BLOCKING, include the screenshot), proofPaths (screenshots + video), notes (e.g. console errors). "Couldn't verify" counts as a failed criterion, not a pass. Set "area" to "playwright".`;
}

// fmtFeedback comes from the shared reviewer-registry block.

// ── run ───────────────────────────────────────────────────────────────────────
phase('Implement');
log(`Implementing slice ${SLICE} (base ${BASE})`);
let impl = await agent(implPrompt(0), {
  label: `impl:${SLICE}`,
  phase: 'Implement',
  model: 'opus',
  schema: IMPL_SCHEMA,
});

if (!impl) {
  return {
    sliceId: SLICE,
    converged: false,
    reviewRounds: 0,
    playwrightRounds: 0,
    error: 'implementation agent failed',
    outstanding: [],
    notes: [],
  };
}

let changedFiles = impl.changedFiles || [];
let addedFiles = impl.addedFiles || [];
let provenance = impl.provenance || [];
let userFacing = impl.userFacingImpact !== false; // default to running Playwright when unsure
let declaredAreas = impl.touchedAreas || [];
let diffStat = impl.diffStat || '';
let testsGreen = impl.testsGreen !== false;
let committed = impl.committed !== false;
let lastHead = impl.head || '';
let lastReviewedHead = ''; // head the previous reviewer round saw — basis for the focused re-review delta
let reuseCleanKey = null; // JSON of {changedFiles, addedFiles, provenance} at the last zero-finding reuse pass
let coderabbitRan = false; // CodeRabbit runs once, in the first reviewer round only
let gutCheckRan = false; // gut-check pre-pass runs once, before the first reviewer round's lanes
const carriedNotes = [...(impl.notes || [])];
const consolidations = []; // reuse reviewer's follow-up-ticket candidates, accumulated across rounds
const playwrightProof = [];
const reviewersPerRound = [];
// Finding ledger: cross-round memory with stable CR ids + lifecycle statuses
// (open|addressed|deferred|disputed|dropped) — see the shared registry block.
const ledger = createLedger();
let prevSnapshot = null; // {score, openIds} at the last reviewer round — material-progress basis
let stallStreak = 0; // consecutive reviewer rounds without material progress
let gateWasFailing = false; // a cleared tests/commit gate counts as material progress
let playwrightCriteria = [];
let outstanding = [];

// Single merge policy for every fix pass: keep prior state when a field is
// missing, and track the fix's commit range for focused re-review.
function applyFix(fix) {
  changedFiles = fix.changedFiles || changedFiles;
  addedFiles = fix.addedFiles || addedFiles;
  provenance = fix.provenance || provenance;
  declaredAreas = fix.touchedAreas || declaredAreas;
  userFacing = fix.userFacingImpact !== false;
  diffStat = fix.diffStat || diffStat;
  testsGreen = fix.testsGreen !== false;
  committed = fix.committed !== false;
  lastHead = fix.head || lastHead;
  if (fix.notes) carriedNotes.push(...fix.notes);
}

// ── Phase 1: code review ⇄ fix loop (baseline + area reviewers, NO Playwright) ──
let reviewConverged = false;
let reviewRound = 0;

for (reviewRound = 1; reviewRound <= MAX_ROUNDS; reviewRound++) {
  // Tests + commit gate: reviewers never see red or uncommitted code (they
  // inspect `git diff BASE...HEAD`). A failing round spends its iteration on a
  // dedicated fix pass instead of reviewers, and counts against the cap.
  if (!testsGreen || !committed) {
    const gate = !committed ? UNCOMMITTED_FINDING : TESTS_GATE_FINDING;
    const gateName = !committed ? 'commit-gate' : 'tests-gate';
    gateWasFailing = true;
    reviewersPerRound.push({ round: reviewRound, reviewers: [gateName] });
    if (reviewRound === MAX_ROUNDS) {
      outstanding = [gate];
      log(
        `Hit the ${MAX_ROUNDS}-round hard cap (a safety boundary, not a target) with the ${gateName} still failing — escalating to human.`,
      );
      break;
    }
    phase('Fix');
    log(
      `Review round ${reviewRound}: ${gateName} failing — dedicated fix pass before any reviewer runs.`,
    );
    const fix = await agent(implPrompt(reviewRound, fmtFeedback([gate])), {
      label: `${gateName}-fix:r${reviewRound}`,
      phase: 'Fix',
      model: 'opus',
      schema: IMPL_SCHEMA,
    });
    if (!fix) {
      outstanding = [gate];
      log(
        `${gateName} fix agent failed on review round ${reviewRound} — escalating.`,
      );
      break;
    }
    applyFix(fix);
    phase('Review');
    continue;
  }
  // The gate passed this round — if it was failing, that clearing is material progress.
  const gateCleared = gateWasFailing;
  gateWasFailing = false;

  // Gut-check pre-pass: rubric-free first read, once per run, BEFORE the
  // reviewer lanes — so a `block` observation stops the loop before any lane
  // spend. Routed observations join this round's raw findings below.
  const runGut = !gutCheckRan;
  let gutRouted = [];
  if (runGut) {
    gutCheckRan = true; // once per run — even a died agent does not earn a re-run
    log(`Review round ${reviewRound}: gut-check pre-pass (first read).`);
    const gut = await agent(gutCheckPrompt(CONTRACT, BASE), {
      label: 'gut-check',
      phase: 'Review',
      model: 'sonnet',
      schema: GUT_CHECK_SCHEMA,
    });
    if (!gut) {
      log('Gut-check agent died — continuing without the first-read pass.');
    } else {
      const blocked = gutBlockEntries(ledger, reviewRound, gut.observations);
      if (blocked.length) {
        outstanding = blocked.map(ledgerEntryFinding);
        log(
          `Gut check: ${blocked.length} BLOCK observation(s) (${blocked.map((e) => e.id).join(', ')}) — work outside the ticket's requirements; hard stop for the human.`,
        );
        break;
      }
      gutRouted = gutRoutedFindings(gut.observations);
      const rejected = (gut.observations || []).length - gutRouted.length;
      log(
        `Gut check: ${gutRouted.length} routed, ${rejected} rejected. ${gut.scopeNote || ''}`,
      );
    }
  }

  const areas = selectAreas(AREA_COMPILED, changedFiles, declaredAreas);
  const laneEntries = groupAreasByLane(areas);
  // reuse reviewer gates on the slice ADDING files, and skips when the added
  // set + provenance are unchanged since its last clean pass (nothing new to audit)
  const reuseKey = JSON.stringify({ changedFiles, addedFiles, provenance });
  const runReuse =
    changedFiles.length + addedFiles.length > 0 && reuseKey !== reuseCleanKey;
  const runCodeRabbit = !coderabbitRan;
  const runScope = scopeLaneGate(addedFiles, diffStat);
  const ran = [
    ...(runGut ? ['gut-check'] : []),
    'baseline',
    ...laneEntries.map(([lane, members]) => `${lane}[${members.join('+')}]`),
    ...(runReuse ? ['reuse'] : []),
    ...(runScope ? ['scope'] : []),
    ...(runCodeRabbit ? ['coderabbit'] : []),
  ];
  reviewersPerRound.push({ round: reviewRound, reviewers: ran });
  log(`Review round ${reviewRound}: reviewers = ${ran.join(', ')}`);

  // Focused re-review: everything committed since the last reviewer round is
  // the primary diff. Empty until a round has actually reviewed something.
  const fixDelta =
    lastReviewedHead && lastHead && lastHead !== lastReviewedHead
      ? `git diff ${lastReviewedHead} ${lastHead}`
      : '';
  lastReviewedHead = lastHead;

  const history = ledgerHistoryText(ledger);
  const thunks = [
    () =>
      agent(reviewerPrompt('baseline', BASELINE, history, fixDelta), {
        label: `review:baseline`,
        phase: 'Review',
        model: 'sonnet',
        schema: FINDINGS_SCHEMA,
      }),
  ];
  for (const [lane, members] of laneEntries) {
    thunks.push(() =>
      agent(reviewerPrompt(lane, laneDef(members, RVW), history, fixDelta), {
        label: `review:${lane}`,
        phase: 'Review',
        model: 'sonnet',
        schema: FINDINGS_SCHEMA,
      }),
    );
  }
  if (runReuse) {
    thunks.push(() =>
      agent(reusePrompt(addedFiles, changedFiles, provenance, history), {
        label: 'review:reuse',
        phase: 'Review',
        model: 'sonnet',
        schema: FINDINGS_SCHEMA,
      }),
    );
  }
  if (runScope) {
    thunks.push(() =>
      agent(
        scopeFidelityPrompt(
          `${CONTRACT}${history || ''}`,
          `git diff ${BASE}...HEAD`,
          CFG,
        ),
        {
          label: 'review:scope',
          phase: 'Review',
          model: 'sonnet',
          schema: FINDINGS_SCHEMA,
        },
      ),
    );
  }
  if (runCodeRabbit) {
    coderabbitRan = true; // once per run — even a died agent does not earn a re-run
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
  }

  const results = await parallel(thunks);
  const reviews = results.filter(Boolean);
  const died = results.length - reviews.length;
  if (died > 0)
    log(
      `Review round ${reviewRound}: ${died} of ${results.length} reviewer agent(s) died — their scope is uncovered this round.`,
    );

  for (const r of reviews) {
    if (r.notes) carriedNotes.push(...r.notes.map((n) => `[${r.area}] ${n}`));
    if (r.consolidations) consolidations.push(...r.consolidations);
  }
  // Gut-routed observations enter the round like any reviewer finding — the
  // validator and ledger treat them identically.
  const raw = [
    ...gutRouted,
    ...reviews.flatMap((r) =>
      (r.blockingFindings || []).map((f) => ({ ...f, area: r.area })),
    ),
  ];
  raw.forEach((f, i) => {
    f.id = `r${reviewRound}-${i + 1}`; // round-local tag for the validator; the ledger mints the stable CR id
  });

  const reuseReview = reviews.find((r) => r.area === 'reuse');
  if (
    runReuse &&
    reuseReview &&
    (reuseReview.blockingFindings || []).length === 0
  )
    reuseCleanKey = reuseKey;

  // Ledger pipeline: auto-suppress disputed/deferred re-raises → relevance
  // validator classifies the rest → ingest into the ledger.
  const { kept, suppressed } = ledgerSuppress(ledger, raw);
  if (suppressed.length)
    log(
      `Review round ${reviewRound}: ${suppressed.length} re-raised finding(s) auto-suppressed (disputed/deferred fingerprints).`,
    );
  let validated = [];
  if (kept.length) {
    const val = await agent(
      validatorPrompt(CONTRACT, fmtFeedback(kept), `git diff ${BASE}...HEAD`),
      {
        label: `validate:r${reviewRound}`,
        phase: 'Review',
        model: 'sonnet',
        schema: VALIDATION_SCHEMA,
      },
    );
    if (!val)
      log(
        `Review round ${reviewRound}: validator died — findings pass through unfiltered.`,
      );
    validated = classifyFindings(kept, val && val.verdicts);
    for (const v of validated) {
      if (v.cls === 'advisory') {
        if (v.diffCaused === false)
          consolidations.push({
            title: v.finding.title,
            detail: `${v.finding.detail} (pre-existing — demoted by the relevance gate${v.confidence != null ? `, confidence ${v.confidence}` : ''})`,
          });
        else
          carriedNotes.push(
            `[advisory:${v.finding.area}] ${v.finding.title} — ${v.finding.detail}`,
          );
      }
    }
    const droppedN = validated.filter((v) => v.cls === 'dropped').length;
    const advisoryN = validated.filter((v) => v.cls === 'advisory').length;
    if (droppedN + advisoryN > 0)
      log(
        `Review round ${reviewRound}: relevance gate — ${validated.length - droppedN - advisoryN} eligible, ${advisoryN} advisory, ${droppedN} dropped as UNVERIFIED.`,
      );
  }
  ledgerIngest(ledger, reviewRound, validated);
  const openB = ledgerOpenBlocking(ledger);

  // Material progress + stall accounting (debt-score termination).
  const { progressed, snapshot } = ledgerProgress(
    prevSnapshot,
    ledger,
    gateCleared,
  );
  prevSnapshot = snapshot;
  stallStreak = progressed ? 0 : stallStreak + 1;

  // Stop conditions, first hit wins: (1) converged, (2) two stalled rounds,
  // (3) per-finding deferral lives in ledgerIngest, (4) hard cap.
  if (openB.length === 0) {
    if (died > 0) {
      // zero findings + dead reviewers is NOT convergence — their scope went unreviewed
      outstanding = [
        {
          area: 'process',
          title: `${died} reviewer agent(s) died in round ${reviewRound}`,
          detail:
            'The round returned no blocking findings, but one or more reviewer agents died (returned null), so their scope went unreviewed. Not trustworthy as convergence — escalating to the human gate.',
        },
      ];
      log(
        `Review round ${reviewRound}: no open findings but ${died} reviewer(s) died — NOT converging; escalating.`,
      );
      break;
    }
    reviewConverged = true;
    log(`Review round ${reviewRound}: no open blocking findings — converged.`);
    break;
  }

  if (stallStreak >= LEDGER_STALL_LIMIT) {
    outstanding = openB.map(ledgerEntryFinding);
    log(
      `Review loop stalled: ${LEDGER_STALL_LIMIT} consecutive rounds without material progress (debt score ${snapshot.score}) — stopping with ${openB.length} open finding(s) (${openB.map((e) => e.id).join(', ')}).`,
    );
    break;
  }

  if (reviewRound === MAX_ROUNDS) {
    outstanding = openB.map(ledgerEntryFinding);
    log(
      `Hit the ${MAX_ROUNDS}-round hard cap (a safety boundary, not a target) with ${openB.length} open finding(s) (${openB.map((e) => e.id).join(', ')}) — stopping.`,
    );
    break;
  }

  phase('Fix');
  log(
    `Review round ${reviewRound}: ${openB.length} open blocking finding(s) (${openB.map((e) => e.id).join(', ')}) — fix pass.`,
  );
  const fix = await agent(
    implPrompt(reviewRound, fmtFeedback(openB.map(ledgerEntryFinding))),
    {
      label: `fix:r${reviewRound}`,
      phase: 'Fix',
      model: 'opus',
      schema: IMPL_SCHEMA,
    },
  );
  if (!fix) {
    outstanding = openB.map(ledgerEntryFinding);
    log(
      `Fix agent failed on review round ${reviewRound} — escalating with the unresolved findings.`,
    );
    break;
  }
  ledgerApplyFix(openB, fix);
  for (const d of fix.disputed || []) {
    carriedNotes.push(`[disputed:${d.area || '?'}] ${d.title} — ${d.evidence}`);
  }
  applyFix(fix);
  phase('Review');
}

// ── Independent closeout adjudication of disputed findings ───────────────────
// One fresh Opus agent, evidence only (final diff + both sides' recorded
// evidence — never the fix agent's free-text justifications). Upheld findings
// reopen and flip the verdict to stalled; deadlock is reported, never re-looped.
const disputedEntries = ledger.entries.filter((e) => e.status === 'disputed');
if (disputedEntries.length) {
  phase('Review');
  log(
    `${disputedEntries.length} disputed finding(s) — independent closeout adjudication.`,
  );
  const adj = await agent(
    adjudicatorPrompt(CONTRACT, disputedEntries, `git diff ${BASE}...HEAD`),
    {
      label: 'adjudicate',
      phase: 'Review',
      model: 'opus',
      schema: ADJUDICATION_SCHEMA,
    },
  );
  if (adj) {
    const upheld = applyAdjudication(ledger, adj.rulings);
    if (upheld.length) {
      reviewConverged = false;
      outstanding = [...outstanding, ...upheld.map(ledgerEntryFinding)];
      log(
        `Adjudicator upheld ${upheld.length} disputed finding(s) — reopened (${upheld.map((e) => e.id).join(', ')}).`,
      );
    }
  } else {
    carriedNotes.push(
      '[adjudication] Adjudicator agent died — the reviewer/implementer disagreement stands unresolved for the human on the PR.',
    );
  }
}

// ── Phase 2: dedicated Playwright user-story loop ⇄ fix, capped at PW_MAX_ROUNDS.
//    Runs ONLY after the code-review loop converged AND the change is user-facing
//    (skip pure refactors / internal utils / no-behaviour-change migrations). ──
let playwrightRan = false;
let playwrightConverged = false;
let playwrightRound = 0;

let pwPriorFailures = [];
if (reviewConverged && userFacing) {
  playwrightRan = true;
  for (
    playwrightRound = 1;
    playwrightRound <= PW_MAX_ROUNDS;
    playwrightRound++
  ) {
    // Same tests + commit gate: never verify red or uncommitted code.
    if (!testsGreen || !committed) {
      const gate = !committed ? UNCOMMITTED_FINDING : TESTS_GATE_FINDING;
      const gateName = !committed ? 'commit-gate' : 'tests-gate';
      if (playwrightRound === PW_MAX_ROUNDS) {
        outstanding = [...outstanding, gate];
        log(
          `Hit ${PW_MAX_ROUNDS}-round Playwright cap with the ${gateName} still failing — escalating to human.`,
        );
        break;
      }
      phase('Fix');
      log(
        `Playwright round ${playwrightRound}: ${gateName} failing — dedicated fix pass before verifying.`,
      );
      const fix = await agent(
        implPrompt(playwrightRound, fmtFeedback([gate])),
        {
          label: `pw-${gateName}-fix:r${playwrightRound}`,
          phase: 'Fix',
          model: 'opus',
          schema: IMPL_SCHEMA,
        },
      );
      if (!fix) {
        outstanding = [...outstanding, gate];
        log(
          `${gateName} fix agent failed on Playwright round ${playwrightRound} — escalating.`,
        );
        break;
      }
      applyFix(fix);
      continue;
    }

    phase('Playwright');
    log(
      `Playwright round ${playwrightRound}: verifying user-facing behaviour.`,
    );
    // read-only verifier — Sonnet like every other read-only reviewer; the
    // fix passes below stay on Opus
    const pw = await agent(
      playwrightPrompt(pwPriorFailures, playwrightRound === PW_MAX_ROUNDS),
      {
        label: `playwright:r${playwrightRound}`,
        phase: 'Playwright',
        model: 'sonnet',
        schema: PLAYWRIGHT_SCHEMA,
      },
    );

    if (!pw) {
      log(
        `Playwright reviewer failed on round ${playwrightRound} — stopping Playwright loop.`,
      );
      break;
    }
    if (pw.proofPaths) playwrightProof.push(...pw.proofPaths);
    if (pw.criteria) playwrightCriteria = pw.criteria; // last round's per-AC verdicts = the QA evidence table
    if (pw.notes)
      carriedNotes.push(...pw.notes.map((n) => `[playwright] ${n}`));

    const blocking = (pw.blockingFindings || []).map((f) => ({
      ...f,
      area: 'playwright',
    }));
    pwPriorFailures = blocking.map((f) => f.title);

    if (blocking.length === 0) {
      playwrightConverged = true;
      log(
        `Playwright round ${playwrightRound}: all user stories pass — converged.`,
      );
      break;
    }

    if (playwrightRound === PW_MAX_ROUNDS) {
      outstanding = [...outstanding, ...blocking];
      log(
        `Hit ${PW_MAX_ROUNDS}-round Playwright cap with ${blocking.length} broken user story(ies) — escalating to human.`,
      );
      break;
    }

    phase('Fix');
    log(
      `Playwright round ${playwrightRound}: ${blocking.length} broken user story(ies) — fix pass.`,
    );
    const fix = await agent(
      implPrompt(playwrightRound, fmtFeedback(blocking)),
      {
        label: `pw-fix:r${playwrightRound}`,
        phase: 'Fix',
        model: 'opus',
        schema: IMPL_SCHEMA,
      },
    );
    if (!fix) {
      outstanding = [...outstanding, ...blocking];
      log(
        `Fix agent failed on Playwright round ${playwrightRound} — escalating with the unresolved findings.`,
      );
      break;
    }
    for (const d of fix.disputed || []) {
      carriedNotes.push(`[disputed:playwright] ${d.title} — ${d.evidence}`);
    }
    applyFix(fix);
  }
}

const converged = reviewConverged && (!playwrightRan || playwrightConverged);

return {
  sliceId: SLICE,
  baseBranch: BASE,
  summary: impl.summary,
  converged,
  // Verdict language for every downstream report (PR comment, babysit input):
  // 'converged', or an explicit stalled verdict naming the open CR ids.
  verdict: ledgerVerdict(ledger, converged),
  debtScore: ledgerScore(ledger),
  // The finding ledger — open/deferred/disputed (with dispute evidence and
  // adjudication rulings) for the PR comment; ledgerText is the preformatted block.
  ledger: ledger.entries,
  ledgerText: ledgerReport(ledger),
  hitCap: !converged && outstanding.length > 0,
  reviewConverged,
  reviewRounds: reviewRound,
  playwrightRan,
  playwrightConverged,
  playwrightRounds: playwrightRan ? playwrightRound : 0,
  reviewersPerRound,
  outstanding, // blocking findings still unresolved if either cap was hit
  testsGreen,
  committed,
  notes: [...new Set(carriedNotes)], // judgement-call + disputed points for the human, deduped
  provenance, // final attested provenance table (added file → mirroredFrom | deviation) — goes on the PR
  consolidations: [
    ...new Map(consolidations.map((c) => [c.title, c])).values(),
  ], // reuse follow-up candidates, deduped by title — the orchestrator files these as tickets
  diffStat,
  playwrightProof,
  playwrightCriteria, // last round's per-AC PASS/FAIL + screenshot paths — the QA evidence table
};
