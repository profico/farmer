// The monthly hour fund — the denominator of Expected, and therefore of every
// "behind pace" nudge.
//
// The property this file exists to pin is the one the service's own docblock
// insists on and nothing enforced: NULL IS NOT ZERO. No row means "there is no
// Expected figure for this month", which the close sheet renders blank; a stored
// zero is a real claim that nobody was expected to work. Collapsing the two
// would turn every month an admin hasn't filled in yet into a month everybody
// under-delivered, silently and plausibly.
//
// Plus `prefillYear`, whose contract is "never clobber a hand-entered figure" —
// it implemented that as a read-then-skip with an unguarded bulk insert, so a
// concurrent `set` on any one month failed the whole batch.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { monthlyHourFund } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { hourFundService, WORKING_DAY_SECONDS } from "./hour-fund.service";
import type { Ctx } from "./types";

const ORG = "fund-org";

const ADMIN = "u-fund-admin";

const PLAIN = "u-fund-plain";

const YEAR = 2026;

let harness: TestDb;

const adminCtx: Ctx = { organizationId: ORG, userId: ADMIN };

const plainCtx: Ctx = { organizationId: ORG, userId: PLAIN };

/** A fresh Ctx per call: `requireAdmin` memoizes Access on the object, and a
 *  test that changes a role would otherwise read the picture from before it. */
const freshAdmin = (): Ctx => ({ organizationId: ORG, userId: ADMIN });

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Fund Org",
		slug: "fund-org",
		// Croatia: `suggestForMonth` reads the org's holiday calendar, and the
		// whole feature exists to reproduce a Croatian legal hour fund.
		country: "HR",
		createdAt: new Date(),
	});

	await db.insert(user).values(
		[ADMIN, PLAIN].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "mf-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: new Date(),
		},
		{
			id: "mf-plain",
			organizationId: ORG,
			userId: PLAIN,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db
		.delete(monthlyHourFund)
		.where(eq(monthlyHourFund.organizationId, ORG));
});

describe("null is not zero", () => {
	test("an unset month reads as null, not 0", async () => {
		expect(await hourFundService.get(adminCtx, YEAR, 1)).toBeNull();
	});

	test("a month set to zero reads as 0, not null", async () => {
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 1,
			fundSeconds: 0,
		});
		expect(await hourFundService.get(adminCtx, YEAR, 1)).toBe(0);
	});

	test("clear returns a month to unset — it is not the same as setting zero", async () => {
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 1,
			fundSeconds: 100 * 3600,
		});
		expect(await hourFundService.get(adminCtx, YEAR, 1)).toBe(100 * 3600);

		await hourFundService.clear(freshAdmin(), YEAR, 1);
		expect(await hourFundService.get(adminCtx, YEAR, 1)).toBeNull();
	});
});

describe("tenancy and authorization", () => {
	test("a non-admin cannot set a fund", async () => {
		await expect(
			hourFundService.set(
				{ ...plainCtx },
				{
					year: YEAR,
					month: 2,
					fundSeconds: 1,
				},
			),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("a non-admin cannot clear or prefill", async () => {
		await expect(
			hourFundService.clear({ ...plainCtx }, YEAR, 2),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			hourFundService.prefillYear({ ...plainCtx }, YEAR),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("another org's fund is invisible", async () => {
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 4,
			fundSeconds: 42,
		});
		const otherOrg: Ctx = { organizationId: "some-other-org", userId: ADMIN };
		expect(await hourFundService.get(otherOrg, YEAR, 4)).toBeNull();
	});
});

describe("set is an upsert", () => {
	test("setting the same month twice replaces rather than duplicating", async () => {
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 5,
			fundSeconds: 10,
		});
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 5,
			fundSeconds: 20,
		});
		expect(await hourFundService.get(adminCtx, YEAR, 5)).toBe(20);
		expect(await hourFundService.listForYear(adminCtx, YEAR)).toHaveLength(1);
	});
});

describe("getMany", () => {
	test("keys by yyyy-MM and omits months with no row", async () => {
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 1,
			fundSeconds: 111,
		});
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 3,
			fundSeconds: 333,
		});

		const funds = await hourFundService.getMany(adminCtx, [
			{ year: YEAR, month: 1 },
			{ year: YEAR, month: 2 },
			{ year: YEAR, month: 3 },
		]);

		expect(funds.get("2026-01")).toBe(111);
		// Absent, not zero — the caller has to keep reading that as null.
		expect(funds.has("2026-02")).toBe(false);
		expect(funds.get("2026-03")).toBe(333);
	});

	test("agrees with get, month for month, across a year boundary", async () => {
		await hourFundService.set(freshAdmin(), {
			year: 2025,
			month: 12,
			fundSeconds: 900,
		});
		await hourFundService.set(freshAdmin(), {
			year: 2026,
			month: 1,
			fundSeconds: 800,
		});

		const months = [
			{ year: 2025, month: 12 },
			{ year: 2026, month: 1 },
		];

		const funds = await hourFundService.getMany(adminCtx, months);

		for (const m of months) {
			const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
			expect(funds.get(key) ?? null).toBe(
				await hourFundService.get(adminCtx, m.year, m.month),
			);
		}
	});

	test("an empty month list asks nothing and answers nothing", async () => {
		expect((await hourFundService.getMany(adminCtx, [])).size).toBe(0);
	});

	test("does not see another year's rows", async () => {
		await hourFundService.set(freshAdmin(), {
			year: 2025,
			month: 6,
			fundSeconds: 7,
		});

		const funds = await hourFundService.getMany(adminCtx, [
			{ year: 2026, month: 6 },
		]);

		expect(funds.size).toBe(0);
	});
});

describe("suggestForMonth", () => {
	test("counts Mon-Fri days and multiplies by an 8h day", async () => {
		// March 2026: 31 days, 1 Mar is a Sunday → 22 weekdays, and Croatia has no
		// public holiday in March.
		const { workingDays, fundSeconds } = await hourFundService.suggestForMonth(
			adminCtx,
			2026,
			3,
		);

		expect(workingDays).toBe(22);
		expect(fundSeconds).toBe(22 * WORKING_DAY_SECONDS);
	});

	test("subtracts a public holiday that falls on a weekday", async () => {
		// 1 January 2026 is a Thursday and a Croatian public holiday, so January's
		// 22 weekdays are not all working days.
		const january = await hourFundService.suggestForMonth(adminCtx, 2026, 1);
		const bare = 22;
		expect(january.workingDays).toBeLessThan(bare);
	});

	test("suggests without writing", async () => {
		await hourFundService.suggestForMonth(adminCtx, YEAR, 7);
		expect(await hourFundService.get(adminCtx, YEAR, 7)).toBeNull();
	});
});

describe("prefillYear", () => {
	test("fills every month of an untouched year", async () => {
		const { filled } = await hourFundService.prefillYear(freshAdmin(), YEAR);
		expect(filled).toBe(12);
		expect(await hourFundService.listForYear(adminCtx, YEAR)).toHaveLength(12);
	});

	test("never clobbers a month an admin already set", async () => {
		const handEntered = 3 * 3600;
		await hourFundService.set(freshAdmin(), {
			year: YEAR,
			month: 6,
			fundSeconds: handEntered,
		});

		const { filled } = await hourFundService.prefillYear(freshAdmin(), YEAR);

		expect(filled).toBe(11);
		expect(await hourFundService.get(adminCtx, YEAR, 6)).toBe(handEntered);
	});

	test("re-running is a no-op rather than a duplicate-key failure", async () => {
		await hourFundService.prefillYear(freshAdmin(), YEAR);
		const second = await hourFundService.prefillYear(freshAdmin(), YEAR);
		expect(second.filled).toBe(0);
		expect(await hourFundService.listForYear(adminCtx, YEAR)).toHaveLength(12);
	});

	test("a month written between the read and the write is skipped, not fatal", async () => {
		// The race the unguarded bulk insert lost: `prefillYear` decides which
		// months are missing, and a second admin sets one of them before the insert
		// lands. Simulated by writing the row directly — the point is the INSERT's
		// behaviour on conflict, not the timing.
		//
		// Before the ON CONFLICT this threw on monthly_hour_fund's unique index and
		// filled none of the other eleven months.
		const ctx = freshAdmin();

		const known = new Set(
			(await hourFundService.listForYear(ctx, YEAR)).map((r) => r.month),
		);

		expect(known.size).toBe(0);

		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: YEAR,
			month: 9,
			fundSeconds: 1234,
		});

		const { filled } = await hourFundService.prefillYear(ctx, YEAR);

		// Eleven inserted, the racing month left exactly as the other writer left it.
		expect(filled).toBe(11);
		expect(await hourFundService.get(adminCtx, YEAR, 9)).toBe(1234);
		expect(await hourFundService.listForYear(adminCtx, YEAR)).toHaveLength(12);
	});

	test("cleared months are refillable — the only way to un-stick a wrong figure", async () => {
		await hourFundService.prefillYear(freshAdmin(), YEAR);
		await hourFundService.clear(freshAdmin(), YEAR, 2);
		expect(await hourFundService.get(adminCtx, YEAR, 2)).toBeNull();

		const { filled } = await hourFundService.prefillYear(freshAdmin(), YEAR);
		expect(filled).toBe(1);
		expect(await hourFundService.get(adminCtx, YEAR, 2)).not.toBeNull();
	});
});
