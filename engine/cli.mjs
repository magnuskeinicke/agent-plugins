#!/usr/bin/env node
// Reviewer-engine CLI — the deterministic loop controller for the review
// skills (work-slice, iterate-pr, review-code, solve-ready-tickets). The
// orchestrating agent runs reviewers however its runtime allows (Claude Agent
// tool, Codex `codex exec` children, or inline-sequential as the disclosed
// fallback); every decision — reviewer selection, suppression, classification
// thresholds, fix targets, stall/cap stops, the final verdict — comes from
// this CLI's JSON output, never from prose discipline.
//
// State lives in the HOST repo's gitignored `.context/<slice-id>/`:
//   ledger.json                    the run state + finding ledger
//   contract.md                    the run contract (ticket AC etc.), init input
//   round-N/prompts/<id>.md        emitted task prompts
//   round-N/findings/<id>.json     the findings inbox reviewers write into
//   round-N/validate/…             validator input/output
//   round-N/fix.md / fix-result.json
//
// Usage: node cli.mjs <command> --slice <id> [options]  (run from the host
// repo root; `--dir` overrides the `.context` parent). Every command prints a
// single JSON object on stdout.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  copyFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRepoConfig, loadRepoConfig, focusOverlay, buildLibMap, buildGoldenPaths } from './lib/config.mjs';
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
import { FINDINGS_SCHEMA, VALIDATION_SCHEMA, ADJUDICATION_SCHEMA, FIX_RESULT_SCHEMA, GUT_CHECK_SCHEMA, validate } from './lib/schemas.mjs';
import * as prompts from './lib/prompts.mjs';

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
    'The implementer reported committed=false. Reviewers inspect `git diff <base>...HEAD`, which cannot see uncommitted work. Commit everything and report committed=true plus the new `head`.',
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
  return JSON.parse(readFileSync(p, 'utf8'));
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

function loadCfg(args) {
  const raw = args.config
    ? loadRepoConfig(args.config)
    : loadRepoConfig('docs/agents/repo-config.md');
  return resolveRepoConfig(raw);
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
    const state = JSON.parse(readFileSync(p, 'utf8'));
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
    saveState(args, state);
    out({
      action: 'gate-fix',
      round: state.round,
      gateFindings: gateFindings.map((f) => f.title),
      fix: { promptFile, outputFile },
      next: 'run one fix implementer with the prompt, then `apply-fix --result <outputFile>` — no reviewers run while a gate is red',
    });
    return;
  }

  const cfg = loadCfg(args);
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
    return {
      id: r.id,
      agentFile: join(PLUGIN_ROOT, 'agents', `${r.id}.md`),
      model: agentModel(r.id),
      effort: agentEffort(r.id),
      promptFile,
      outputFile,
    };
  });

  // Round-1 one-shots: the gut-check pre-pass (must run BEFORE the reviewers —
  // a `block` stops the run before any lane spend) and the CodeRabbit wrapper.
  // `--coderabbit-cmd` overrides the config value with a target-matched
  // invocation (uncommitted vs committed flags); `--no-coderabbit` skips the
  // lane when the CLI cannot run against this target (e.g. no checkout).
  let prePass = null;
  let coderabbit = null;
  if (state.round === 1) {
    const gutOut = join(findingsDir, 'gut-check.json');
    const gutPrompt = join(promptsDir, 'gut-check.md');
    writeFileSync(gutPrompt, prompts.gutCheckPrompt(contract, inspect, gutOut));
    prePass = { id: 'gut-check', promptFile: gutPrompt, outputFile: gutOut };
    const crCmd =
      typeof args['coderabbit-cmd'] === 'string' ? args['coderabbit-cmd'] : cfg.pr.cliReviewer;
    if (crCmd && !args['no-coderabbit']) {
      const crOut = join(findingsDir, 'coderabbit.json');
      const crPrompt = join(promptsDir, 'coderabbit.md');
      writeFileSync(crPrompt, prompts.coderabbitPrompt(contract, crCmd, crOut));
      coderabbit = { id: 'coderabbit', promptFile: crPrompt, outputFile: crOut };
    }
  }

  if (args.head) state.headHistory.push(args.head);
  state.phase = 'collect';
  state.planMeta = { areas, changedFiles: changedFiles.length, fixRange, reuseFp: fp };
  saveState(args, state);
  out({
    round: state.round,
    areas,
    prePass,
    coderabbit,
    reviewers,
    skipped,
    next: 'run the pre-pass first (round 1), then the reviewers in parallel if the runtime allows; every agent writes its JSON to its outputFile, then run `collect`',
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
  const emitted = existsSync(promptsDir)
    ? readdirSync(promptsDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
    : [];
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
    if (errors.length) {
      invalid.push({ file: path, errors });
      continue;
    }
    reports.push(parsed);
    for (const bf of parsed.blockingFindings)
      raw.push({ ...bf, source: parsed.reviewer });
  }

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
    validator = {
      id: 'pr-relevance-validator',
      agentFile: join(PLUGIN_ROOT, 'agents', 'pr-relevance-validator.md'),
      model: agentModel('pr-relevance-validator'),
      effort: agentEffort('pr-relevance-validator'),
      promptFile,
      outputFile,
    };
  }
  state.pendingFindings = kept;
  saveState(args, state);
  out({
    round: state.round,
    findingCount: kept.length,
    suppressed: suppressed.map((f) => f.title),
    missing,
    invalid,
    missingReports:
      missing.length || invalid.length
        ? 'missing/invalid reports listed above are EXCLUDED — re-run those reviewers once, or accept degraded coverage explicitly (zero findings only counts as clean when every reviewer reported)'
        : '',
    validator,
    next: kept.length
      ? 'run the validator, then `decide --verdicts <outputFile>`'
      : 'no findings to validate — run `decide` directly',
  });
}

function cmdDecide(args) {
  const state = loadState(args);
  if (state.phase !== 'decide') die(`phase is "${state.phase}", expected "decide"`);
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
    saveState(args, state);
    out({
      action,
      round: state.round,
      gateFindings: gateFindings.map((f) => f.title),
      targets,
      fix: { promptFile, outputFile },
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
  saveState(args, state);
  out({
    disputed: disputed.map(ledgerEntryFinding),
    adjudicator: { promptFile, outputFile },
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
  });
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
};

const [, , cmd, ...rest] = process.argv;
const handler = COMMANDS[cmd];
if (!handler)
  die(`unknown command "${cmd || ''}" — one of: ${Object.keys(COMMANDS).join(', ')}`);
handler(parseArgs(rest));
