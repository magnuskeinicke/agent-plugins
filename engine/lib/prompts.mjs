// Per-run prompt emitters. The engine writes TASK prompts; the reviewer's
// system prompt is its roster file in agents/<id>.md (Claude spawns it as a
// subagent, Codex prepends the file body to the task for a `codex exec`
// child). Findings travel as JSON files — the task prompt names the exact
// output path and schema so ingestion is mechanical.
import { conventionsFile, sourceRootsText } from './config.mjs';
import { ledgerHistoryText, fmtFeedback } from './ledger.mjs';

const READ_ONLY =
  'You are READ-ONLY: never create, edit, delete, move, or rename repo files; never stage, commit, stash, reset, or check out; never run formatters, --fix linters, codemods, installs, or test runners that rewrite snapshots. The findings file below is the ONLY file you write.';

function outputContract(outputFile) {
  return `Write your report as JSON to \`${outputFile}\` (create parent dirs if needed). Shape:
{
  "reviewer": "<your roster id>",
  "blockingFindings": [{"title", "file", "line", "detail", "suggestedFix", "rootCause"}],
  "notes": ["judgement-call / debatable points — never blocking"],
  "consolidations": [{"title", "detail", "targetLib"}]  // reuse audit only
}
Every blocking finding needs a stable "rootCause" slug (what is wrong, not where — it powers cross-round identity). Do not pad findings to look productive: empty arrays are the correct result for a clean diff. Findings you cannot verify at the cited file/line do not go in blockingFindings.`;
}

function diffScope(diffCmd, fixRange) {
  if (!fixRange) return `The diff under review: \`${diffCmd}\`.`;
  return `PRIMARY diff under review (this round's fix): \`git diff ${fixRange}\`. The full slice diff (\`${diffCmd}\`) is available as context — but report only on the primary range plus anything it touches.`;
}

function overlayText(overlays) {
  if (!overlays || !overlays.length) return '';
  const rows = overlays
    .map(
      (o) =>
        `- ${o.area}: ${o.focus}${o.skills ? ` (repo skills to consult: ${o.skills})` : ''}`,
    )
    .join('\n');
  return `\n\nHost repo focus overlay (ADDITIVE — sharpens your lens, never narrows it):\n${rows}`;
}

export function reviewerPrompt({
  reviewerId,
  mode,
  contractText,
  diffCmd,
  fixRange,
  overlays,
  ledger,
  outputFile,
  cfg,
  extra,
}) {
  return [
    mode ? `Operate in ${mode}.` : '',
    READ_ONLY,
    '',
    contractText,
    '',
    diffScope(diffCmd, fixRange),
    `The repo's written conventions live in ${conventionsFile(cfg)}.`,
    overlayText(overlays),
    extra || '',
    ledger ? ledgerHistoryText(ledger) : '',
    '',
    outputContract(outputFile),
  ]
    .filter((s) => s !== '')
    .join('\n');
}

// Extra prompt material for the reuse audit (codebase-pattern-reviewer in
// diff reuse audit mode): the magnus-only libMap duplicate hunt + provenance
// table audit, fed from repo config.
export function reuseAuditExtra(cfg, libMapText, goldenText, provenance) {
  const provRows = (provenance || [])
    .map(
      (p) =>
        `- ${p.file} → ${p.mirroredFrom || `[deviation: ${p.deviation || 'MISSING'}]`}`,
    )
    .join('\n');
  return `
Reuse audit scope — every function/component/hook/util/type ADDED by the diff, in new files OR added to modified files:
- Search ${sourceRootsText(cfg)} for an existing equivalent BEFORE accepting it${libMapText ? ' — use this lib map as the search index:\n' + libMapText : ' (no lib map configured — search blind, still strict)'}.
- An equivalent exists → BLOCKING finding: use it and delete the copy.
- Genuinely generalizable new code → a "consolidations" entry naming the target lib — NOT blocking.
- DRY within the change itself: the same logic/markup/query shape repeated across the diff → BLOCKING when a small local helper would remove it; a consolidations entry when the extraction is follow-up-sized. Only flag real duplication (same reason to change).
- YAGNI: options/params/config no call site passes, wrapper layers with a single caller, generality no current caller needs → BLOCKING when the fix is inlining/deleting; a note when debatable.${goldenText ? `\nGolden-path exemplars (binding for implementers):\n${goldenText}` : ''}${
    provRows
      ? `\nAlso audit the implementer's provenance table — every added file must cite a real mirroredFrom exemplar (verify it exists and is actually mirrored) or an explicit deviation reason; a missing, false, or hand-wavy row is a BLOCKING finding:\n${provRows}`
      : ''
  }`;
}

// Gut-check pre-pass — rubric-free first read, round 1 only, BEFORE the
// roster lanes; a `block` observation stops the run before any reviewer spend.
export function gutCheckPrompt(contractText, inspect, outputFile) {
  const manifest = inspect.numstatCmd
    ? `\`${inspect.nameStatusCmd}\` and \`${inspect.numstatCmd}\``
    : `\`${inspect.nameStatusCmd}\``;
  return `You are the gut-check pre-pass — a rubric-free FIRST READ of this change, before any structured reviewer runs. ${READ_ONLY} One question, answered honestly: does anything in this diff jump out as strange, unusual, or unnecessary? "Nothing jumps out" (an empty observations array) is a valid, complete, and frequently correct answer — do not manufacture observations.

${contractText}

Read in three tiers:
1. Manifest — every changed file, ALWAYS: ${manifest}. Unrelated files, drive-by renames, whole-file reformats riding along with real work, deletions, stray scratch files, and generated output moving without the source that would produce it are all visible here without reading a single hunk.
2. Hunks — as many files as fit: \`${inspect.diffCmd}\`, working file by file in ASCENDING changed-line count so truncation costs the fewest files. Never let a partial read report as a complete pass — name any file you did not fully read in scopeNote.
3. Full files — on suspicion only: open the whole file around a hunk that looks strange. Half a function often looks stranger than the whole one; drop anything the surrounding code explains.

Things that count as jumping out: a change nobody asked for (unrelated file, drive-by rename, reformat alongside real work); something surprising on its face (magic constant, disabled or skipped test, commented-out block, shortened timeout, widened permission, swallowed error, a new dependency pulled in for one call, leftover TODO or debug statement); a hunk you still cannot explain after reading the surrounding file; a deletion whose behaviour has no visible replacement; config/credential/version churn beside unrelated work; anything contradicting the acceptance criteria above. Not exhaustive and not a checklist — anything that made you pause counts, and nothing counts merely because it is listed.

Things that do NOT count: style preferences, naming taste, missing test coverage, general code-quality findings — the reviewer lanes own those. No minimum count, no padding. For a credential, token, or other secret, name the file and line only — never reproduce the value.

Give every observation a disposition:
- "route": a real oddity a structured reviewer should judge — set routeArea to the owning reviewer or area (unsure → code-reviewer) plus a stable rootCause slug.
- "reject": it made you pause, but the surrounding code, the acceptance criteria, or the branch's purpose explains it — record it and move on.
- "block": work clearly OUTSIDE the ticket's stated requirements (an unasked-for feature, unrelated work riding along at scale). This HARD-STOPS the run for the human — use it only when you can name the requirement the work exceeds, never for something a routed finding covers.

End scopeNote with one sentence naming what you looked at: the diff command you ran, the number of changed files the manifest covered (always all of them), and any file whose hunks you did not fully read.

Write your result as JSON to \`${outputFile}\`:
{"observations": [{"title", "file", "line", "detail", "disposition", "routeArea", "rootCause"}], "scopeNote": "..."}`;
}

// Task prompt for the relevance/confidence validator (system prompt =
// agents/pr-relevance-validator.md).
export function validatorPrompt(contractText, findingsText, diffCmd, outputFile) {
  return `You CLASSIFY the findings below — you may NOT add findings of your own. ${READ_ONLY}

${contractText}

The diff under review: \`${diffCmd}\`. Open the cited files and check every finding against the actual code before classifying it.

Findings to classify:
${findingsText}

Write one verdict per finding as JSON to \`${outputFile}\`:
{"verdicts": [{"id": "<the [id] tag, echoed verbatim>", "diffCaused": true|false, "confidence": 0-100, "note": "..."}]}
diffCaused: introduced by this diff vs pre-existing/out-of-scope — a real problem the diff merely sits next to is NOT diff-caused. confidence: 0–100 that the finding is real and correctly located (90–100 only when you traced or reproduced it; below 60 means unverified). Classify every finding — a missing verdict means the finding passes through unfiltered.`;
}

// Fix pass: one fresh implementer resolves the open blocking findings
// test-first, or disputes with concrete evidence.
export function fixPrompt(contractText, targets, diffCmd, commitRule, outputFile) {
  return `You are the fix implementer for one review round. Resolve EVERY finding below, test-first (RED→GREEN where behaviour changes), then commit.

${contractText}

The slice diff so far: \`${diffCmd}\`.

Findings to resolve (address by [id]):
${fmtFeedback(targets)}

Rules:
- You may DISPUTE a finding instead of fixing it — only with concrete evidence (file:line, test output, spec text). Everything else must be fixed. When torn, fix.
- Run the repo's tests + lint/typecheck and see them pass IN THIS SESSION before reporting testsGreen=true — never assume.
- Commit everything${commitRule ? ` (${commitRule})` : ''} and record the new HEAD.

Write your result as JSON to \`${outputFile}\`:
{"summary", "committed": true|false, "head": "<git rev-parse HEAD after committing>", "testsGreen": true|false, "testEvidence": "<commands + final summary lines>", "addedFiles": [...], "provenance": [{"file", "mirroredFrom"|"deviation"}], "disputed": [{"id", "title", "evidence"}]}`;
}

// Independent closeout adjudicator for disputed entries — self-contained
// prompt, no roster file. Fresh agent, evidence only.
export function adjudicatorPrompt(contractText, disputedEntries, diffCmd, outputFile) {
  const rows = disputedEntries
    .map(
      (e) =>
        `- [id: ${e.id}] (${e.source}) ${e.title}${e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : ''}
  Reviewer's evidence: ${e.detail}
  Implementer's dispute evidence: ${e.disputeEvidence || '(none recorded)'}`,
    )
    .join('\n');
  return `You are the INDEPENDENT closeout adjudicator for a review loop that ended with disputed findings. You are fresh — judge on evidence only, not on rhetoric. ${READ_ONLY}

${contractText}

Final diff: \`${diffCmd}\` — read it, plus the cited files, and check BOTH sides' evidence against the actual code.

Disputed findings:
${rows}

Rule EACH finding:
- "upheld": the reviewer's evidence holds — the problem is real and unresolved.
- "dismissed": the implementer's dispute evidence holds — the finding is factually wrong.
When the evidence is genuinely inconclusive, rule "upheld": a wrong dismissal silently removes a real finding, a wrong uphold costs one human glance.

Write your rulings as JSON to \`${outputFile}\`:
{"rulings": [{"id", "ruling": "upheld"|"dismissed", "reason"}]}`;
}
