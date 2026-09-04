---
name: write-comments
description: 'The bar a code comment must clear before it is written: try a rename first, keep what survives as short as possible, and omit it entirely when it is not necessary. Load BEFORE typing any comment, docstring, JSDoc, block header, or TODO into code — including comments you are about to add to code you just wrote, comments a review asked for, and comments you are copying alongside moved code. Also use when the user says "too many comments", "why is this commented", "clean up the comments", "make this self-documenting", or when the same explanation is about to appear in more than one place.'
---

# Write comments

A comment is the fallback, not the default. Code that needs a comment to be understood is usually
code that needs a better name. **Prefer self-documenting code; omit the comment unless it is
necessary; when it is necessary, make it as short as it can be and still be true.**

## The gate — run it in order, stop at the first that fires

Before writing (or keeping) any comment:

1. **Would a rename make it unnecessary?** If yes, rename and write no comment. This is the common
   case. Rename the function, the parameter, the variable, the type, the field, the test.
2. **Would a small restructure make it unnecessary?** Extract the block into a named function.
   Replace the magic value with a named constant. Replace the boolean flag with a named
   union/enum, or two call sites. Lift positional arguments into a named options object. Split the
   overloaded thing into two honestly-named things.
3. **Does it carry something a name cannot?** Only these earn a comment:
   - **why** a decision was made, especially a non-obvious or surprising one
   - an **invariant** or precondition a future caller could silently break
   - a **rationale for a workaround** — the bug, the browser, the upstream issue, with a link
   - a **pitfall** visible to callers but not to readers of the body
   - the **approach** of a genuinely non-obvious algorithm (not its steps)
   - **required** doc formats the repo actually enforces (public API docs, generated docs)
4. **Otherwise: no comment.** Delete it and move on. Not writing a comment is a complete outcome.

## What a rename replaces

| Comment you were about to write | Fix |
| --- | --- |
| what a function does | rename the function |
| what a parameter means — units, shape, allowed values, nullability, which of two same-typed args | rename the parameter, or a named type/options object |
| what a local holds (`// the parsed rows`) | rename the variable |
| what a flag switches on | named union/enum, or split the call sites |
| a heading over a chunk of a long function | extract it; the heading becomes the name |
| what a test asserts | rename the test |
| what a constant's number means | rename the constant |

Names must match the surrounding code's style — casing, verb-noun shape, the domain vocabulary of
nearby identifiers — not an idealized style of your own.

## Duplication is a design smell, not a formatting problem

The same explanation appearing near-identically in two or more places means the thing being
explained belongs in one place. Do not copy-paste the comment and do not reword it into a
near-duplicate — **consolidate the code**: one named function, one named type, one constant, one
module the comment can live on once. If the duplication genuinely cannot be removed right now, write
the explanation once at the canonical site and leave the other sites bare.

The same applies over time: an explanation you already wrote three functions up does not need
repeating here.

## Never write

- Restatements of the code (`// increment i`, `// set the user`, `// import React`)
- Diff or changelog narration (`// added retry`, `// new in v2`, `// changed from map to filter`,
  `// removed the old path`) — that belongs in the commit and the PR body
- Comments addressed to the reviewer or the user rather than a future maintainer
- Section banners and decorative dividers
- Commented-out code — delete it; git has it
- A bare `TODO`/`FIXME` with no owner and no issue link
- Docstrings that repeat the signature back in prose
- Comments on obvious getters, setters, constructors, or one-line delegators

## When you do write one

- Say the one thing the code cannot. One sentence beats three. No preamble, no restating the code
  under it, no hedging.
- Put it at the level it belongs — an invariant of the whole function goes above the function, not
  above line 12.
- Explain the **why**; let the code say the what.
- Write for a maintainer a year out, without your context, without this conversation.
- Match the file's existing comment density and format. A file with no comments is telling you
  something. Do not import a heavier commenting style than the code around you uses.

## Editing existing code

Scope discipline: fix the comments you touch. Do not open a repo-wide comment purge inside an
unrelated change.

- A comment that no longer matches the code is a bug — correct it or delete it, never leave it.
- If you rename or restructure something, delete the comments the change made redundant.
- Moving code moves the burden of proof with it: re-run the gate on comments you are carrying along,
  do not transplant them unexamined.
- Leave accurate, earned comments alone. Terseness is not a reason to delete a **why**.

## Related

Author-side; review-side is the `comment-analyzer` reviewer, which flags the same failures in a
diff. Passing this gate first means it has nothing to report.
