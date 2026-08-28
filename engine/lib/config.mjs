// Host repo-config loading + resolution. The host's half of the contract is
// exactly one file: docs/agents/repo-config.md with a fenced ```json block
// under a `## Config` heading. Everything else falls back to the generic
// defaults so a repo that supplies nothing still gets a working (blunter)
// review.
import { readFileSync } from 'node:fs';
import { REPO_CONFIG_DEFAULTS } from './defaults.mjs';

// Merge the host's repoConfig over the generic defaults, two levels deep so a
// host that sets only `reviewers.database` keeps the generic lens for the rest.
// Arrays and strings replace wholesale; empty values never win.
export function resolveRepoConfig(rawConfig) {
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

// Parse the `## Config` fenced json block out of a repo-config.md file.
// Returns {} when the file or block is missing — absence is a supported state.
export function loadRepoConfig(mdPath) {
  let text;
  try {
    text = readFileSync(mdPath, 'utf8');
  } catch {
    return {};
  }
  const section = text.split(/^##\s+Config\s*$/m)[1];
  const m = /```json\s*\n([\s\S]*?)```/.exec(section ?? text);
  if (!m) return {};
  try {
    const parsed = JSON.parse(m[1]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
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
