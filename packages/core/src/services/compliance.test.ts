// Tracking compliance (PRD 6.2) — the forgetting-detector, and the engine behind
// the Slack DMs. One mechanism, two outputs, so a bug here does not merely make
// a dashboard wrong: it messages real people, by name, about work they did do.
//
// The property worth the most is the one the service already carries a scar
// about, in `behindPace`:
//
//   ABSENCE IS SUBTRACTED FROM THE TARGET AND IS NOT CREDITED AS WORK.
//
// The pace query used to sum every entry in the range with no absence
// exclusion, while `expectedSecondsFor` subtracts absence days from the
// expectation. A person on vacation therefore had their target lowered AND
// their vacation counted as hours worked — credited twice, and hidden from a
// check whose entire job is to notice them. That is a nudge that never arrives,
// which is worse than one that shouldn't have: it looks like the app has
// nothing to say.
//
// Everything here is relative to "today" in the org's timezone. `NOW` pins that
// through the service's `{ now }` seam rather than letting the suite inherit the
// real clock: every figure is a fraction of the month elapsed, so an unpinned
// run asserts only what happens to be true on the day it executes — and on the
// 1st of a month, with no working day elapsed yet, `behindPace` is correctly
// empty and half of this file would fail for the right reason.
//
// Wednesday 15 April 2026, deliberately mid-month and mid-week: eleven working
// days elapsed of twenty-two, and no US public holiday anywhere near it.

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
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { monthlyHourFund, orgSettings } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { complianceService } from "./compliance.service";
import { WORKING_DAY_SECONDS } from "./hour-fund.service";
import type { Ctx } from "./types";

const H = 3600;
const ORG = "comp-org";

const ADMIN = "u-comp-admin";
/** Logs plenty, every day. Never flagged. */
const DILIGENT = "u-comp-diligent";
/** Logs nothing at all. */
const SILENT = "u-comp-silent";
/** Logs only Vacation — the double-credit case. */
const ON_LEAVE = "u-comp-leave";
/** Overhead: the CEO, never nagged about a timesheet. */
const OVERHEAD = "u-comp-overhead";
/** Contractor with no expected-hours override: no fund, so no pace. */
const CONTRACTOR = "u-comp-contractor";
/** Left the company; cannot act on a nudge. */
const ARCHIVED = "u-comp-archived";

const EVERYONE = [
	ADMIN,
	DILIGENT,
	SILENT,
	ON_LEAVE,
	OVERHEAD,
	CONTRACTOR,
	ARCHIVED,
];

let harness: TestDb;
let devTaskId: string;
let vacationTaskId: string;
let projectId: string;

/** The clock every call below is made against. The org timezone is UTC, so this
 *  instant and the day key the service derives from it cannot disagree. */
const NOW = new Date("2026-04-15T12:00:00Z");
const AT = { now: NOW };
const today = "2026-04-15";
const monthStart = "2026-04-01";

const adminCtx = (): Ctx => ({ organizationId: ORG, userId: ADMIN });

const logEntry = async (
	userId: string,
	date: string,
	taskId: string,
	durationSeconds: number,
	withProject = true,
) => {
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId,
		projectId: withProject ? projectId : null,
		taskId,
		date,
		description: "seeded",
		durationSeconds,
	});
};

const setFund = async (fundSeconds: number) => {
	const { year, month } = {
		year: Number(today.slice(0, 4)),
		month: Number(today.slice(5, 7)),
	};
	await db
		.insert(monthlyHourFund)
		.values({ organizationId: ORG, year, month, fundSeconds })
		.onConflictDoUpdate({
			target: [
				monthlyHourFund.organizationId,
				monthlyHourFund.year,
				monthlyHourFund.month,
			],
			set: { fundSeconds },
		});
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Compliance Org",
		slug: "comp-org",
		timezone: "UTC",
		// April 2026 has no US public holiday, so "working days elapsed" is just
		// the weekday count and nothing here turns on the holiday calendar.
		country: "US",
		createdAt: new Date(),
	});

	await db.insert(user).values(
		EVERYONE.map((id) => ({
			id,
			name: id.replace("u-comp-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values(
		EVERYONE.map((id) => ({
			id: `mc-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
	);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();
	if (!c) throw new Error("Failed to seed client");

	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: c.id,
			name: "Delivery",
			type: "product_team" as const,
		})
		.returning();
	if (!p) throw new Error("Failed to seed project");
	projectId = p.id;

	await db.insert(projectMember).values(
		EVERYONE.map((id) => ({
			organizationId: ORG,
			projectId,
			userId: id,
			role: "member" as const,
			active: true,
		})),
	);

	// Vacation comes from the seed script, which the harness does not run.
	const [dev, vacation] = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				systemKey: "development" as const,
			},
			{
				scope: "site" as const,
				name: "Vacation",
				isAbsence: true,
				systemKey: "vacation" as const,
			},
		])
		.returning();
	if (!dev || !vacation) throw new Error("Failed to seed tasks");
	devTaskId = dev.id;
	vacationTaskId = vacation.id;

	await db.insert(memberTypeHistory).values([
		{
			organizationId: ORG,
			userId: OVERHEAD,
			type: "employee_overhead" as const,
			effectiveFrom: "2020-01-01",
		},
		{
			organizationId: ORG,
			userId: CONTRACTOR,
			type: "contractor_hourly" as const,
			effectiveFrom: "2020-01-01",
		},
	]);

	await db.insert(memberProfile).values({
		organizationId: ORG,
		userId: ARCHIVED,
		archivedAt: new Date(),
	});
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry).where(eq(timeEntry.organizationId, ORG));
	await db
		.delete(monthlyHourFund)
		.where(eq(monthlyHourFund.organizationId, ORG));
	await db.delete(orgSettings).where(eq(orgSettings.organizationId, ORG));
});

describe("the cohort", () => {
	test("overhead and archived people are in neither view", async () => {
		await setFund(160 * H);
		const { noEntries, behindPace } = await complianceService.dashboard(
			adminCtx(),
			AT,
		);

		for (const view of [noEntries, behindPace]) {
			const ids = view.map((r) => r.userId);
			expect(ids).not.toContain(OVERHEAD);
			expect(ids).not.toContain(ARCHIVED);
		}
	});

	test("contractors are chased for entries but have no pace to be behind", async () => {
		await setFund(160 * H);
		const { noEntries, behindPace } = await complianceService.dashboard(
			adminCtx(),
			AT,
		);

		// A contractor still has to say what they did...
		expect(noEntries.map((r) => r.userId)).toContain(CONTRACTOR);
		// ...but no Croatian hour fund applies to them, so there is no expectation
		// to fall short of.
		expect(behindPace.map((r) => r.userId)).not.toContain(CONTRACTOR);
	});

	test("a contractor WITH an explicit expected override does get a pace", async () => {
		await db
			.update(memberTypeHistory)
			.set({ expectedSecondsOverride: 160 * H })
			.where(eq(memberTypeHistory.userId, CONTRACTOR));

		const behindPace = await complianceService.behindPace(adminCtx(), AT);
		expect(behindPace.map((r) => r.userId)).toContain(CONTRACTOR);

		await db
			.update(memberTypeHistory)
			.set({ expectedSecondsOverride: null })
			.where(eq(memberTypeHistory.userId, CONTRACTOR));
	});
});

describe("behind pace", () => {
	test("nobody is behind when there is no fund for the month", async () => {
		// No fund => no Expected => nothing to be behind. Deliberately not "zero
		// expected, therefore everyone is at 0%".
		expect(await complianceService.behindPace(adminCtx(), AT)).toEqual([]);
	});

	test("somebody who logged nothing is behind; somebody who logged plenty is not", async () => {
		await setFund(160 * H);
		// Far more than a whole month's fund, so no proration arithmetic can make
		// this person look short.
		await logEntry(DILIGENT, today, devTaskId, 400 * H);

		const rows = await complianceService.behindPace(adminCtx(), AT);
		const ids = rows.map((r) => r.userId);
		expect(ids).toContain(SILENT);
		expect(ids).not.toContain(DILIGENT);
	});

	test("vacation is not credited as hours worked", async () => {
		await setFund(160 * H);
		// The regression: a full month of Vacation and no work at all. Counting
		// absence as worked time made this person's pace look met.
		await logEntry(ON_LEAVE, monthStart, vacationTaskId, 8 * H, false);
		await logEntry(ON_LEAVE, today, vacationTaskId, 8 * H, false);

		const row = (await complianceService.behindPace(adminCtx(), AT)).find(
			(r) => r.userId === ON_LEAVE,
		);
		expect(row?.loggedSeconds).toBe(0);
	});

	test("absence lowers the expectation rather than raising the shortfall", async () => {
		await setFund(160 * H);

		const before = (await complianceService.behindPace(adminCtx(), AT)).find(
			(r) => r.userId === ON_LEAVE,
		);
		if (!before) throw new Error("expected a row before absence");

		// Two days of vacation, both already elapsed this month.
		await logEntry(
			ON_LEAVE,
			monthStart,
			vacationTaskId,
			WORKING_DAY_SECONDS,
			false,
		);
		await logEntry(ON_LEAVE, today, vacationTaskId, WORKING_DAY_SECONDS, false);

		const after = (await complianceService.behindPace(adminCtx(), AT)).find(
			(r) => r.userId === ON_LEAVE,
		);
		if (!after) throw new Error("expected a row after absence");

		// Same zero hours logged, but a smaller target — so the person is LESS
		// behind, not more. If absence were also being credited as work, logged
		// would have moved instead.
		expect(after.loggedSeconds).toBe(0);
		expect(after.proratedExpectedSeconds).toBeLessThan(
			before.proratedExpectedSeconds,
		);
		expect(after.shortfallSeconds).toBeLessThan(before.shortfallSeconds);
	});

	// The absence query is month-to-date already, so it is subtracted whole from
	// the prorated target. It used to be subtracted from the MONTH's target and
	// then scaled with it — here (160h - 40h) x 0.5 = 60h, which put somebody who
	// had logged every hour of the days they were in at 67% and nagged them.
	test("elapsed absence comes off the prorated target whole, not scaled", async () => {
		await setFund(160 * H);
		// Five vacation days, Monday 6 to Friday 10 April — all before today.
		for (const day of ["06", "07", "08", "09", "10"]) {
			await logEntry(
				ON_LEAVE,
				`2026-04-${day}`,
				vacationTaskId,
				WORKING_DAY_SECONDS,
				false,
			);
		}
		await logEntry(ON_LEAVE, "2026-04-13", devTaskId, 30 * H);

		// Eleven of twenty-two working days elapsed: 160h x 0.5 = 80h, less the
		// 40h already taken as vacation.
		const row = (await complianceService.behindPace(adminCtx(), AT)).find(
			(r) => r.userId === ON_LEAVE,
		);
		expect(row?.proratedExpectedSeconds).toBe(40 * H);

		// And 40h worked meets it: not behind.
		await logEntry(ON_LEAVE, "2026-04-14", devTaskId, 10 * H);
		const ids = (await complianceService.behindPace(adminCtx(), AT)).map(
			(r) => r.userId,
		);
		expect(ids).not.toContain(ON_LEAVE);
	});

	test("unfiled work still counts as work", async () => {
		await setFund(160 * H);
		// An imported meeting is work; it is just not attributed to a project yet.
		// Excluding it here would nag somebody for hours they plainly logged.
		await logEntry(DILIGENT, today, devTaskId, 400 * H, false);

		const ids = (await complianceService.behindPace(adminCtx(), AT)).map(
			(r) => r.userId,
		);
		expect(ids).not.toContain(DILIGENT);
	});

	test("the pace figures are internally consistent", async () => {
		await setFund(160 * H);
		await logEntry(SILENT, today, devTaskId, 1 * H);

		const row = (await complianceService.behindPace(adminCtx(), AT)).find(
			(r) => r.userId === SILENT,
		);
		if (!row) throw new Error("expected a row");

		expect(row.loggedSeconds).toBe(1 * H);
		expect(row.shortfallSeconds).toBe(
			row.proratedExpectedSeconds - row.loggedSeconds,
		);
		expect(row.pacePct).toBe(
			Math.round((row.loggedSeconds / row.proratedExpectedSeconds) * 100),
		);
		// The threshold is 0.9, hardcoded on purpose.
		expect(row.pacePct).toBeLessThan(90);
	});

	test("rows come back worst-first", async () => {
		await setFund(160 * H);
		await logEntry(SILENT, today, devTaskId, 1 * H);

		const rows = await complianceService.behindPace(adminCtx(), AT);
		const paces = rows.map((r) => r.pacePct);
		expect([...paces].sort((a, b) => a - b)).toEqual(paces);
	});
});

describe("no entries", () => {
	test("somebody who has never logged anything is flagged", async () => {
		const rows = await complianceService.noEntries(adminCtx(), AT);
		const row = rows.find((r) => r.userId === SILENT);
		expect(row?.lastEntryDate).toBeNull();
		expect(row?.workingDaysMissing).toBeGreaterThan(0);
	});

	test("an entry today clears the flag", async () => {
		await logEntry(DILIGENT, today, devTaskId, 8 * H);

		const ids = (await complianceService.noEntries(adminCtx(), AT)).map(
			(r) => r.userId,
		);
		expect(ids).not.toContain(DILIGENT);
	});

	test("absence counts as having logged something", async () => {
		// The person told us where they were. Nagging them to log a day they
		// already recorded as vacation is exactly the noise that gets reminders
		// muted.
		await logEntry(ON_LEAVE, today, vacationTaskId, 8 * H, false);

		const ids = (await complianceService.noEntries(adminCtx(), AT)).map(
			(r) => r.userId,
		);
		expect(ids).not.toContain(ON_LEAVE);
	});

	test("lastEntryDate reports the most recent entry, however old", async () => {
		await logEntry(SILENT, "2020-01-15", devTaskId, 4 * H);
		await logEntry(SILENT, "2020-02-20", devTaskId, 4 * H);

		const row = (await complianceService.noEntries(adminCtx(), AT)).find(
			(r) => r.userId === SILENT,
		);
		expect(row?.lastEntryDate).toBe("2020-02-20");
	});

	test("rows come back most-overdue first", async () => {
		const rows = await complianceService.noEntries(adminCtx(), AT);
		const missing = rows.map((r) => r.workingDaysMissing);
		expect([...missing].sort((a, b) => b - a)).toEqual(missing);
	});

	test("the lookback window honours complianceMissingDays", async () => {
		// With a one-working-day window, only somebody who logged nothing at all
		// recently is flagged — and the window is still long enough to contain a
		// working day whatever today happens to be.
		await db
			.insert(orgSettings)
			.values({ organizationId: ORG, complianceMissingDays: 1 })
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: { complianceMissingDays: 1 },
			});

		const rows = await complianceService.noEntries(adminCtx(), AT);
		expect(rows.map((r) => r.userId)).toContain(SILENT);
	});
});

describe("authorization", () => {
	test("a plain member sees only themselves in either view", async () => {
		const plain = (): Ctx => ({ organizationId: ORG, userId: SILENT });

		const noEntries = await complianceService.noEntries(plain(), AT);
		expect(noEntries.map((r) => r.userId)).toEqual([SILENT]);
		const behindPace = await complianceService.behindPace(plain(), AT);
		for (const row of behindPace) expect(row.userId).toBe(SILENT);
		const dashboard = await complianceService.dashboard(plain(), AT);
		expect(dashboard.noEntries.map((r) => r.userId)).toEqual([SILENT]);
	});

	test("the reminder job's entry point answers without a caller", async () => {
		// It builds an org-only Ctx with an empty userId, which cannot satisfy an
		// admin check — the whole reason it is a separately named export rather
		// than a `skipAdminCheck` flag.
		await setFund(160 * H);
		const jobCtx: Ctx = { organizationId: ORG, userId: "" };
		const { noEntries, behindPace } =
			await complianceService.dashboardForReminderJob(jobCtx, AT);

		expect(noEntries.map((r) => r.userId)).toContain(SILENT);
		expect(behindPace.map((r) => r.userId)).toContain(SILENT);
	});

	test("another org's people are never in the answer", async () => {
		await setFund(160 * H);
		const rows = await complianceService.noEntries(adminCtx(), AT);
		for (const row of rows) expect(EVERYONE).toContain(row.userId);
	});
});
