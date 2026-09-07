---
name: verify-before-done
description: 'The iron law before any completion claim: no "done", "fixed", "passing", or "works" without fresh verification evidence from this session. Identify the proving command, run it in full, read the output, only then claim. Use before claiming work is complete, before committing, opening a PR, marking a gate green, or trusting a subagent''s success report — and whenever the user says "verify before done", "prove it works", "did you actually run it?", or catches an unverified claim. Includes the red-green rule for bug-fix regression tests.'
---

# Verify before done

Runtime and model selection: read [the shared runtime contract](../work-slice/references/runtime.md) before launching workers or sessions. Use the registry role for `verify-before-done`; supporting skills inherit the caller’s resolved role.

Claiming work is complete without fresh verification evidence leaves the claim unsupported. **Evidence before claims, always.** Violating the letter of this rule is violating the spirit of this rule.

```
NO COMPLETION CLAIM WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the proving command **in this session, after the last edit**, you cannot claim it passes.

## The gate function

Before claiming any status — or expressing satisfaction ("Great!", "Done!", "should work now"):

1. **IDENTIFY** — what command proves this claim?
2. **RUN** — execute the full command, fresh and complete.
3. **READ** — the full output: exit code, failure count, the actual summary lines.
4. **VERIFY** — does the output prove the claim? No → state the actual status with the evidence. Yes → state the claim **with** the evidence (commands + summary lines).
5. **ONLY THEN** — make the claim.

Skip any step and the claim remains unverified. If no command can prove the claim — nothing testable exists, or it cannot run here — say so explicitly: name what changed and what you could not verify. "Cannot verify X here" is an honest status; "X passes" without evidence is not.

## Proving commands

The claim decides the command — the repo's definition of done is the ceiling. Read it from `docs/agents/repo-config.md` (`## Config`):

- `gates.all` — the full definition of done (lint + test + build).
- `gates.format` — the formatting check.
- `gates.test` — the narrow per-project form; narrower claims use narrower commands.
- `gates.traps` — the repo's known ways these commands lie. **Read this list before trusting an exit code.**

No config file, or the keys are empty → discover the commands from the repo itself (package manifest scripts, CI workflow, the conventions file), run those, and **name which command you used** in the claim. Never invent a command and never claim a gate you could not identify.

## Claim → required evidence

| Claim | Requires | Not sufficient |
| --- | --- | --- |
| Tests pass | Test command output: 0 failures | A previous run, "should pass" |
| Lint clean | Lint output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Lint passing, "logs look good" |
| Bug fixed | Original symptom re-tested: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passing once |
| Subagent completed | VCS diff + fresh command output | The agent reporting "success" |
| Requirements met | Line-by-line AC checklist | Tests passing |

**A subagent reporting success is not evidence.** Verify independently: read the actual diff (`git diff`/`git status`) and run the proving command yourself.

## Red-green rule for bug fixes

A regression test only counts when it has been seen to fail without the fix:

```
Write test → run (pass) → revert the fix via scoped stash
  (git stash push -- <files the fix changed>) → run (MUST FAIL) →
restore (git stash pop) → run (pass)
```

Scope the stash to the fix's files so unrelated working-tree changes stay untouched. If `git stash pop` conflicts, resolve preserving the fix — or stop and tell the user the tree needs manual attention. "I've written a regression test" without the red leg proves nothing.

## Rationalizations and their counters

| Excuse | Reality |
| --- | --- |
| "Should work now" | Run the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Lint passed" | Lint ≠ compiler ≠ tests |
| "Agent said success" | Verify independently |
| "Partial check is enough" | Partial proves nothing |
| "Different words, so the rule doesn't apply" | Spirit over letter — any wording implying success triggers the gate |

The rule covers paraphrases, synonyms, and hedges ("should", "probably", "seems to"). Different words do not exempt the claim.

## Why

A false "done" breaks trust in every later claim, ships broken code, silently drops requirements, and costs a full redirect-and-redo cycle. The gate is cheaper than any of those.

---

Inspired by kramme-cc-workflow (MIT) — https://github.com/Abildtoft/kramme-cc-workflow

## Workflow Boundaries

**This skill gates every completion claim behind fresh verification evidence from this session.**

- **DOES**: identify the proving command per claim (from `gates.*`, else discovered and named), run it in full after the last edit, read the complete output, state the claim with its evidence — or state plainly what could not be verified
- **DOES NOT**: accept stale runs, confidence, partial checks, or a subagent's "success" as evidence; invent proving commands; substitute lint for compile or tests; let hedged wording ("should", "probably", "seems to") bypass the gate

## Red Flags — STOP

- About to say "done", "fixed", "passing", "works" — or any paraphrase or hedge — without a fresh run — stop; run the proving command first.
- The proving run predates your last edit — stop; it is stale, re-run it.
- About to trust an exit code without reading `gates.traps` — stop; read the repo's known lies first.
- About to invent a proving command, or claim a gate you could not identify — stop; discover from the repo and name the command used, or say "cannot verify".
- About to relay a subagent's "success" as done — stop; read the diff and run the proving command yourself.
- About to call a regression test proven after one passing run — stop; the red leg (fails with the fix stashed) is required.
- `git stash pop` conflicted mid red-green cycle — stop; resolve preserving the fix, or tell the user the tree needs manual attention.

## Verification

Before reporting done:

- [ ] Every claim maps to a named command run in this session, after the last edit.
- [ ] Full output read — exit code, failure count, summary lines — not just the tail.
- [ ] The claim states its evidence: commands run + summary lines.
- [ ] Bug fixes: red-green cycle completed — test failed with the fix stashed, passed with it restored.
- [ ] Subagent work verified independently via `git diff`/`git status` plus a fresh proving run.
- [ ] Anything unverifiable stated explicitly as "cannot verify X here", never implied as success.
