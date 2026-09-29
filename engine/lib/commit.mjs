// The commit-subject rule — one source of truth for the shape of every commit
// the suite writes. A host sets `commit.format` (a human template) and/or
// `commit.pattern` (an anchored regex). Absent both, commits take the PR-title
// shape (`pr.titleRule` / `pr.scopes`); absent those too, a plain conventional
// `<type>: <subject>`. Hosts that squash-merge with `COMMIT_OR_PR_TITLE` land a
// single-commit PR under its commit subject, so the subject must satisfy the
// same rulesets the title does. See CONTRACT.md (`commit`).
import { execFileSync } from 'node:child_process';

export const FALLBACK_COMMIT_FORMAT = '<type>: <subject>';
const SCOPED_FORMAT = '<type>[(<scope>)]: <subject>';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// `SER-XX` in a template stands for a real issue id (`SER-1633`).
const ISSUE_SLOT = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]*)-X+(?![A-Za-z0-9])/;
const TOKEN = /^<(type|scope|subject|issue|ISSUE)>/;

// Compile a template such as `<type>[(<scope>)]: SER-XX <subject>` into an
// anchored regex source. `[...]` is optional. Anything that is not a template
// (no `<subject>` slot, unbalanced brackets) yields '' — no derived check.
export function templatePattern(format, scopes = []) {
  if (!format || !format.includes('<subject>')) return '';
  const slot = {
    type: '[a-z]+',
    scope: scopes.length ? `(?:${scopes.map(escapeRe).join('|')})` : '[A-Za-z0-9_./-]+',
    subject: '\\S.*',
    issue: '[A-Z][A-Z0-9]*-\\d+',
  };
  let src = '';
  let depth = 0;
  for (let i = 0; i < format.length; ) {
    const rest = format.slice(i);
    const token = TOKEN.exec(rest);
    if (token) {
      src += slot[token[1].toLowerCase()];
      i += token[0].length;
      continue;
    }
    const issue = /^([A-Z][A-Z0-9]*)-X+(?![A-Za-z0-9])/.exec(rest);
    if (issue && !/[A-Za-z0-9]/.test(format[i - 1] || '')) {
      src += `${escapeRe(issue[1])}-\\d+`;
      i += issue[0].length;
      continue;
    }
    const ch = format[i++];
    if (ch === '[') {
      depth++;
      src += '(?:';
    } else if (ch === ']') {
      if (!depth) return '';
      depth--;
      src += ')?';
    } else src += escapeRe(ch);
  }
  return depth ? '' : `^${src}$`;
}

export function resolveCommitRule(cfg) {
  const commit = cfg?.commit || {};
  const pr = cfg?.pr || {};
  const scopes = pr.scopes || [];
  let format;
  let source;
  if (commit.format || commit.pattern) {
    source = 'commit';
    format = commit.format || '';
  } else if (pr.titleRule) {
    source = 'pr.titleRule';
    format = pr.titleRule;
  } else if (scopes.length) {
    source = 'pr.scopes';
    format = SCOPED_FORMAT;
  } else {
    source = 'default';
    format = FALLBACK_COMMIT_FORMAT;
  }
  const pattern = commit.pattern || templatePattern(format, scopes);
  if (pattern) compilePattern(pattern);
  return { format, pattern, source };
}

export function compilePattern(pattern) {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`commit.pattern is not a valid regex: ${error.message}`);
  }
}

// One concrete subject built from the rule's template. Optional groups render
// only when every slot inside has a value. '' when the format is not a
// template, or when the rendering would itself fail the pattern.
export function renderCommitSubject(rule, { issue = '', type = 'feat', scope = '', subject = '<subject>' } = {}) {
  if (!rule.format.includes('<subject>')) return '';
  const values = { type, scope, subject, issue };
  const filled = (text) =>
    [...text.matchAll(/<(\w+)>/g)].every((m) => values[m[1].toLowerCase()]) &&
    (!ISSUE_SLOT.test(text) || issue);
  let text = rule.format;
  for (let prev; prev !== text; ) {
    prev = text;
    text = text.replace(/\[([^[\]]*)\]/g, (_, inner) => (filled(inner) ? inner : ''));
  }
  text = text.replace(/<(type|scope|subject|issue|ISSUE)>/g, (m, n) => values[n.toLowerCase()] || m);
  if (issue) text = text.replace(new RegExp(ISSUE_SLOT.source, 'g'), issue);
  if (rule.pattern && !compilePattern(rule.pattern).test(text)) return '';
  return text;
}

// The instruction every writer prompt carries. `since` names the range start
// the engine checks from, so the writer can verify and repair its own commits.
export function commitRuleText(rule, { example = '', since = '' } = {}) {
  const shape = rule.format ? `\`${rule.format}\`` : `a subject matching \`${rule.pattern}\``;
  const eg = example ? ` — e.g. \`${example}\`` : '';
  if (!rule.pattern) return `Commit message subject: ${shape}${eg}.`;
  const range = since ? ` (\`git log --no-merges ${since}..HEAD --format=%s\`)` : '';
  const repair = since ? ` Repair a wrong subject with \`git reset --soft ${since}\` and one conforming commit.` : '';
  return `Commit message subject: ${shape}${eg}. Every new commit subject${range} must match \`${rule.pattern}\`; the engine rejects a mismatch before anything is pushed.${repair}`;
}

// null → not inside a git work tree (nothing to check). A bad range throws.
export function commitsInRange(range) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  let log;
  try {
    log = execFileSync('git', ['log', '--no-merges', '--format=%H%x09%s', range, '--'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`cannot list commits in ${range}: ${String(error.stderr || error.message).trim()}`);
  }
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

export function commitOffenders(rule, commits) {
  if (!rule.pattern) return [];
  const re = compilePattern(rule.pattern);
  return commits.filter((c) => !re.test(c.subject));
}

export function commitViolationText(rule, offenders, since, example = '') {
  const rows = offenders.map((c) => `  ${c.sha.slice(0, 12)} ${c.subject}`).join('\n');
  return `${offenders.length} commit subject(s) since ${since} do not match the commit rule ${rule.format ? `\`${rule.format}\` ` : ''}(pattern \`${rule.pattern}\`):
${rows}
Rewrite them before anything is pushed: \`git commit --amend -m "<subject>"\` when only HEAD is wrong, otherwise \`git reset --soft ${since}\` and one commit whose subject matches${example ? ` (e.g. \`${example}\`)` : ''}.`;
}
