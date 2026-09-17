// Booking absence as a SPAN, and reading a year of it back.
//
// "I'm off the 23rd to the 29th" is one sentence and, day by day, seven writes.
// Expanding it in the caller is what this exists to prevent: the two rules that
// decide which of those days get an entry are not visible to a caller — the
// person's own working-hours schedule and the org's holiday calendar — and a
// caller that guessed would book vacation on days nobody was going to work,
// which quietly inflates the absence figure the close sheet subtracts from
// Expected.
//
// So the properties here are about WHICH days it picks, that it says which ones
// it skipped and why, and that asking twice does not book twice.

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
import { task, timeEntry } from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG = "abs-org";

const ME = "u-abs-me";

const OTHER = "u-abs-other";

let harness: TestDb;

let vacationTaskId: string;

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

beforeAll(async () => {
	harness = await createTestDb();

	// Country defaults to US, so Memorial Day (Mon 25 May 2026) is a public
	// holiday in the middle of the span below — which is the point of the span.
	await db.insert(organization).values({
		id: ORG,
		name: "Absence Co",
		slug: ORG,
		createdAt: new Date(),
	});

	await db.insert(user).values(
		[ME, OTHER].map((id) => ({
			id,
			name: id.replace("u-abs-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "m-abs-me",
			organizationId: ORG,
			userId: ME,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-abs-other",
			organizationId: ORG,
			userId: OTHER,
			role: "member",
			createdAt: new Date(),
		},
	]);

	// The harness runs the migrations but not `db/seed-tasks`, so the absence
	// tasks do not exist. Seeded once here rather than per test: site tasks are
	// unique on both name and systemKey.
	const [vacation] = await db
		.insert(task)
		.values({
			scope: "site" as const,
			name: "Vacation",
			systemKey: "vacation" as const,
			isAbsence: true,
		})
		.returning();

	if (!vacation) throw new Error("Failed to seed the Vacation task");
	vacationTaskId = vacation.id;

	// No memberWorkingHoursDay rows on purpose: everyone gets the synthesized
	// Mon-Fri 09:00-17:00 default, so a booked day is 8 hours and a weekend is
	// not a working day at all.
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
});

const dates = (rows: { date: string }[]) => rows.map((row) => row.date);

describe("logAbsenceRange", () => {
	test("books the working days and reports the rest with a reason", async () => {
		// Sat 23 May 2026 → Fri 29 May. Two weekend days, one public holiday
		// (Memorial Day, Mon 25), four bookable days.
		const result = await timeEntriesService.logAbsenceRange(ctx(ME), {
			taskId: vacationTaskId,
			from: "2026-05-23",
			to: "2026-05-29",
			description: "Off",
		});

		expect(dates(result.booked)).toEqual([
			"2026-05-26",
			"2026-05-27",
			"2026-05-28",
			"2026-05-29",
		]);
		// The whole day, from the person's own schedule — not a flat eight hours
		// assumed by the caller.
		expect(result.booked.every((day) => day.durationSeconds === 8 * 3600)).toBe(
			true,
		);

		// Skipped days are named rather than silently missing: "booked 4 days,
		// skipped 3" is the difference between a caller that can tell the person
		// what happened and one that claims a week it did not book.
		expect(dates(result.skipped)).toEqual([
			"2026-05-23",
			"2026-05-24",
			"2026-05-25",
		]);
		expect(result.skipped.at(-1)?.reason).toMatch(/holiday/i);
		expect(result.skipped[0]?.reason).toMatch(/not a working day/i);

		const stored = await db.query.timeEntry.findMany({
			where: eq(timeEntry.userId, ME),
		});

		expect(stored).toHaveLength(4);
		// Absence carries no project by definition.
		expect(stored.every((row) => row.projectId === null)).toBe(true);
	});

	test("asking twice does not book twice", async () => {
		const input = {
			taskId: vacationTaskId,
			from: "2026-05-26",
			to: "2026-05-27",
		};

		await timeEntriesService.logAbsenceRange(ctx(ME), input);
		const again = await timeEntriesService.logAbsenceRange(ctx(ME), input);

		expect(again.booked).toHaveLength(0);
		expect(again.skipped).toHaveLength(2);
		expect(again.skipped[0]?.reason).toMatch(/already logged/i);

		const stored = await db.query.timeEntry.findMany({
			where: eq(timeEntry.userId, ME),
		});

		expect(stored).toHaveLength(2);
	});

	test("a whole span of non-working days books nothing and says so", async () => {
		// Sat and Sun. Not an error — the person asked for something coherent and
		// the answer is that none of it was a working day.
		const result = await timeEntriesService.logAbsenceRange(ctx(ME), {
			taskId: vacationTaskId,
			from: "2026-05-23",
			to: "2026-05-24",
		});

		expect(result.booked).toHaveLength(0);
		expect(result.skipped).toHaveLength(2);
	});

	test("refuses a task that is not absence", async () => {
		// The tool is `log_absence`, not a bulk-create back door: expanding a span
		// into a week of worked time would bypass the per-day description rule that
		// every worked entry carries.
		const [development] = await db
			.insert(task)
			.values({
				organizationId: ORG,
				name: "Development",
				scope: "organization" as const,
			})
			.returning();

		if (!development) throw new Error("Failed to seed the Development task");

		await expect(
			timeEntriesService.logAbsenceRange(ctx(ME), {
				taskId: development.id,
				from: "2026-05-26",
				to: "2026-05-27",
			}),
		).rejects.toThrow(/Only absence tasks can be logged this way/);
	});
});

describe("absenceTotals", () => {
	test("a year, grouped by task, in days as well as seconds", async () => {
		await timeEntriesService.logAbsenceRange(ctx(ME), {
			taskId: vacationTaskId,
			from: "2026-05-26",
			to: "2026-05-29",
		});

		const totals = await timeEntriesService.absenceTotals(ctx(ME), {
			year: 2026,
		});

		expect(totals).toHaveLength(1);
		expect(totals[0]?.taskName).toBe("Vacation");
		expect(totals[0]?.seconds).toBe(4 * 8 * 3600);
		// The same divisor the close sheet subtracts from Expected. Two divisors
		// would mean a person and their PM reading different day counts off the
		// same rows.
		expect(totals[0]?.days).toBe(4);
	});

	test("a different year is a different question", async () => {
		await timeEntriesService.logAbsenceRange(ctx(ME), {
			taskId: vacationTaskId,
			from: "2026-05-26",
			to: "2026-05-27",
		});
		expect(
			await timeEntriesService.absenceTotals(ctx(ME), { year: 2025 }),
		).toEqual([]);
	});

	test("a plain member can read their own and not somebody else's", async () => {
		// Own absence was the case the PM gate left out: a Member is PM of nothing,
		// so `canOverrideAbsenceFor` alone answered "no" to a person asking about
		// their own vacation — rows `listRange` hands them anyway.
		await expect(
			timeEntriesService.absenceTotals(ctx(ME), { year: 2026, userId: ME }),
		).resolves.toEqual([]);

		await expect(
			timeEntriesService.absenceTotals(ctx(ME), { year: 2026, userId: OTHER }),
		).rejects.toThrow(AccessError);
	});
});
