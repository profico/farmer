// Guards the two module-level caches in `holidays.service`.
//
// The service now keeps one `date-holidays` instance per country for the life of
// the process, because `holidaySetForRange` is called from inside the reminder
// jobs' per-member loop and was rebuilding the whole national rule set for every
// person on every tick.
//
// A process-lifetime cache in a multi-tenant service is exactly the shape that
// leaks one org's answer to another, so the interesting tests here are not "does
// it still list holidays" but:
//
//   * two orgs on DIFFERENT countries must not share a calendar, and
//   * two orgs on the SAME country must still get their own opt-outs applied,
//     because the cached thing is the country's rules and the per-org disabled
//     set is deliberately read fresh every call.
//
// Also pins that repeated and interleaved year queries against one cached
// instance stay stable — the property that makes reuse safe at all.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { holidaysService } from "./holidays.service";
import type { Ctx } from "./types";

let harness: TestDb;

const HR_ORG = "hol-hr";

const HR_ORG_2 = "hol-hr-2";

const US_ORG = "hol-us";

const ctx = (organizationId: string): Ctx => ({
	organizationId,
	userId: "u-holidays",
});

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values([
		{
			id: HR_ORG,
			name: "Croatia Co",
			slug: HR_ORG,
			country: "HR",
			createdAt: new Date(),
		},
		{
			id: HR_ORG_2,
			name: "Croatia Two",
			slug: HR_ORG_2,
			country: "HR",
			createdAt: new Date(),
		},
		{
			id: US_ORG,
			name: "US Co",
			slug: US_ORG,
			country: "US",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("the per-country instance cache", () => {
	test("repeated calls return identical results", async () => {
		const first = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		const second = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		expect(first.length).toBeGreaterThan(0);
		expect(second).toEqual(first);
	});

	// The property that makes reusing one instance safe: asking for another year
	// in between must not disturb the answer.
	test("interleaving a different year does not disturb the first", async () => {
		const before = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		await holidaysService.listForYear(ctx(HR_ORG), 2025);
		await holidaysService.listForYear(ctx(HR_ORG), 2027);
		const after = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		expect(after).toEqual(before);
	});

	test("different countries get different calendars", async () => {
		const hr = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		const us = await holidaysService.listForYear(ctx(US_ORG), 2026);
		// Both non-empty, and not the same list — the cache is keyed by country,
		// so a shared instance would show up as these being identical.
		expect(hr.length).toBeGreaterThan(0);
		expect(us.length).toBeGreaterThan(0);
		expect(us.map((h) => h.name)).not.toEqual(hr.map((h) => h.name));
	});

	// The leak this test exists to catch: the country RULES are cached, the org's
	// opt-outs are not. Two orgs in the same country must diverge the moment one
	// disables something.
	test("two orgs in the same country keep separate opt-outs", async () => {
		const baseline = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		const target = baseline[0];

		if (!target) throw new Error("expected at least one holiday to disable");

		await holidaysService.setHolidayDisabled(ctx(HR_ORG), {
			name: target.name,
			disabled: true,
		});

		const disabledOrg = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		const untouchedOrg = await holidaysService.listForYear(ctx(HR_ORG_2), 2026);

		expect(disabledOrg.map((h) => h.name)).not.toContain(target.name);
		expect(untouchedOrg.map((h) => h.name)).toContain(target.name);

		// And re-enabling brings it back, i.e. nothing about the removal was baked
		// into the cached instance.
		await holidaysService.setHolidayDisabled(ctx(HR_ORG), {
			name: target.name,
			disabled: false,
		});
		const reenabled = await holidaysService.listForYear(ctx(HR_ORG), 2026);
		expect(reenabled.map((h) => h.name)).toContain(target.name);
	});

	test("listForYearWithStatus reports the org's own disabled flags", async () => {
		const all = await holidaysService.listForYearWithStatus(ctx(HR_ORG), 2026);
		const target = all[0];

		if (!target) throw new Error("expected at least one holiday");
		expect(target.disabled).toBe(false);

		await holidaysService.setHolidayDisabled(ctx(HR_ORG), {
			name: target.name,
			disabled: true,
		});

		const after = await holidaysService.listForYearWithStatus(
			ctx(HR_ORG),
			2026,
		);

		expect(after.find((h) => h.name === target.name)?.disabled).toBe(true);
		// Every holiday is still listed — status view, not a filter.
		expect(after.length).toBe(all.length);

		await holidaysService.setHolidayDisabled(ctx(HR_ORG), {
			name: target.name,
			disabled: false,
		});
	});
});

describe("listSupportedCountries", () => {
	test("returns a non-empty, name-sorted list", () => {
		const countries = holidaysService.listSupportedCountries();
		expect(countries.length).toBeGreaterThan(50);
		const names = countries.map((c) => c.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	// The list is cached, so it has to be handed out as a copy — otherwise the
	// first caller to sort or splice it corrupts it for the process's lifetime.
	test("hands out a fresh array each call, not the cached one", () => {
		const first = holidaysService.listSupportedCountries();
		const second = holidaysService.listSupportedCountries();
		expect(first).not.toBe(second);
		expect(first).toEqual(second);

		first.length = 0;
		expect(holidaysService.listSupportedCountries().length).toBeGreaterThan(50);
	});
});
