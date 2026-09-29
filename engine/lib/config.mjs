// Host repo-config loading + resolution. The host's half of the contract is
// exactly one file: docs/agents/repo-config.md with a fenced ```json block
// under a `## Config` heading. Everything else falls back to the generic
// defaults so a repo that supplies nothing still gets a working (blunter)
// review.
import { readFileSync } from 'node:fs';
import { REPO_CONFIG_DEFAULTS } from './defaults.mjs';
import { ROLE_MODELS, resolveModel } from './models.mjs';
import { compilePattern } from './commit.mjs';

// Merge the host's repoConfig over the generic defaults, two levels deep so a
// host that sets only `reviewers.database` keeps the generic lens for the rest.
// Arrays and strings replace wholesale; empty values never win.
export function resolveRepoConfig(rawConfig) {
  validateRepoConfig(rawConfig ?? {});
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

export function loadRepoConfig(mdPath) {
  let text;
  try {
    text = readFileSync(mdPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read config ${mdPath}: ${error.message}`);
  }
  return parseRepoConfig(text, mdPath);
}

export function parseRepoConfig(text, mdPath = '(inline)') {
  const section = text.split(/^##\s+Config\s*$/m)[1]?.split(/^##\s/m)[0];
  const m = /```json\s*\n([\s\S]*?)```/.exec(section || '');
  if (!m) throw new Error(`Config ${mdPath} must contain a fenced JSON object under ## Config`);
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch (error) {
    throw new Error(`Invalid JSON config ${mdPath}: ${error.message}`);
  }
  validateRepoConfig(parsed);
  return parsed;
}

export function validateRepoConfig(config) {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(config)) throw new Error('Repo config must be an object');
  function check(value, template, path) {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(template)) {
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    } else if (object(template)) {
      if (!object(value)) throw new Error(`${path} must be an object`);
      for (const [key, entry] of Object.entries(value)) {
        if (key in template) check(entry, template[key], `${path}.${key}`);
      }
    } else if (typeof value !== typeof template) {
      throw new Error(`${path} must be ${typeof template}`);
    }
  }
  check(config, REPO_CONFIG_DEFAULTS, 'config');
  if (config.commit?.pattern) compilePattern(config.commit.pattern);
  if (config.routing?.dispatch && !['cloud', 'local'].includes(config.routing.dispatch)) {
    throw new Error('routing.dispatch must be cloud or local');
  }
  for (const [alias, model] of Object.entries(config.routing?.codexModelAliases || {})) {
    if (typeof model !== 'string' || !model.trim()) throw new Error(`Invalid Codex alias: ${alias}`);
  }
  for (const [role, runtimes] of Object.entries(config.routing?.models || {})) {
    if (!ROLE_MODELS[role] || !object(runtimes)) throw new Error(`Invalid model role: ${role}`);
    for (const [runtime, profile] of Object.entries(runtimes)) {
      if (!['claude', 'codex'].includes(runtime) || !object(profile)) throw new Error(`Invalid profile: ${role}.${runtime}`);
      for (const key of Object.keys(profile)) {
        if (!['model', 'effort', 'cloudModel', 'timeoutMs', 'access'].includes(key)) throw new Error(`Unknown model setting: ${key}`);
      }
      resolveModel(config, { role, runtime });
      resolveModel(config, { role, runtime, cloud: true });
    }
  }
}

// Where a reuse search starts. Host repos name their own source roots; with
// none configured the reviewers search the whole tree.
export function sourceRootsText(cfg) {
  const dirs = (cfg && cfg.sourceDirs) || [];
  return dirs.length ? dirs.join(', ') : "the repo's source tree";
}

// The repo's written conventions file (CLAUDE.md, AGENTS.md, CONTRIBUTING.md …).
export function conventionsFile(cfg) {
  return (cfg && cfg.conventionsFile) || 'the repo conventions file';
}

export function buildLibMap(cfg) {
  const map = (cfg && cfg.libMap) || {};
  return Object.keys(map).length
    ? Object.entries(map)
        .map(([lib, purpose]) => `- ${lib}: ${purpose}`)
        .join('\n')
    : '';
}

export function buildGoldenPaths(cfg) {
  const map = (cfg && cfg.goldenPaths) || {};
  return Object.keys(map).length
    ? Object.entries(map)
        .map(([layer, file]) => `- ${layer}: ${file}`)
        .join('\n')
    : '';
}

// Host focus overlay for a set of triggered areas: the `reviewers.<area>`
// entries whose area is in `areas`. Returns [{area, skills, focus}] — additive
// prompt material, never a lane source.
export function focusOverlay(cfg, areas) {
  const rvw = (cfg && cfg.reviewers) || {};
  const out = [];
  for (const area of areas || []) {
    const def = rvw[area];
    if (!def || (!def.focus && !def.skills)) continue;
    out.push({ area, skills: def.skills || '', focus: def.focus || '' });
  }
  return out;
}
