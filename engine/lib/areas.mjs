// Deterministic path → area mapping. Areas feed reviewer selection (roster.mjs)
// and the host focus overlay (config.mjs); they are no longer review lanes of
// their own — the kramme roster is the lane source.
export const KNOWN_AREAS = [
  'frontend',
  'backend',
  'database',
  'i18n',
  'security',
  'performance',
];

export function compileAreaPaths(map) {
  return Object.entries(map || {}).map(([area, patterns]) => [
    area,
    (patterns || []).map((p) =>
      typeof p === 'string' ? new RegExp(p) : new RegExp(p.re, p.flags || ''),
    ),
  ]);
}

// path-triggered areas ∪ agent-declared areas, plus defensive enrichment:
// frontend always pulls the performance lens, backend always pulls security
// (those two areas rarely trigger by path alone).
export function selectAreas(compiledAreaPaths, changedFiles, declaredAreas) {
  const set = new Set();
  for (const f of changedFiles || [])
    for (const [area, regexes] of compiledAreaPaths)
      if (regexes.some((r) => r.test(f))) set.add(area);
  for (const a of declaredAreas || []) if (KNOWN_AREAS.includes(a)) set.add(a);
  if (set.has('frontend')) set.add('performance');
  if (set.has('backend')) set.add('security');
  return [...set];
}
