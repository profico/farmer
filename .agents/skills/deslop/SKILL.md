---
name: deslop
description: "Diff-scoped cleanup of AI slop: remove comment slop, defensive-check slop, type laundering and style drift from the diff of the current branch. Run it before pr-review."
---

# Deslop

Clean only the diff of the current branch. Preserve the behavior absolutely.

## Checklist

1. Scope the pass to `git diff $(git merge-base origin/main HEAD)`. Include the uncommitted changes. Never run a cleanup on the whole repository.
2. Inspect each changed hunk for these items:
   - A comment that a maintainer would not write. This includes narration, an explanation of the syntax, and prose that restates the code. A comment must state a reason: why the code does what it does, or which invariant it keeps.
   - A defensive check or a `try`/`catch` block that is not normal for the surrounding module, or that protects only a state that cannot occur.
   - A cast that launders a type, for example `as any`, `as unknown as T`, or a widen-then-assert flow. Do not add a cast. If a cast stays, it needs a `SAFETY:` comment that states the invariant.
   - A redundant intermediate variable, or a helper with one use, that adds no domain meaning, removes no duplication and does not simplify the control flow.
   - A compatibility shim, an alias, a retry or a fallback branch with no named shipped contract and no plan to remove it.
   - Naming, control flow, imports, formatting or other style that conflicts with the surrounding file. Match the surrounding file.
3. Make no functional edit. If a cleanup could change the behavior, leave the code as it is and report it.
4. Fix a finding in place only when the cleanup is trivial and does not change the behavior. Otherwise, note it for the author.
5. Run `bun run format` and `bun run check`. Report the result in one to three sentences. State if anything changed. State each non-trivial item that you left for review.

## What the lint already does

Do not repeat the work of the linter. Run `bun run check` and read its output first.

- The anti-slop rules reject `unknown` in a contract, a `Record<string, unknown>` value type, a hand-written `typeof` narrowing where a parse belongs, and a type assertion with no stated invariant.
- `require-safety-comment-for-type-assertion` fails the build on a type assertion with no `SAFETY:` comment.
- A suppression with no reason fails the build. Give each suppression a `-- <why>` trailer or a comment above it.
- Warnings do not fail the build. Do not add a new warning.

Focus on what the linter cannot see: comments, needless defensive code, one-use helpers, and drift from the style of the file.

## Order of work

Run `deslop` before `pr-review`. Never run it instead of `pr-review`. `pr-review` stays the required review gate for correctness and safety.
