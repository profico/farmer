---
name: pr-fix
description: "Address the review threads on a farmer pull request: verify each requested change against the code and its sources, fix only the valid ones, test, and push. Use when a PR has changes requested or open review comments."
argument-hint: "<PR number>"
---

# PR fix

A review comment is a claim to verify, not an instruction to apply. Fix what
is true, and explain what is not.

## Scope

- This skill changes code, runs tests, commits, and pushes to the PR's own
  branch. Do not force-push.
- Do not reply to a thread, resolve a thread, re-request a review, or mark the
  PR ready unless the user asks.
- Do not change the base branch, merge, or close the PR.

## 1. Read the review

1. `gh pr view <n> --json headRefName,headRefOid,reviews,body`
2. `gh api repos/{owner}/{repo}/pulls/<n>/comments` for the inline threads.
   Read each full comment body, because the proposal is often at the end.
3. Note the SHA that each review names ("At `abc1234`: ..."). A thread on an
   older SHA can be out of date.

## 2. Get a clean checkout of the branch

Use the branch's existing worktree if one exists (`git worktree list`). Else
run `git worktree add ../farmer-wt-<branch> <branch>`. Then run
`bun run worktree:setup` and `bun install` in it. Make sure that the branch
matches `origin/<branch>` and that `git status` is clean before you change
anything.

## 3. Verify each request

For each request, read the code that it names, and decide if it is valid:

- A claim about a dependency: find the file and line in `node_modules`, or
  fetch the documentation page and quote it.
- A claim about other call sites: run the grep yourself.
- A claim about behavior: reproduce it with a test or a probe when you can.

If a request is not valid, do not change the code for it. Write down the
reason and the proof for the report.

## 4. Fix

- Fix each valid request in the layer where the defect is.
- Look past the lines that the reviewer named. If the reviewer found one
  literal, grep for all of them. If the reviewer found one caller with the
  problem, check the other callers (see `pr-review`, sections 3.2 and 3.3).
- Add a test that fails before the fix and passes after it. Follow the
  `test-audit` skill.
- Update `docs/domains/` and the `AGENTS.md` files where the behavior that
  they describe changed.
- Update the PR body where it now says something false
  (`gh pr edit <n> --body-file`). Keep the rest of the body.

## 5. Check

Run these from the worktree root. All must pass:

- `bun run check`
- `bun run typecheck`
- `bun test` in each workspace that changed

Then run the `deslop` skill on the diff, and the `pr-review` skill on the new
head. Fix what `pr-review` finds before you push.

## 6. Commit and push

- Stage each file by its path. Never use `git add -A`, `git add .`, or
  `git commit -a`.
- Match the commit style of the repository: `type(scope): subject`, with an
  imperative subject. In the body, say why the change is necessary.
- `git push`. Do not force-push.

## 7. Report

For each request, report:

- If it was valid, with the proof.
- What changed (`file:line`).
- The test result.

End the report with the pushed SHA, and list any thread that still needs a
reply from the author.
