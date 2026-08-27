// Generates repo-config-defaults.js from the `## Config` JSON block in
// docs/agents/repo-config.md, so the workflow scripts' built-in fallbacks can
// never drift from the documented config. Invoked by sync.sh only.
//
// Usage: node gen-repo-config-defaults.mjs <repo-config.md> <output.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const [mdPath, outPath] = process.argv.slice(2);
if (!mdPath || !outPath) {
  console.error(
    'usage: gen-repo-config-defaults.mjs <repo-config.md> <output.js>',
  );
  process.exit(1);
}

const md = readFileSync(mdPath, 'utf8');
const match = md.match(/## Config[\s\S]*?```json\n([\s\S]*?)```/);
if (!match) {
  console.error(`no \`\`\`json block under "## Config" in ${mdPath}`);
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(match[1]);
} catch (e) {
  console.error(`invalid JSON in ${mdPath} ## Config block: ${e.message}`);
  process.exit(1);
}

const header =
  "// GENERATED from the host repo's docs/agents/repo-config.md ## Config block —\n" +
  "// edit the md, then run the plugin's shared/sync.sh. Do not edit by hand.\n";
const raw = `${header}const REPO_CONFIG_DEFAULTS = ${JSON.stringify(cfg)};\n`;

// Format with the HOST repo's prettier config so the generated file (and the
// blocks synced into the workflow scripts) match that repo's style. Resolve
// prettier and the config from the host repo, not from this plugin and not from
// the output path — this file lives in the plugin, and --check mode generates
// into a temp dir outside both. The host root is derived from the md path
// (<host>/docs/agents/repo-config.md), so no extra argument is needed.
const repoRoot = resolve(dirname(mdPath), '..', '..');
const require = createRequire(import.meta.url);
const prettier = require(require.resolve('prettier', { paths: [repoRoot] }));
const options = (await prettier.resolveConfig(mdPath)) ?? {};
const formatted = await prettier.format(raw, { ...options, parser: 'babel' });

writeFileSync(outPath, formatted);
