// Generates repo-config-defaults.js from the `## Config` JSON block in
// docs/agents/repo-config.md, so the workflow scripts' built-in fallbacks can
// never drift from the documented config. Invoked by sync.sh only.
//
// Usage: node gen-repo-config-defaults.mjs <repo-config.md> <output.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  "// GENERATED from docs/agents/repo-config.md's ## Config block — edit the md,\n" +
  '// then run .claude/skills/_shared/sync.sh. Do not edit by hand.\n';
const raw = `${header}const REPO_CONFIG_DEFAULTS = ${JSON.stringify(cfg)};\n`;

// Format with the repo's prettier config so the generated file (and the blocks
// synced into the workflow scripts) pass the pre-push format check. Resolve
// prettier and the config from the repo, not from the output path — --check
// mode generates into a temp dir outside the repo.
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const require = createRequire(import.meta.url);
const prettier = require(require.resolve('prettier', { paths: [repoRoot] }));
const options = (await prettier.resolveConfig(mdPath)) ?? {};
const formatted = await prettier.format(raw, { ...options, parser: 'babel' });

writeFileSync(outPath, formatted);
