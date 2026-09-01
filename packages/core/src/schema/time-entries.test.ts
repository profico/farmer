// The 62-day ceiling on a time-entry range.
//
// This cap has existed for a while but was never exercised, and it turned out
// not to be enforced everywhere it was assumed to be: `api/v1/time-entries`
// re-implemented the date check with a bare regex and called `listRange`
// directly, so the REST endpoint answered `1970-01-01 → 2999-12-31` with a
// full-table scan. That handler now parses through this schema, which makes
// these the tests standing behind the endpoint as well as the server function.

import { describe, expect, test } from "bun:test";

import { listTimeEntriesRangeInput } from "./time-entries";

const parse = (from: string, to: string) =>
	listTimeEntriesRangeInput.safeParse({ from, to });

describe("listTimeEntriesRangeInput", () => {
	test("accepts a single day", () => {
		expect(parse("2026-03-01", "2026-03-01").success).toBe(true);
	});

	test("accepts a month — the widest view the UI asks for", () => {
		expect(parse("2026-03-01", "2026-03-31").success).toBe(true);
	});

	test("accepts exactly the 62-day boundary", () => {
		expect(parse("2026-01-01", "2026-03-04").success).toBe(true);
	});

	test("rejects one day past the boundary", () => {
		const result = parse("2026-01-01", "2026-03-05");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toMatch(/Range too large/);
	});

	// The case the REST endpoint was open to.
	test("rejects a millennium", () => {
		expect(parse("1970-01-01", "2999-12-31").success).toBe(false);
	});

	test("rejects a reversed range", () => {
		const result = parse("2026-03-31", "2026-03-01");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toMatch(/must not be after/);
	});

	test("rejects a malformed date key", () => {
		expect(parse("2026-3-1", "2026-03-31").success).toBe(false);
		expect(parse("yesterday", "2026-03-31").success).toBe(false);
		expect(parse("", "").success).toBe(false);
	});
});
