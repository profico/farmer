---
name: test-audit
description: "Use when you write, change, review or sweep tests. Authoring gate for new tests. Audit workflow for tests with low value, tests that couple to the implementation, duplicate tests, and the test-only production seams they need."
---

# Test Audit

There are three modes and one value bar.

- **Authoring mode** gates each new or changed test when you write it.
- **Audit mode** runs a focused sweep. It finds tests that restate the source, duplicate a stronger proof, couple the behavior to the implementation, or keep a test-only production seam alive.
- **Campaign mode** prunes the whole test surface of one subsystem. Read [CAMPAIGN.md](CAMPAIGN.md) before you start one.

Continue a broad audit as separate, coherent follow-up PRs. Optimize for confidence, not for the count of deleted tests.

## Farmer test rules

Read `packages/core/AGENTS.md` ("Testing") before you write or judge a test. These rules hold in every mode.

- Run tests with `bun test`. Run `bun test <path>` in the workspace that owns the file, or `bun run test` from the root.
- `packages/core` tests use `createTestDb()` from `src/test/harness.ts`. It gives each file a fresh PGLite database. There is no `DATABASE_URL` and no container.
- Use `at(rows, i)` and `present(value, what)` from `src/test/harness.ts`. Do not use a type assertion or a non-null assertion in a test. Both helpers fail the test and name what is missing.
- Give `.toThrow()` an argument. An `.toThrow()` with no argument passes for any thrown value. The lint rule `no-vacuous-throw-assertion` rejects it.
- Pin the clock with `{ now }` where a service takes it. Do not depend on the date of the day.
- Chunk a multi-row insert at about 500 rows. A larger insert kills the PGLite instance for the rest of the file.
- Look up a built-in task by `systemKey`, never by name.
- Test a service function with an explicit `ctx: { organizationId, userId }`. A tenancy test must use two organizations.
- Every oxlint suppression needs a reason. Every type assertion needs a `SAFETY:` comment. A test that needs one is a sign that the test is at the wrong boundary.
- `apps/web` has no test suite. Test the logic in `packages/core`, so that the web layer stays thin.

## Farmer surfaces

The owner boundary of a contract is one of these surfaces. Put the primary test at the strongest one.

- the services in `packages/core/src/services/`;
- the server functions and routes in `apps/web`;
- the commands and the API client in `apps/cli`;
- the REST API (`api/v1`) and its projections in `packages/core/src/api/`;
- the MCP tools and the assistant tools (one shared registry);
- the background jobs in `packages/core/src/jobs/`.

## Authoring gate

Before you add a test, answer four questions. If one answer is missing, do not add the test yet.

1. What observable behavior, invariant or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not catch that failure? Each contract has one primary test owner at the strongest boundary. Another layer needs its own distinct risk, for example a transport or lifecycle failure that the owner cannot reach. Prefer a new row in a table-driven case or a shared fixture to a near-duplicate test. Consolidate duplicated setup in the same change.
4. Does the test need a production seam (an export, a flag, a wrapper, an injection hook) that no production caller needs? If yes, move the test to the real boundary.

Then check the test against each [junk pattern](#junk-patterns). A match fails the gate, unless the [retention bar](#retention-bar) names the contract that the test guards independently. A test that breaks under a behavior-preserving refactor asserts the implementation, not the behavior. Rewrite it at the owner boundary before you land it.

A bug regression test must fail on the code before the fix, for the intended reason. It must pass after the fix at the owner boundary. A regression test that never failed proves the mock, not the fix. One regression at the owner boundary covers the bug. Do not replay the same scenario at each layer it crosses.

## Junk patterns

Both modes use this checklist. The authoring gate rejects a new test that matches one. An audit looks for existing tests that match one.

- assertion-free coverage probes;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests or export lists;
- exact source, import or string greps;
- private predicate or call-shape tests that duplicate a real boundary;
- duplicate invocations of the same contract;
- local replays of a shared helper;
- tests whose only purpose is to keep a test-only export, global or wrapper;
- dead production code whose only callers are tests;
- expected values that the helper or renderer under test produces;
- mocks that implement the behavior under test, or one identical mock that stands in for different APIs;
- fixtures that supply the ordering the owner must produce, or persistence asserted against a store that the path never writes;
- capability tests that restate declared flags instead of exercising the delivery that the flag promises;
- negative controls that pass for an unrelated reason, for example a denial from a different guard, or a rejection that the production path never reaches;
- a name or a fixture that promises more than the input exercises, for example a "retires the window" test that asserts the window was not cleared;
- a test that reads rows through a mock database. Use the PGLite harness.

## Value bar

A test earns its maintenance cost when it protects a behavior, a credible regression or an independent contract. In an audit, an existing test that must change for a behavior-preserving reorganization is suspect. It is not deletable by that fact alone. The authoring gate still rejects a new test of that kind.

Before you judge a candidate, read the complete test and its production owner. Read the entry point, the callers, the callees, the sibling implementations, the overlapping tests, the CI routing and the relevant history. Read the root `AGENTS.md` and the `AGENTS.md` of the workspace first. When a test claims behavior that a dependency provides, read the source or the types of the dependency.

## Discovery

Keep discovery read-only. Report the evidence before you edit. For a broad scope, run parallel discovery lanes if you can:

- `packages/core` (services, jobs, lib);
- `apps/web` (server functions, routes);
- `apps/cli`;
- a cross-cutting pattern sweep.

Outside campaign mode, prefer a few high-confidence candidates to a large speculative list. Look for the [junk patterns](#junk-patterns).

## Retention bar

Keep a test when it independently enforces one of these contracts: a public API, the REST API or an MCP tool schema, a protocol, a configuration, a migration, storage, authorization or tenancy, security, a default, a package, a release, or an architecture rule. Also keep:

- call ordering, when the order is observable behavior;
- a regression with a credible failure mode;
- a source inspection, when it is the cheapest independent guard. It must fail when the contract changes (the user-facing key, byte or path). It must survive a rename of an identifier;
- a retained test that fails on the baseline. Treat it as a possible product bug. Reproduce it and repair the owner. Do not delete the test.

Static or slow is not a reason to delete a test. A test that looks like the implementation can be the independent contract. Prove that it is not before you remove it.

## Candidate evidence

Record each field before you edit. A missing field means the candidate is not ready for deletion.

- the exact test name and location;
- the failure that the test can detect;
- the non-test callers of the covered production or support seam;
- the stronger proof that remains at the owner boundary, or why no proof is needed;
- the relevant history, and the reason that the test or seam exists;
- the production or test-support deletion that this unlocks;
- the risk, and the focused validation command.

## Edit shape

Choose one coherent batch at one owner boundary. Delete the obsolete test-only exports, globals, wrappers and dead production paths. Do not keep aliases. Move a retained regression to its canonical owner. Merge repeated assertions into one generic contract.

Prefer a net reduction of production lines. Do not add a replacement test that restates the same implementation. Do not turn an uncertain candidate into cleanup to raise the count of deletions.

## Validation

Do not edit source or tests while a test run is active in the checkout.

1. Run the smallest owner test and the sibling tests: `bun test <path>` in the owning workspace.
2. For a removed source grep or plan assertion, run the script or dry-run that owns the real contract.
3. Run `bun run format`, then `bun run check` and `bun run typecheck` from the root. Then run `git diff --check`.
4. Run `bun run test` from the root if the change touches more than one workspace.
5. Run `git diff --numstat`. Report production code and tooling separately from tests and test support.
6. Run `pr-review` on the final diff. Run `deslop` before it.

## Landing and continuation

Commit, push or open a PR only when the user authorizes it. Open a PR as a draft. Land one coherent PR at a time. After it lands, refresh from the current `main`. Run the read-only discovery again for the next high-confidence batch.

## Handoff

Report:

- the root cause and the removed categories of low-value tests;
- the simplifications of the production owner;
- the retained false positives, and why they stay valuable;
- the focused proof and the full proof that you ran;
- the production lines against the test lines;
- the PR and merge state;
- the named follow-ups.
