// Shared implement/fix-loop schemas — used only by loop-shaped workflows
// (work-slice-loop + iterate-pr in-repo; the personal-config solve-ready-loop
// syncs by hand).
// Synced by `.claude/skills/_shared/sync.sh` between the
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
