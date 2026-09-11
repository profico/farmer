// The ceiling on the Harvest snapshot range.
//
// The snapshot reads every entry of the range an export spans, so it is the
// one read in the app that legitimately reaches back a decade: the real export
// runs from 2014-12 to 2026-09. It had no ceiling at all, which let a hand-made
// request ask for every entry since year 1. The ceiling is generous on purpose
// and far above the 62-day entry cap and the 366-day report cap.

import { describe, expect, test } from "bun:test";

import {
	HARVEST_SNAPSHOT_MAX_YEARS,
	harvestSnapshotInput,
} from "./harvest-import";

const parse = (from: string, to: string) =>
	harvestSnapshotInput.safeParse({ from, to, emails: [] });

describe("harvestSnapshotInput", () => {
	test("accepts the twelve years the real export spans", () => {
		expect(parse("2014-12-30", "2026-09-14").success).toBe(true);
	});

	test("accepts the full ceiling", () => {
		expect(HARVEST_SNAPSHOT_MAX_YEARS).toBe(20);
		expect(parse("2006-01-01", "2025-12-31").success).toBe(true);
	});

	test("refuses a range past the ceiling", () => {
		expect(parse("0001-01-01", "2026-09-14").success).toBe(false);
		expect(parse("2000-01-01", "2026-09-14").success).toBe(false);
	});

	test("refuses a range that ends before it starts", () => {
		expect(parse("2026-09-14", "2026-09-13").success).toBe(false);
	});
});
