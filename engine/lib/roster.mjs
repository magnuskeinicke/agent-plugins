// The reviewer roster — vendored from kramme-cc-workflow (MIT, see
// agents/sources.yaml) and mapped onto deterministic triggers. This file is
// the lane source; the host repo's `repoConfig.reviewers` / `areaPaths` are an
// ADDITIVE focus overlay on top of it, never a replacement (CONTRACT.md).
//
// One roster file serves both runtimes: on Claude the agent definition in
// agents/<id>.md is a spawnable subagent; on Codex the same file's body is the
// `codex exec` child's system prompt. The engine emits the per-run prompt
// either way.

const TEST_FILE_RE =
  /(\.|_|-)(test|spec)s?\.|(^|\/)(tests?|specs?|__tests__|e2e)\//i;
const TYPE_FILE_RE =
  /\.d\.ts$|(^|\/)(types?|interfaces?|models?|schemas?)\/|schema\.(ts|js|py|sql|prisma)$|\.proto$/i;
const DOCS_FILE_RE = /\.(md|mdx|rst|txt)$|(^|\/)docs?\//i;

export const CONVENTION_DRIFT_FILE_GATE = 10;
export const SCOPE_LANE_INSERTION_GATE = 150;

// input: {round, areas, changedFiles, addedFiles, deletedFiles, insertions,
// userFacing, hints, openSources, reuseClean}
// Every rule below must be a pure function of that input — selection is
// deterministic CLI output, never prose discipline.
export const ROSTER = [
  // Always-on tier: broad regressions across stack types (kramme taxonomy),
  // re-run every round.
  { id: 'code-reviewer', tier: 'always' },
  { id: 'silent-failure-hunter', tier: 'always' },
  { id: 'deslop-reviewer', tier: 'always' },

  // Round-1 tier: run once on the full slice diff; later rounds only re-run
  // them when they own an open finding (openSources).
  // One invocation covers the lean, removal, refactor and simplify
  // dimensions (kramme merged lean-reviewer, code-simplifier and
  // removal-planner into it).
  {
    id: 'cleanup-reviewer',
    tier: 'round1',
    // Deletions need their reference trace re-checked on the fix round that
    // made them.
    when: (i) => i.deletedFiles.length > 0 || i.hints.includes('removal'),
  },
  {
    id: 'codebase-pattern-reviewer',
    tier: 'round1',
    mode: 'diff reuse audit mode',
    // Re-runs on fix rounds until a clean pass with an unchanged added-file
    // set + provenance table (the CLI tracks the fingerprint).
    rerun: (i) => !i.reuseClean,
  },
  {
    // Every code diff carries comments and names, so the old docs-file trigger
    // meant this lane never ran on the slices that needed it. Naming and
    // comment debt is a slice-wide concern, judged once on the full diff; the
    // `when` below only re-triggers it on a fix round whose range touched
    // docs/markdown.
    id: 'comment-analyzer',
    tier: 'round1',
    when: (i) =>
      i.changedFiles.some((f) => DOCS_FILE_RE.test(f)) ||
      i.hints.includes('comments'),
  },

  // Conditional tier: mechanical triggers on the round's diff scope.
  {
    id: 'pr-test-analyzer',
    when: (i) =>
      i.changedFiles.some((f) => TEST_FILE_RE.test(f)) ||
      i.addedFiles.length > 0,
  },
  {
    id: 'type-design-analyzer',
    when: (i) =>
      i.changedFiles.some((f) => TYPE_FILE_RE.test(f)) ||
      i.hints.includes('types'),
  },
  {
    id: 'convention-drift-reviewer',
    mode: 'convention review mode',
    when: (i) =>
      i.changedFiles.length >= CONVENTION_DRIFT_FILE_GATE ||
      i.hints.includes('conventions'),
  },
  {
    id: 'overengineering-reviewer',
    mode: 'necessity-review mode',
    when: (i) =>
      i.addedFiles.length > 0 || i.insertions > SCOPE_LANE_INSERTION_GATE,
  },

  // Stack-specific tier: risk-surface triggers via the area mapping.
  {
    id: 'performance-oracle',
    when: (i) =>
      ['performance', 'backend', 'database'].some((a) => i.areas.includes(a)),
  },
  // One invocation runs all four security lenses (injection, access control,
  // data protection, logic).
  { id: 'security-reviewer', when: (i) => i.areas.includes('security') },
  // UI tier.
  { id: 'a11y-auditor', when: (i) => i.areas.includes('frontend') },
  {
    id: 'copy-reviewer',
    when: (i) => i.areas.includes('frontend') && i.userFacing,
  },
];

// Roster members that never join the fix loop: pr-relevance-validator is the
// validator stage, and the rest (architecture-strategist, design-iterator,
// product-reviewer, ux-reviewer, visual-reviewer) belong to other skills'
// flows. They stay vendored in agents/ for those uses.
export const OFF_LOOP = [
  'pr-relevance-validator',
  'architecture-strategist',
  'design-iterator',
  'product-reviewer',
  'ux-reviewer',
  'visual-reviewer',
];

// Overlay areas per reviewer: which host `reviewers.<area>` focus overlays a
// reviewer's prompt picks up (intersected with the round's triggered areas).
// '*' = all triggered areas (the generalists).
export const OVERLAY_AREAS = {
  'code-reviewer': ['*'],
  'silent-failure-hunter': ['backend', 'database', 'security'],
  'deslop-reviewer': [],
  'cleanup-reviewer': ['*'],
  'codebase-pattern-reviewer': ['*'],
  'pr-test-analyzer': [],
  'comment-analyzer': [],
  'type-design-analyzer': ['database'],
  'convention-drift-reviewer': ['*'],
  'overengineering-reviewer': [],
  'performance-oracle': ['performance', 'backend', 'database'],
  'security-reviewer': ['security'],
  'a11y-auditor': ['frontend'],
  'copy-reviewer': ['frontend', 'i18n'],
};

function normalizeInput(raw) {
  return {
    round: raw.round || 1,
    areas: raw.areas || [],
    changedFiles: raw.changedFiles || [],
    addedFiles: raw.addedFiles || [],
    deletedFiles: raw.deletedFiles || [],
    insertions: raw.insertions || 0,
    userFacing: Boolean(raw.userFacing),
    hints: raw.hints || [],
    openSources: raw.openSources || [],
    reuseClean: Boolean(raw.reuseClean),
  };
}

// Deterministic reviewer selection for one round.
// Round 1: always + round1 + every triggered conditional.
// Round >1 (fix rounds): always + owners of open findings + conditionals
// re-triggered by the fix range's files + round1 members with a rerun() rule.
export function selectReviewers(rawInput) {
  const input = normalizeInput(rawInput);
  const selected = [];
  const skipped = [];
  for (const r of ROSTER) {
    const wants =
      r.tier === 'always'
        ? true
        : input.round === 1
          ? r.tier === 'round1' || (r.when && r.when(input))
          : input.openSources.includes(r.id) ||
            (r.rerun && r.rerun(input)) ||
            (r.when && r.when(input));
    if (wants)
      selected.push({ id: r.id, ...(r.mode ? { mode: r.mode } : {}) });
    else if (input.round === 1 && r.when)
      skipped.push({ id: r.id, reason: 'trigger not met' });
    else if (input.round > 1)
      skipped.push({ id: r.id, reason: 'not re-triggered this fix round' });
  }
  return { selected, skipped };
}

// The overlay entries a given reviewer's prompt should carry, given the
// round's triggered areas and the host's resolved `reviewers` config.
export function overlayFor(reviewerId, areas, overlayEntries) {
  const tags = OVERLAY_AREAS[reviewerId] || [];
  if (!tags.length) return [];
  if (tags.includes('*')) return overlayEntries;
  return overlayEntries.filter((o) => tags.includes(o.area));
}
