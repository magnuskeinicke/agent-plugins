const profile = (claude, codex, effort, access) => ({
  claude: { model: claude, effort, access },
  codex: { model: codex, effort, access },
});

export const ROLE_MODELS = {
  planner: profile('opus', 'gpt-6-sol', 'xhigh', 'workspace-write'),
  implementer: profile('opus', 'gpt-6-sol', 'xhigh', 'workspace-write'),
  fixer: profile('opus', 'gpt-6-sol', 'xhigh', 'workspace-write'),
  adjudicator: profile('opus', 'gpt-6-sol', 'xhigh', 'read-only'),
  reviewer: profile('opus', 'gpt-6-sol', 'high', 'read-only'),
  verifier: profile('opus', 'gpt-6-sol', 'high', 'read-only'),
  explorer: profile('sonnet', 'gpt-5.6-terra', 'medium', 'read-only'),
  triage: profile('sonnet', 'gpt-5.6-terra', 'medium', 'read-only'),
  babysitter: {
    claude: { model: 'sonnet', effort: 'medium', access: 'workspace-write' },
    codex: { model: 'gpt-6-sol', effort: 'xhigh', access: 'workspace-write' },
  },
  dispatcher: profile('sonnet', 'gpt-6-luna', 'medium', 'workspace-write'),
};

export const SKILL_ROLES = {
  'feature-goal': 'planner', 'work-issue': 'implementer', 'work-slice': 'implementer',
  'iterate-pr': 'fixer', 'babysit-stack': 'babysitter', 'solve-ready-tickets': 'dispatcher',
  'daily-ticket-manager': 'triage', 'grill-with-docs': 'planner', 'to-prd': 'planner',
  'to-issues': 'planner', 'improve-codebase-architecture': 'planner', 'review-code': 'reviewer',
  'gut-check': 'reviewer', 'split-pr': 'planner', 'init-repo': 'planner',
  'gh-stack': 'inherit', 'conductor-workspace': 'inherit', 'verify-before-done': 'inherit',
  'write-comments': 'inherit',
};

const EFFORTS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
};

export function resolveModel(cfg, { role, runtime, modelAlias, effort, cloud = false }) {
  if (!ROLE_MODELS[role]) throw new Error(`Unknown model role: ${role}`);
  if (!EFFORTS[runtime]) throw new Error(`Unsupported runtime: ${runtime}`);
  const base = ROLE_MODELS[role][runtime];
  const result = { ...base, timeoutMs: 1_800_000 };
  if (modelAlias && modelAlias !== 'inherit') {
    result.model = runtime === 'claude' ? modelAlias : cfg.routing?.codexModelAliases?.[modelAlias];
    if (!result.model) throw new Error(`Unmapped ${runtime} model alias: ${modelAlias}`);
  } else if (runtime === 'codex' && !['dispatcher', 'babysitter'].includes(role)) {
    const alias = ROLE_MODELS[role].claude.model;
    result.model = cfg.routing?.codexModelAliases?.[alias] || base.model;
  }
  if (effort) result.effort = effort;
  const override = cfg.routing?.models?.[role]?.[runtime] || {};
  Object.assign(result, override);
  if (cloud) {
    result.model = override.cloudModel || (runtime === 'claude'
      ? ({ opus: 'opus-5-5-1m', sonnet: 'sonnet-5-1m' }[result.model] || result.model)
      : result.model);
    if (['planner', 'implementer', 'fixer'].includes(role) && !Object.keys(override).length) {
      Object.assign(result, cfg.routing?.cloudModels?.[runtime] || {});
    }
  }
  if (typeof result.model !== 'string' || !result.model.trim() || result.model === 'inherit') {
    throw new Error(`A concrete model is required for ${role}.${runtime}`);
  }
  if (!EFFORTS[runtime].includes(result.effort)) throw new Error(`Invalid effort for ${role}.${runtime}`);
  if (!['read-only', 'workspace-write'].includes(result.access)) throw new Error(`Invalid access for ${role}.${runtime}`);
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1) throw new Error(`Invalid timeout for ${role}.${runtime}`);
  return { runtime, role, ...result };
}

export function taskModels(cfg, role, pins = {}) {
  return Object.fromEntries(['claude', 'codex'].map((runtime) =>
    [runtime, resolveModel(cfg, { role, runtime, ...pins })]));
}
