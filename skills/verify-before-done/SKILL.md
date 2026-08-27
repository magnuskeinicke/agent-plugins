---
name: verify-before-done
description: 'The iron law before any completion claim: no "done", "fixed", "passing", or "works" without fresh verification evidence from this session. Identify the proving command, run it in full, read the output, only then claim. Use before claiming work is complete, before committing, opening a PR, marking a gate green, or trusting a subagent''s success report — and whenever the user says "verify before done", "prove it works", "did you actually run it?", or catches an unverified claim. Includes the red-green rule for bug-fix regression tests.'
---

# Verify before done

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

## Proving commands in this repo

The claim decides the command — the repo's definition of done is the ceiling:

```bash
CI=true pnpm nx affected -t lint test build --base=origin/development --no-tui
pnpm nx format:check --base=origin/development
```

Narrower claims use narrower commands (`CI=true pnpm nx test <project> --no-tui` for one project's tests). Two repo traps: never pipe an nx command through `| tail`/`| grep` when its exit code matters (the pipe masks failures), and run unit tests with `CI=true` or they go interactive.

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
