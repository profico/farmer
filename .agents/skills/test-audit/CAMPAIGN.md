# Test-pruning campaign

Campaign mode prunes the whole test surface of one subsystem in one PR. A subsystem is one service area in `packages/core`, one set of jobs, the CLI, or one set of routes in `apps/web`. The value bar, the retention bar, the candidate evidence and the validation in [SKILL.md](SKILL.md) apply to each lane. The farmer test rules in [SKILL.md](SKILL.md) apply too. This file adds the order of work and the lessons of a full campaign. Each step ends on a completion criterion. Do not start the next step early.

## 1. Baseline

Record the line counts of the tests and the support files of the subsystem. Record the pass or fail state of each test file at a pinned `origin/main` SHA. Keep the baseline failures in a separate list. In the campaign that this file comes from, all baseline failures were real delivery bugs, not stale tests.

Done when each in-scope test file has a recorded baseline result.

## 2. Lanes and inventory

Split the surface into **lanes** along the boundaries of the production owner, not along file prefixes. Include the cases of the subsystem at shared boundaries. For farmer, such a boundary is a service, the REST API, an MCP tool, the CLI API client or a job.

Done when each test file that the subsystem owns belongs to exactly one lane.

## 3. Read-only ledger per lane

Give each lane to its own read-only agent. The agent reads each assigned test in full, including the parameter tables. It also reads the production owners, their entry points, their callers, their history and the CI routing. Each test declaration goes into a written **ledger** with one mark. A table-driven `test.each` is one declaration, unless its rows need different marks. Then mark each row.

- `R`: retain. Name the contract and the bug that the test catches. A retained test that only moves to a file with a better name stays `R`, with the move noted.
- `F`: retain the contract, but repair the assertion. Example: a vacuous negative that passes when only one of several items is missing.
- `C`: consolidate. Name the owner that absorbs the assertion first: a sibling table case, a stronger boundary suite, or the shared owner in another package.
- `D`: delete. Name the proof that remains, or say why no contract exists.

Judge a test by its assertions, not by its name. One test in the source campaign had a name about retiring a progress window. It asserted that the window was not cleared.

Done when each declaration in the lane has a mark and a line of evidence.

## 4. Layer plan per lane

Treat the per-test ledger as input, not as the edit list. A second read-only pass starts from the ledger. It looks for a redundant **layer**. Example: several suites replay the same shared helper through one mock, around stronger suites that use a real database and a real HTTP fixture. Name the **keeper** suite for each contract. Prefer the real boundary with a fake network (PGLite for the database) to a mocked collaborator. Correct the ledger errors that this pass finds.

Done when each lane plan names its retired files, its keeper for each contract, the assertions to carry into the keepers, and the test-only production seams that this unlocks.

## 5. Cutover

Edit lane by lane. Send changes to shared harnesses and support files (`src/test/harness.ts`, `src/test/calendar.ts`) through one owner. With each lane, remove the test-only production seams that it unlocks: injection parameters, getters, reset exports and indirection layers. Update the lists of tests in CI if a suite moves. Put durable test-ownership rules in the `AGENTS.md` of the workspace. Take them from the mistakes that this campaign found.

Done when each lane plan is applied and the keepers of each lane pass.

## 6. Preservation review

Before you claim completion, ask independent reviewers to compare the deleted coverage with the keepers. Use one reviewer for each group of boundaries. They look for contracts that lost their only proof. They also look for new assertions that cannot fail, for example a rejection row that the production code never reaches. The source campaign found nine real gaps and one unreachable assertion in this step.

For each restored contract, make one deliberate **mutation** of the production owner. Confirm that the keeper goes red. Then restore the source byte for byte.

Done when each reported gap is restored or rejected with source evidence, and each restored contract has a caught mutation.

## 7. Product defects

A baseline failure that survives into a keeper is a bug report. Fix it at its owner in a separate commit. Prove the fix through the real user flow. Add a **control** run that reverts the fix and shows the old behavior. Record unrelated product discrepancies as follow-ups. Do not fix them in the campaign.

Done when each repaired defect has a failing control and a passing candidate on the same harness.

## 8. Reconcile and hand off

A campaign outlives many commits on `main`. Merge `main`. Do not rebase a long campaign with many commits. If `main` changed a file that the campaign deleted, keep the deletion. Port the new contract into the keeper. Confirm that each new regression from `main` still has a home. Run the whole suite of the subsystem again on the merged head. Run `pr-review` before you mark the PR ready.

Hand off with the report from [SKILL.md](SKILL.md), plus:

- the line counts of the tests and the support files at the start and at the end, with production code counted separately;
- the lanes, the retired layers and the keepers;
- the preservation gaps that you found, and their mutations;
- the product defects, each with the control proof and the candidate proof.
