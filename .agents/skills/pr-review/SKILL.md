---
name: pr-review
description: "Review a farmer branch or pull request for correctness before it is marked ready, or review another person's PR. Checks each dependency claim against its source, sweeps for sibling sites and other paths into the changed code, and runs the tests on main and on the branch. Use before marking a PR ready, after pushing a review fix, or when asked to review a PR."
argument-hint: "[PR number | branch | commit] [--post]"
context: fork
model: opus
effort: xhigh
---

# PR review

Review one change the way a careful maintainer does. The goal is the defects
that the author's own tests cannot find: the tests check the author's
assumptions, and the defects are in those assumptions.

The review is read-only. Do not edit, commit, push, comment, or approve. Post
to GitHub only when the caller passes `--post` (see "Report").

## 1. Pin the target

Resolve the argument to one commit and one base:

- A PR number: `gh pr view <n> --json headRefOid,baseRefName,body,title`.
  Fetch the head commit: `git fetch origin pull/<n>/head`.
- A branch: its head, against `origin/main`.
- Nothing: the current branch head, against `origin/main`.

Find the base with `git merge-base <head> origin/<base>`. Write the short head
SHA at the top of the report ("At `abc1234`: ..."). A later round then reviews
only the commits after that SHA. If an earlier review on the PR names a SHA,
read that review first. Review only `git log <old>..<head>`, and do not raise a
finding again that the author already answered.

Do not review in the main checkout. Use `git worktree add --detach` on the head
commit, then run `bun run worktree:setup` and `bun install` in it. Remove the
worktree at the end.

## 2. Read before you judge

1. Read the PR body, the linked issue, and the full diff
   (`git diff <base>..<head>`).
2. Read each changed file in full, not only the hunks.
3. Read the root `AGENTS.md` and the `AGENTS.md` of each workspace that the
   diff touches.
4. Read each `docs/domains/*.md` file that the root `AGENTS.md` table names for
   the changed files. Read `docs/adr/` when the change can contradict a
   decision there.

## 3. The checks

Do every check. Each one exists because a review found a defect that the
author's tests did not catch.

### 3.1 Dependency contracts: cite the source

For each place where the diff depends on a library, a framework, a runtime, or
an external API (what it calls, throws, returns, emits, or swallows), find the
proof and cite it:

- A package: the file and line in `node_modules`. Example:
  `@tanstack/react-router/dist/esm/link.js:263` shows that a failed preload is
  only logged.
- An external API: the documentation page and the quoted sentence. Fetch the
  page. Do not answer from memory.
- Bun: run a small probe script when the documentation is not clear.

Then ask what the dependency does in the cases that the diff does not handle.
Examples:

- An error state that arrives inside a 200 response.
- A preload or prefetch that runs the same code path as a navigation.
- A timeout that throws a different error class than an abort.

A claim with no citation is a finding.

### 3.2 Siblings: the same fix in other places

- Grep for each string, constant, error message, and pattern that the diff
  adds or changes. If the diff adds a constant, find each literal that still
  has the same value. If the diff fixes a pattern, find each other place with
  the same pattern.
- When the diff fixes a defect in one function, find the functions that have
  the same shape and check them for the same defect.

### 3.3 Other paths into the changed code

A service in `packages/core` has several callers. List each caller of each
changed exported function, and say how each one is affected:

- the web server functions (`apps/web/src/server/`)
- the REST API (`api/v1`)
- the CLI (`apps/cli`)
- the MCP tools (`mcp-tools.ts`)
- the assistant tools (`assistant-tools.ts`, `assistant.service.ts`)
- the background jobs (`packages/core/src/jobs/`)

If the PR fixes a problem for one caller, check if another caller has the same
problem. If the PR body says that a caller is left out on purpose, check the
reason.

### 3.4 Cost under load

Say what the change costs on the server when many clients hit it at the same
time. Examples:

- A deploy that makes each open tab request a missing file.
- An agent loop that reads a range again and again.
- A 404 that runs a full SSR render.

A cost that the change did not cause is still a finding when it is on the path
that the change works on. Mark it "pre-existing" and recommend the fix. Do not
put it in the notes.

Check the request path rule in the root `AGENTS.md`: nothing on a request path
calls an organization's webhook URL.

### 3.5 The rules that apply everywhere

Check the diff against the rules in the root `AGENTS.md`:

- Imports from `@farmer/core` in routes go inside the handler body.
- Tenancy is a parameter: `ctx` comes first, and each query key names the
  organization.
- Logged time goes through `services/ledger.ts`, and `MAX_DAY_SECONDS` limits a
  day.
- An engine finds a task by `systemKey`, never by name.
- A type assertion has a `SAFETY:` comment that states a real invariant.

Also check the rules in each workspace `AGENTS.md` that the diff touches.

### 3.6 Tests on both sides

Run the tests of each touched workspace on the base and on the head. Run
`bun run check` and `bun run typecheck` on the head. For each new test, check
that it fails on the base. A test that passes on both sides does not prove the
fix. Follow the `test-audit` skill for the value of each new test.

### 3.7 What a person sees

For a UI change, start the app with the `run` skill and look at the change in a
browser. Check the empty state, the error state, and a slow network.

### 3.8 The PR body

Each claim in the PR body must be true at the head SHA. A claim that is false
is a finding, including a sentence such as "the cause is unknown" when the
cause was in a document.

## 4. Verify each finding

Before you report a finding, try to prove it wrong. Read the code that would
make it wrong. Run a probe when you can. Drop a finding that you cannot
support with a file and line, a quoted source, or a command output. Keep a
finding as "uncertain" only when you name the one fact that would decide it.

## 5. Report

Start with: `At <short SHA>: <what you read>, <what you ran and the result>.`
Then say if the fix is correct and in the correct layer, in one or two
sentences.

Then list each finding, most severe first:

- `file:line`, one sentence that states the defect.
- The concrete failure: the input or the state, and the wrong result.
- The proof: the citation, the grep result, or the command output.
- The change that you recommend.

Then list the notes that need no change.

If the caller passed `--post` and the target is a PR:

- Post one review with `gh api repos/{owner}/{repo}/pulls/<n>/reviews`, with
  one inline comment for each finding.
- Use `REQUEST_CHANGES` when a finding needs a change, and `COMMENT`
  otherwise. Never use `APPROVE`.

Without `--post`, return the report to the caller only.
