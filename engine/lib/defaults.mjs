// Generic, host-agnostic fallbacks for every `repoConfig` key. A host repo
// overrides any subset from its docs/agents/repo-config.md `## Config` block;
// resolveRepoConfig() in config.mjs merges the two, two levels deep. Nothing
// here may name a framework, path, package, or skill that only one repo has —
// that is what the host file is for. See CONTRACT.md.
//
// Empty string / empty object means "not knowable generically": the skill or
// engine degrades gracefully and says so rather than guessing.
export const REPO_CONFIG_DEFAULTS = {
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
  // PR review bots, driven by babysit-stack in order: botReviewer (requested
  // via the reviewers API, e.g. Copilot) runs rounds until it is satisfied,
  // then commentReviewer (triggered by a PR comment, e.g. CodeRabbit's
  // `@coderabbitai review`) is the terminal reviewer. '' → that phase is skipped. Bot
  // reviews happen on GitHub only — there is no review-CLI lane in the loop.
  pr: {
    titleRule: '',
    scopes: [],
    stackTool: '',
    botReviewer: '',
    commentReviewer: { login: '', command: '' },
    // Orphan branch PR evidence media is committed to (pr/<n>/…) and linked
    // from PR bodies by commit sha. Created on first publish; never merged.
    mediaBranch: 'pr-media',
  },
  // Commit-subject rule every suite commit must satisfy (engine/lib/commit.mjs).
  // format: human template, e.g. `<type>[(<scope>)]: SER-XX <subject>`;
  // pattern: anchored regex the subject must match (e.g. a branch ruleset's
  // commit_message_pattern). Both '' → derived from pr.titleRule / pr.scopes,
  // else a plain `<type>: <subject>`. Never "starts with the issue id".
  commit: {
    format: '',
    pattern: '',
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
  // Design-fidelity extension point. fidelityCheck names a REPO-LOCAL skill or
  // command (the repo owns the mechanics — Figma access is never assumed);
  // '' → the fidelity step doesn't exist. See CONTRACT.md for the I/O shape.
  design: {
    fidelityCheck: '',
  },
  // Legacy routing keys remain compatible; explicit worker profiles live in models.mjs.
  routing: {
    models: {},
    labelPrefix: '',
    frontendAgent: '',
    delegate: {},
    dispatch: 'cloud',
    cloudModels: {
      claude: { model: 'opus-5-5-1m', effort: 'high' },
      codex: { model: 'gpt-6.1-sol', effort: 'high' },
    },
    // Translate the existing Claude roster pins for Codex workers.
    codexModelAliases: {
      sonnet: 'gpt-6.1-sol',
      opus: 'gpt-6.1-sol',
    },
  },
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
  // lib path → one-line purpose; the reuse audit's search index.
  // {} → the reuse audit searches sourceDirs blind (slower, still strict).
  libMap: {},
  // Per-area reviewer FOCUS OVERLAY. Additive: the roster in roster.mjs is the
  // lane source; whatever a host writes here is appended to the prompts of the
  // reviewers covering that area, never a replacement for them. Generic by
  // design: no framework, path or skill names.
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
