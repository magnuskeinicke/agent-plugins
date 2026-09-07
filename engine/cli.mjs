#!/usr/bin/env node
// State and task manifests live in the host repo's gitignored .context directory.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  copyFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRepoConfig, loadRepoConfig, parseRepoConfig, focusOverlay, buildLibMap, buildGoldenPaths } from './lib/config.mjs';
import { compileAreaPaths, selectAreas } from './lib/areas.mjs';
import { ROSTER, selectReviewers, overlayFor } from './lib/roster.mjs';
import {
  createLedger,
  ledgerSuppress,
  ledgerIngest,
  ledgerOpenBlocking,
  ledgerProgress,
  ledgerVerdict,
  ledgerApplyFix,
  ledgerEntryFinding,
  ledgerReport,
  fmtFeedback,
  classifyFindings,
  applyAdjudication,
  gutBlockEntries,
  gutRoutedFindings,
  LEDGER_HARD_CAP,
  LEDGER_STALL_LIMIT,
} from './lib/ledger.mjs';
import { FINDINGS_SCHEMA, VALIDATION_SCHEMA, ADJUDICATION_SCHEMA, FIX_RESULT_SCHEMA, IMPLEMENT_RESULT_SCHEMA, BABYSIT_FIX_SCHEMA, GUT_CHECK_SCHEMA, validate } from './lib/schemas.mjs';
import * as prompts from './lib/prompts.mjs';
import { taskModels, resolveModel, SKILL_ROLES } from './lib/models.mjs';
import { runTask } from './lib/runner.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Gate findings — injected instead of a reviewer round when a gate is red.
const TESTS_GATE_FINDING = {
  id: 'GATE-TESTS',
  source: 'gate',
  title: 'Tests/lint not green',
  detail:
    'The implementer reported testsGreen=false. Run the repo test + lint/typecheck gates, fix every failure until they ACTUALLY pass in this session, and report the commands + final summary lines in testEvidence. Nothing goes to review red.',
};
const UNCOMMITTED_FINDING = {
  id: 'GATE-COMMIT',
  source: 'gate',
  title: 'Work not committed',
  detail:
    'The implementer reported committed=false. Reviewers inspect `git diff <base>...HEAD`, which cannot see uncommitted work. Commit only the owned edited files and report committed=true plus the new `head`; if sandbox git writes are denied, return the owned file list for the parent to commit.',
};

// ── plumbing ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const list = (v) =>
  v === undefined || v === true || v === '' ? [] : String(v).split(',').filter(Boolean);
const bool = (v) => v === true || v === 'true';

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function runDir(args) {
  if (!args.slice) die('--slice <id> is required');
  return join(args.dir || '.context', args.slice);
}

function statePath(args) {
  return join(runDir(args), 'ledger.json');
}

function loadState(args) {
  const p = statePath(args);
  if (!existsSync(p)) die(`no run state at ${p} — run \`init\` first`);
  const state = JSON.parse(readFileSync(p, 'utf8'));
  if (!state.tasks) {
    state.config = loadCfg(args, state);
    state.tasks = [];
    const round = join(runDir(args), `round-${state.round}`);
    if (!state.coverage && (state.phase === 'decide' || ['clean', 'converged'].includes(state.verdict))) {
      state.phase = 'collect';
      state.verdict = 'incomplete — legacy coverage requires collection';
    }
    const add = (id, promptFile, outputFile, role, schema) => {
      if (!existsSync(promptFile)) return;
      const agentFile = join(PLUGIN_ROOT, 'agents', `${id}.md`);
      state.tasks.push(persistTask(args, state, { id, promptFile, outputFile,
        ...(existsSync(agentFile) ? { agentFile, model: agentModel(id), effort: agentEffort(id) } : {}) }, role, schema));
    };
    if (state.phase === 'collect') {
      const dir = join(round, 'prompts');
      for (const file of existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')) : []) {
        const id = file.slice(0, -3);
        add(id, join(dir, file), join(round, 'findings', `${id}.json`), 'reviewer', id === 'gut-check' ? GUT_CHECK_SCHEMA : FINDINGS_SCHEMA);
      }
    } else if (state.phase === 'fix') add('fixer', join(round, 'fix.md'), join(round, 'fix-result.json'), 'fixer', FIX_RESULT_SCHEMA);
    else if (state.phase === 'adjudicate') add('adjudicator', join(runDir(args), 'adjudication/prompt.md'), join(runDir(args), 'adjudication/rulings.json'), 'adjudicator', ADJUDICATION_SCHEMA);
    saveState(args, state);
  }
  return state;
}

function saveState(args, state) {
  const p = statePath(args);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

function readJson(path, schema, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`${label}: cannot read/parse ${path}: ${e.message}`);
  }
  if (schema) {
    const errors = validate(parsed, schema);
    if (errors.length)
      die(`${label}: ${path} failed schema validation:\n  ${errors.join('\n  ')}`);
  }
  return parsed;
}

function contractText(args, state) {
  const p = join(runDir(args), 'contract.md');
  if (existsSync(p)) return readFileSync(p, 'utf8');
  return `Change under review: slice ${state.slice} (no contract file recorded — judge against the diff and repo conventions alone, and say so in notes).`;
}

function loadCfg(args, state) {
  if (!args.config && state?.config) return state.config;
  if (args.config && !existsSync(args.config)) die(`Config snapshot not found: ${args.config}`);
  const raw = args.config
    ? loadRepoConfig(args.config)
    : loadRepoConfig('docs/agents/repo-config.md');
  return resolveRepoConfig(raw);
}

function persistTask(args, state, task, role, schema) {
  const execution = taskModels(loadCfg(args, state), role, { modelAlias: task.model, effort: task.effort });
  const result = {
    ...task, role, execution, schema, cwd: process.cwd(),
    model: execution.claude.model, effort: execution.claude.effort,
    promptFile: resolve(task.promptFile), outputFile: resolve(task.outputFile),
    taskFile: resolve(/\.md$/.test(task.promptFile) ? task.promptFile.replace(/\.md$/, '.task.json') : `${task.promptFile}.task.json`),
  };
  writeFileSync(result.taskFile, JSON.stringify(result, null, 2) + '\n');
  return result;
}

// The commands every prompt uses to see the change. Default is the committed
// branch diff; `init --inspect` overrides it for other targets (uncommitted
// work: `git diff HEAD`; a PR reviewed without a checkout: `gh pr diff <n>`).
// The manifest forms feed the gut-check pre-pass; non-git inspect commands get
// a `--name-only` manifest and no numstat.
function inspectCmds(state) {
  const diffCmd = state.inspect || `git diff ${state.base}...HEAD`;
  if (diffCmd.startsWith('git diff'))
    return {
      diffCmd,
      nameStatusCmd: diffCmd.replace('git diff', 'git diff --name-status --find-renames'),
      numstatCmd: diffCmd.replace('git diff', 'git diff --numstat --find-renames'),
    };
  return { diffCmd, nameStatusCmd: `${diffCmd} --name-only`, numstatCmd: '' };
}

function maxRounds(state) {
  return state.maxRounds || LEDGER_HARD_CAP;
}

function agentBody(id) {
  const p = join(PLUGIN_ROOT, 'agents', `${id}.md`);
  const text = readFileSync(p, 'utf8');
  return text.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function agentModel(id) {
  const p = join(PLUGIN_ROOT, 'agents', `${id}.md`);
  const m = /^model:\s*(\S+)/m.exec(readFileSync(p, 'utf8'));
  return m && m[1] !== 'inherit' ? m[1] : '';
}

function agentEffort(id) {
  const p = join(PLUGIN_ROOT, 'agents', `${id}.md`);
  const m = /^effort:\s*(\S+)/m.exec(readFileSync(p, 'utf8'));
  return m ? m[1] : '';
}

function reuseFingerprint(addedFiles, provenance) {
  return createHash('sha1')
    .update(JSON.stringify([[...addedFiles].sort(), provenance || []]))
    .digest('hex');
}

// ── commands ─────────────────────────────────────────────────────────────────

function cmdInit(args) {
  const dir = runDir(args);
  const p = statePath(args);
  if (existsSync(p)) {
    const state = loadState(args);
    out({ resumed: true, slice: state.slice, round: state.round, phase: state.phase });
    return;
  }
  if (!args.base) die('--base <ref> is required');
  const cap = args['max-rounds'] === undefined ? null : Number(args['max-rounds']);
  if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > LEDGER_HARD_CAP))
    die(`--max-rounds must be an integer 1..${LEDGER_HARD_CAP}`);
  mkdirSync(dir, { recursive: true });
  if (args['contract-file']) copyFileSync(args['contract-file'], join(dir, 'contract.md'));
  const state = {
    config: loadCfg(args),
    tasks: [],
    slice: args.slice,
    base: args.base,
    // Review-only: one classified reviewer round, no fix pass — findings are
    // the deliverable (magnus:review-code). `decide` ends the run either way.
    reviewOnly: bool(args['review-only']),
    maxRounds: cap,
    inspect: typeof args.inspect === 'string' ? args.inspect : '',
    round: 1,
    phase: 'plan',
    ledger: createLedger(),
    snapshots: [],
    stalledRounds: 0,
    headHistory: [],
    // Pass the implement pass's gate results here so a red gate forces a
    // gate-fix before any reviewer prompt is emitted. Unknown = assumed green.
    gates: {
      testsGreen: args['tests-green'] === undefined ? null : bool(args['tests-green']),
      committed: args.committed === undefined ? null : bool(args.committed),
    },
    reuseCleanAt: null,
    verdict: null,
  };
  saveState(args, state);
  out({ resumed: false, slice: state.slice, round: 1, phase: 'plan', stateFile: p });
}

function cmdPlan(args) {
  const state = loadState(args);
  if (state.phase !== 'plan')
    die(`phase is "${state.phase}", expected "plan" — run the pending step first (status shows it)`);

  // Reviewers never see red code or uncommitted work: a red gate spends this
  // round on a gate-fix pass instead of a reviewer round, mechanically.
  const gateFindings = [
    ...(state.gates.testsGreen === false ? [TESTS_GATE_FINDING] : []),
    ...(state.gates.committed === false ? [UNCOMMITTED_FINDING] : []),
  ];
  if (gateFindings.length) {
    if (state.round >= maxRounds(state)) {
      state.phase = 'done';
      state.verdict = ledgerVerdict(state.ledger, false);
      saveState(args, state);
      out({ action: 'stalled', verdict: state.verdict, reason: 'round cap hit with a red gate' });
      return;
    }
    const roundDir = join(runDir(args), `round-${state.round}`);
    mkdirSync(roundDir, { recursive: true });
    const outputFile = join(roundDir, 'fix-result.json');
    const promptFile = join(roundDir, 'fix.md');
    writeFileSync(
      promptFile,
      prompts.fixPrompt(contractText(args, state), gateFindings, inspectCmds(state).diffCmd, args['commit-rule'] || '', outputFile),
    );
    state.phase = 'fix';
    state.fixTargets = gateFindings.map((f) => f.id);
    state.tasks = [persistTask(args, state, { id: 'gate-fix', promptFile, outputFile }, 'fixer', FIX_RESULT_SCHEMA)];
    saveState(args, state);
    out({
      action: 'gate-fix',
      round: state.round,
      gateFindings: gateFindings.map((f) => f.title),
      fix: state.tasks[0],
      next: 'run one fix implementer with the prompt, then `apply-fix --result <outputFile>` — no reviewers run while a gate is red',
    });
    return;
  }

  const cfg = loadCfg(args, state);
  const changedFiles = list(args['changed-files']);
  const addedFiles = list(args['added-files']);
  const provenance = args['provenance-file']
    ? readJson(args['provenance-file'], null, 'provenance')
    : [];
  const areas = selectAreas(
    compileAreaPaths(cfg.areaPaths),
    changedFiles,
    list(args['declared-areas']),
  );
  const fp = reuseFingerprint(addedFiles, provenance);
  const openSources = ledgerOpenBlocking(state.ledger).map((e) => e.source);
  const { selected, skipped } = selectReviewers({
    round: state.round,
    areas,
    changedFiles,
    addedFiles,
    deletedFiles: list(args['deleted-files']),
    insertions: Number(args.insertions || 0),
    userFacing: bool(args['user-facing']),
    hints: list(args.hints),
    openSources,
    reuseClean: state.reuseCleanAt !== null && state.reuseCleanAt === fp,
  });

  const dir = runDir(args);
  const promptsDir = join(dir, `round-${state.round}`, 'prompts');
  const findingsDir = join(dir, `round-${state.round}`, 'findings');
  mkdirSync(promptsDir, { recursive: true });
  mkdirSync(findingsDir, { recursive: true });

  const contract = contractText(args, state);
  const overlays = focusOverlay(cfg, areas);
  const inspect = inspectCmds(state);
  const hh = state.headHistory;
  const fixRange =
    args['fix-range'] ||
    (state.round > 1 && hh.length >= 2 ? `${hh[hh.length - 2]}..${hh[hh.length - 1]}` : '');

  const reviewers = selected.map((r) => {
    const outputFile = join(findingsDir, `${r.id}.json`);
    const extra =
      r.id === 'codebase-pattern-reviewer'
        ? prompts.reuseAuditExtra(cfg, buildLibMap(cfg), buildGoldenPaths(cfg), provenance)
        : '';
    const text = prompts.reviewerPrompt({
      reviewerId: r.id,
      mode: r.mode,
      contractText: contract,
      diffCmd: inspect.diffCmd,
      fixRange,
      overlays: overlayFor(r.id, areas, overlays),
      ledger: state.round > 1 ? state.ledger : null,
      outputFile,
      cfg,
      extra,
    });
    const promptFile = join(promptsDir, `${r.id}.md`);
    writeFileSync(promptFile, text);
    return persistTask(args, state, {
      id: r.id,
      agentFile: join(PLUGIN_ROOT, 'agents', `${r.id}.md`),
      model: agentModel(r.id),
      effort: agentEffort(r.id),
      promptFile,
      outputFile,
    }, 'reviewer', FINDINGS_SCHEMA);
  });

  // Round-1 one-shot: the gut-check pre-pass (must run BEFORE the reviewers —
  // a `block` stops the run before any lane spend).
  let prePass = null;
  if (state.round === 1) {
    const gutOut = join(findingsDir, 'gut-check.json');
    const gutPrompt = join(promptsDir, 'gut-check.md');
    writeFileSync(gutPrompt, prompts.gutCheckPrompt(contract, inspect, gutOut));
    prePass = persistTask(args, state, { id: 'gut-check', promptFile: gutPrompt, outputFile: gutOut }, 'reviewer', GUT_CHECK_SCHEMA);
  }

  if (args.head) state.headHistory.push(args.head);
  state.phase = 'collect';
  state.tasks = [...(prePass ? [prePass] : []), ...reviewers];
  state.coverage = { expected: state.tasks.map((task) => task.id), completed: [], missing: state.tasks.map((task) => task.id), invalid: [] };
  state.planMeta = { areas, changedFiles: changedFiles.length, fixRange, reuseFp: fp };
  saveState(args, state);
  out({
    round: state.round,
    areas,
    prePass,
    reviewers,
    skipped,
    next: 'run the pre-pass first (round 1), then fresh reviewers; persist every returned JSON using the task manifest, then run `collect`',
  });
}

function cmdCollect(args) {
  const state = loadState(args);
  // Re-runnable until `decide` consumes the round: a dead reviewer gets one
  // re-run, then collect runs again over the same findings dir (decide moves
  // the phase past "decide", so a consumed round can never be re-collected).
  if (state.phase !== 'collect' && state.phase !== 'decide')
    die(`phase is "${state.phase}", expected "collect"`);
  const dir = runDir(args);
  const roundDir = join(dir, `round-${state.round}`);
  const findingsDir = join(roundDir, 'findings');

  // A reviewer that never wrote its outputFile is a dead reviewer — surfaced
  // here mechanically (emitted prompt with no findings file), never inferred.
  const promptsDir = join(roundDir, 'prompts');
  const emitted = state.coverage?.expected || (existsSync(promptsDir)
    ? readdirSync(promptsDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
    : []);
  if (!emitted.length) die('No reviewer plan found; restore this round before collecting');
  const present = new Set(
    (existsSync(findingsDir) ? readdirSync(findingsDir) : [])
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
  );
  const missing = emitted.filter((id) => !present.has(id)).sort();

  const raw = [];
  const reports = [];
  const invalid = [];
  let gut = null;
  for (const f of existsSync(findingsDir) ? readdirSync(findingsDir).sort() : []) {
    if (!f.endsWith('.json')) continue;
    const path = join(findingsDir, f);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      invalid.push({ file: path, errors: [`unparseable JSON: ${e.message}`] });
      continue;
    }
    if (f === 'gut-check.json') {
      const errors = validate(parsed, GUT_CHECK_SCHEMA);
      if (errors.length) invalid.push({ file: path, errors });
      else gut = parsed;
      continue;
    }
    const errors = validate(parsed, FINDINGS_SCHEMA);
    if (parsed?.reviewer !== f.replace(/\.json$/, '')) errors.push('reviewer identity does not match the expected task');
    if (!emitted.includes(f.replace(/\.json$/, ''))) errors.push('report does not belong to an emitted task');
    if (errors.length) {
      invalid.push({ file: path, errors });
      continue;
    }
    reports.push(parsed);
    for (const bf of parsed.blockingFindings)
      raw.push({ ...bf, source: parsed.reviewer });
  }

  state.coverage = {
    expected: emitted, completed: [...(gut ? ['gut-check'] : []), ...reports.map((report) => report.reviewer)],
    missing, invalid,
  };

  // Gut-check `block` → hard stop for the human, before any validator spend.
  if (gut) {
    const knownSources = ROSTER.map((r) => r.id);
    raw.push(...gutRoutedFindings(gut.observations, knownSources));
    const blocks = gutBlockEntries(state.ledger, state.round, gut.observations);
    if (blocks.length) {
      state.phase = 'done';
      state.verdict = ledgerVerdict(state.ledger, false);
      saveState(args, state);
      out({
        action: 'hard-stop',
        reason: 'gut-check block: work outside the ticket requirements — the human decides',
        blocks: blocks.map(ledgerEntryFinding),
        missing,
        invalid,
      });
      return;
    }
  }

  if (missing.length || invalid.length) {
    state.phase = 'decide';
    state.verdict = 'incomplete — missing or invalid reviewer reports';
    saveState(args, state);
    out({ action: 'incomplete', findingCount: raw.length, missing, invalid, coverage: state.coverage,
      validator: null, missingReports: 're-run those reviewers once; incomplete coverage cannot converge',
      next: 're-run missing/invalid tasks, then collect again; if still incomplete, report the blocker and resume this round later' });
    return;
  }
  state.verdict = null;

  // Reuse-audit clean pass: unchanged added-file set + provenance since this
  // clean report → the reviewer is skipped on later fix rounds.
  const reuse = reports.find((r) => r.reviewer === 'codebase-pattern-reviewer');
  if (reuse && reuse.blockingFindings.length === 0)
    state.reuseCleanAt = state.planMeta?.reuseFp ?? null;

  const { kept, suppressed } = ledgerSuppress(state.ledger, raw);
  kept.forEach((f, i) => (f.id = `R${state.round}-${String(i + 1).padStart(2, '0')}`));

  const validateDir = join(roundDir, 'validate');
  mkdirSync(validateDir, { recursive: true });
  writeFileSync(join(validateDir, 'findings.json'), JSON.stringify(kept, null, 2) + '\n');

  state.phase = 'decide';
  let validator = null;
  if (kept.length) {
    const outputFile = join(validateDir, 'verdicts.json');
    const promptFile = join(validateDir, 'validator-prompt.md');
    writeFileSync(
      promptFile,
      prompts.validatorPrompt(contractText(args, state), fmtFeedback(kept), inspectCmds(state).diffCmd, outputFile),
    );
    validator = persistTask(args, state, {
      id: 'pr-relevance-validator',
      agentFile: join(PLUGIN_ROOT, 'agents', 'pr-relevance-validator.md'),
      model: agentModel('pr-relevance-validator'),
      effort: agentEffort('pr-relevance-validator'),
      promptFile,
      outputFile,
    }, 'reviewer', VALIDATION_SCHEMA);
  }
  state.pendingFindings = kept;
  state.tasks = validator ? [validator] : [];
  saveState(args, state);
  out({
    round: state.round,
    findingCount: kept.length,
    suppressed: suppressed.map((f) => f.title),
    missing,
    invalid,
    missingReports: '',
    validator,
    next: kept.length
      ? 'run the validator, then `decide --verdicts <outputFile>`'
      : 'no findings to validate — run `decide` directly',
  });
}

function cmdDecide(args) {
  const state = loadState(args);
  if (state.phase !== 'decide') die(`phase is "${state.phase}", expected "decide"`);
  if (!state.coverage || state.coverage.missing.length || state.coverage.invalid.length) {
    state.phase = 'collect';
    state.verdict = 'incomplete — missing or invalid reviewer reports';
    saveState(args, state);
    out({ action: 'incomplete', verdict: state.verdict, coverage: state.coverage,
      next: 'complete the missing/invalid tasks and collect again; do not open a PR from this run yet' });
    return;
  }
  const dir = runDir(args);
  const roundDir = join(dir, `round-${state.round}`);

  // Gate injection: a red gate spends the round on a gate-fix pass instead of
  // reviewer findings (reviewers never see red code / uncommitted work).
  const testsGreen = args['tests-green'] === undefined ? true : bool(args['tests-green']);
  const committed = args.committed === undefined ? true : bool(args.committed);
  const gateFindings = [
    ...(testsGreen ? [] : [TESTS_GATE_FINDING]),
    ...(committed ? [] : [UNCOMMITTED_FINDING]),
  ];
  const gateCleared =
    (state.gates.testsGreen === false && testsGreen) ||
    (state.gates.committed === false && committed);
  state.gates = { testsGreen, committed };

  const verdicts = args.verdicts
    ? readJson(args.verdicts, VALIDATION_SCHEMA, 'verdicts').verdicts
    : [];
  const expected = (state.pendingFindings || []).map((finding) => finding.id);
  if (verdicts.length !== expected.length || new Set(verdicts.map((v) => v.id)).size !== verdicts.length ||
      verdicts.some((v) => !expected.includes(v.id))) {
    die('Incomplete validator result: classify every pending finding exactly once before deciding');
  }
  const validated = classifyFindings(state.pendingFindings || [], verdicts);
  ledgerIngest(state.ledger, state.round, validated);
  state.pendingFindings = [];

  // Review-only run: the classified findings ARE the result — no fix pass, no
  // adjudication (disputes only exist after a fix pass), verdict in report
  // language rather than loop language.
  if (state.reviewOnly) {
    const open = ledgerOpenBlocking(state.ledger);
    state.phase = 'done';
    state.verdict = open.length
      ? `${open.length} blocking finding(s) (${open.map((e) => e.id).join(', ')})`
      : 'clean';
    saveState(args, state);
    out({
      action: 'report',
      verdict: state.verdict,
      open: open.map(ledgerEntryFinding),
      next: 'run `report` — review-only: findings are the deliverable, nothing gets fixed here',
    });
    return;
  }

  const prev = state.snapshots[state.snapshots.length - 1];
  const { progressed, snapshot } = ledgerProgress(prev, state.ledger, gateCleared);
  state.snapshots.push(snapshot);
  state.stalledRounds = progressed ? 0 : state.stalledRounds + 1;

  const open = ledgerOpenBlocking(state.ledger);
  const targets = gateFindings.length ? gateFindings : open.map(ledgerEntryFinding);
  const disputed = state.ledger.entries.filter((e) => e.status === 'disputed');

  let action;
  if (!targets.length) action = 'converged';
  else if (state.round >= maxRounds(state)) action = 'stalled';
  else if (state.stalledRounds >= LEDGER_STALL_LIMIT) action = 'stalled';
  else action = 'fix';

  if (action === 'fix') {
    const outputFile = join(roundDir, 'fix-result.json');
    const promptFile = join(roundDir, 'fix.md');
    writeFileSync(
      promptFile,
      prompts.fixPrompt(
        contractText(args, state),
        targets,
        inspectCmds(state).diffCmd,
        args['commit-rule'] || '',
        outputFile,
      ),
    );
    state.phase = 'fix';
    state.fixTargets = targets.map((t) => t.id);
    state.tasks = [persistTask(args, state, { id: 'fix', promptFile, outputFile }, 'fixer', FIX_RESULT_SCHEMA)];
    saveState(args, state);
    out({
      action,
      round: state.round,
      gateFindings: gateFindings.map((f) => f.title),
      targets,
      fix: state.tasks[0],
      next: 'run one fresh fix implementer with the prompt, then `apply-fix --result <outputFile>`',
    });
    return;
  }

  // Loop is ending — disputed entries go to the adjudicator before the verdict.
  if (disputed.length) {
    state.phase = 'adjudicate';
    saveState(args, state);
    out({
      action: 'adjudicate',
      pendingVerdict: action,
      disputed: disputed.map(ledgerEntryFinding),
      next: 'run `adjudicate`, the adjudicator agent, then `apply-adjudication --rulings <file>`',
    });
    return;
  }
  state.phase = 'done';
  state.tasks = [];
  state.verdict = ledgerVerdict(state.ledger, action === 'converged');
  saveState(args, state);
  out({ action, verdict: state.verdict, open: open.map(ledgerEntryFinding) });
}

function cmdApplyFix(args) {
  const state = loadState(args);
  if (state.phase !== 'fix') die(`phase is "${state.phase}", expected "fix"`);
  if (!args.result) die('--result <fix-result.json> is required');
  const fix = readJson(args.result, FIX_RESULT_SCHEMA, 'fix result');
  const targets = state.ledger.entries.filter((e) =>
    (state.fixTargets || []).includes(e.id),
  );
  ledgerApplyFix(targets, fix);
  if (fix.head) state.headHistory.push(fix.head);
  state.fixTargets = [];
  state.gates = { testsGreen: fix.testsGreen, committed: fix.committed };
  state.round += 1;
  state.phase = 'plan';
  state.tasks = [];
  saveState(args, state);
  out({
    action: 'review',
    round: state.round,
    disputed: (fix.disputed || []).map((d) => d.id || d.title),
    next: `run \`plan\` for round ${state.round} with the fix range's changed files`,
  });
}

function cmdAdjudicate(args) {
  const state = loadState(args);
  if (state.phase !== 'adjudicate') die(`phase is "${state.phase}", expected "adjudicate"`);
  const disputed = state.ledger.entries.filter((e) => e.status === 'disputed');
  if (!disputed.length) {
    state.phase = 'done';
    state.verdict = ledgerVerdict(state.ledger, !ledgerOpenBlocking(state.ledger).length);
    saveState(args, state);
    out({ action: 'done', verdict: state.verdict });
    return;
  }
  const dir = join(runDir(args), 'adjudication');
  mkdirSync(dir, { recursive: true });
  const outputFile = join(dir, 'rulings.json');
  const promptFile = join(dir, 'prompt.md');
  writeFileSync(
    promptFile,
    prompts.adjudicatorPrompt(contractText(args, state), disputed, inspectCmds(state).diffCmd, outputFile),
  );
  state.tasks = [persistTask(args, state, { id: 'adjudicator', promptFile, outputFile }, 'adjudicator', ADJUDICATION_SCHEMA)];
  saveState(args, state);
  out({
    disputed: disputed.map(ledgerEntryFinding),
    adjudicator: state.tasks[0],
    next: 'run ONE fresh agent with the prompt (never the fix implementer), then `apply-adjudication --rulings <outputFile>`',
  });
}

function cmdApplyAdjudication(args) {
  const state = loadState(args);
  if (state.phase !== 'adjudicate') die(`phase is "${state.phase}", expected "adjudicate"`);
  if (!args.rulings) die('--rulings <rulings.json> is required');
  const { rulings } = readJson(args.rulings, ADJUDICATION_SCHEMA, 'rulings');
  const upheld = applyAdjudication(state.ledger, rulings);
  state.phase = 'done';
  // Upheld findings reopen and are never re-looped — they ship in the stalled
  // verdict for the human. Convergence requires zero open blocking findings.
  state.verdict = ledgerVerdict(state.ledger, !ledgerOpenBlocking(state.ledger).length);
  saveState(args, state);
  out({ action: 'done', upheld: upheld.map(ledgerEntryFinding), verdict: state.verdict });
}

function cmdReport(args) {
  const state = loadState(args);
  // Classified view (confidence + diffCaused ride along) so a report consumer
  // can present blocking / advisory / unverified without re-deriving thresholds.
  const classified = (e) => ({
    ...ledgerEntryFinding(e),
    confidence: e.confidence ?? null,
    diffCaused: e.diffCaused ?? null,
  });
  const entries = state.ledger.entries;
  out({
    slice: state.slice,
    round: state.round,
    phase: state.phase,
    verdict: state.verdict ?? '(loop still running)',
    coverage: state.coverage ?? null,
    report: ledgerReport(state.ledger),
    blocking: entries
      .filter((e) => e.status === 'open' && e.severity === 'blocking')
      .map(classified),
    advisoryNotes: entries
      .filter((e) => e.status === 'open' && e.severity === 'advisory')
      .map(classified),
    unverified: entries.filter((e) => e.status === 'dropped').map(classified),
  });
}

function cmdStatus(args) {
  const state = loadState(args);
  out({
    slice: state.slice,
    base: state.base,
    round: state.round,
    phase: state.phase,
    verdict: state.verdict,
    stalledRounds: state.stalledRounds,
    openBlocking: ledgerOpenBlocking(state.ledger).map((e) => e.id),
    entries: state.ledger.entries.length,
    coverage: state.coverage ?? null,
    tasks: state.phase === 'done' ? [] : (state.tasks || []).filter((task) => {
      try {
        const result = JSON.parse(readFileSync(task.outputFile, 'utf8'));
        return validate(result, task.schema).length > 0 || (result?.reviewer && result.reviewer !== task.id);
      } catch { return true; }
    }),
  });
}

function cmdModel(args) {
  const role = args.role || SKILL_ROLES[args.skill];
  if (role === 'inherit') {
    out({ role, next: 'inherit the caller\'s explicitly resolved model role' });
    return;
  }
  out(resolveModel(loadCfg(args), { role, runtime: args.runtime, cloud: bool(args.cloud) }));
}

async function cmdRun(args) {
  if (!args.task || !args.runtime) die('run requires --task <task.json> --runtime claude|codex');
  const task = readJson(args.task, null, 'task');
  out(await runTask(task, args.runtime, { dryRun: bool(args['dry-run']) }));
}

function cmdTask(args) {
  const schemas = { implement: IMPLEMENT_RESULT_SCHEMA, fix: FIX_RESULT_SCHEMA, findings: FINDINGS_SCHEMA,
    validation: VALIDATION_SCHEMA, adjudication: ADJUDICATION_SCHEMA, gut: GUT_CHECK_SCHEMA, 'babysit-fix': BABYSIT_FIX_SCHEMA };
  if (!args['prompt-file'] || !args['output-file'] || !args.role || !schemas[args.schema]) {
    die('task requires --role, --prompt-file, --output-file, --schema implement|fix|findings|validation|adjudication|gut');
  }
  const agentFile = args.agent ? join(PLUGIN_ROOT, 'agents', `${args.agent}.md`) : undefined;
  if (agentFile && !existsSync(agentFile)) die(`Unknown agent: ${args.agent}`);
  out(persistTask(args, {}, { id: args.agent || args.role, agentFile,
    promptFile: args['prompt-file'], outputFile: args['output-file'] }, args.role, schemas[args.schema]));
}

function cmdSnapshot(args) {
  if (!args.output) die('snapshot requires --output <config.md>');
  let cfg;
  if (args.ref) {
    if (String(args.ref).startsWith('-')) die('Invalid planning ref');
    const raw = execFileSync('git', ['show', `${args.ref}:docs/agents/repo-config.md`], { encoding: 'utf8' });
    cfg = resolveRepoConfig(parseRepoConfig(raw, String(args.ref)));
  } else cfg = loadCfg(args);
  mkdirSync(dirname(resolve(args.output)), { recursive: true });
  writeFileSync(args.output, `## Config\n\n\`\`\`json\n${JSON.stringify(cfg, null, 2)}\n\`\`\`\n`);
  out({ configFile: resolve(args.output), ref: args.ref || null });
}

const COMMANDS = {
  init: cmdInit,
  plan: cmdPlan,
  collect: cmdCollect,
  decide: cmdDecide,
  'apply-fix': cmdApplyFix,
  adjudicate: cmdAdjudicate,
  'apply-adjudication': cmdApplyAdjudication,
  report: cmdReport,
  status: cmdStatus,
  model: cmdModel,
  run: cmdRun,
  task: cmdTask,
  snapshot: cmdSnapshot,
};

const [, , cmd, ...rest] = process.argv;
const handler = COMMANDS[cmd];
if (!handler)
  die(`unknown command "${cmd || ''}" — one of: ${Object.keys(COMMANDS).join(', ')}`);
try {
  await handler(parseArgs(rest));
} catch (error) {
  die(error.message);
}
