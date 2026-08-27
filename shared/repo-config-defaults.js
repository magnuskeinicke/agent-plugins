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
