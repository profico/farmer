// The Tracking rule (PRD 6.2, revised Sept 2026): every figure below is the
// month's hour fund prorated by the Monday-to-Friday days elapsed, against a
// person's work PLUS time-off. "Elapsed" counts only working days strictly
// BEFORE the pinned clock's day — today's own day is still in progress.
// April 2026 has 22 working days; the clock is pinned to Thursday the 16th,
// whose 11 working days before it (through Wednesday the 15th) are exactly
// half the month, so the target so far is exactly half the fund.

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
import { accessService } from "./access.service";
import { findTool } from "./assistant-tools";
import { complianceService } from "./compliance.service";
import { membersService } from "./members.service";
import { orgSettingsService } from "./org-settings.service";
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
const NOW = new Date("2026-04-16T12:00:00Z");

const AT = { now: NOW };

const today = "2026-04-16";

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

const APRIL = { year: 2026, month: 4 };

const track = (opts = AT) =>
	complianceService.tracking(adminCtx(), APRIL, opts);

const rowFor = async (userId: string) =>
	(await track()).rows.find((r) => r.userId === userId);

const setTolerance = (trackingTolerancePct: number) =>
	orgSettingsService.update(adminCtx(), { trackingTolerancePct });

describe("the cohort", () => {
	test("overhead and archived people are not listed; hourly people are, with no target", async () => {
		await setFund(160 * H);
		const report = await track();
		const ids = report.rows.map((r) => r.userId);
		expect(ids).not.toContain(OVERHEAD);
		expect(ids).not.toContain(ARCHIVED);
		expect(ids).toContain(CONTRACTOR);
		const contractor = await rowFor(CONTRACTOR);
		expect(contractor?.targetSeconds).toBeNull();
		expect(contractor?.status).toBeNull();
	});

	test("an hourly person WITH an explicit expected override gets a prorated target", async () => {
		await setFund(160 * H);
		await membersService.setType(adminCtx(), {
			userId: CONTRACTOR,
			type: "contractor_hourly",
			expectedSecondsOverride: 80 * H,
			effectiveFrom: monthStart,
		});

		try {
			const contractor = await rowFor(CONTRACTOR);
			expect(contractor?.targetSeconds).toBe(40 * H);
			expect(contractor?.status).toBe("behind");
		} finally {
			await membersService.setType(adminCtx(), {
				userId: CONTRACTOR,
				type: "contractor_hourly",
				expectedSecondsOverride: null,
				effectiveFrom: monthStart,
			});
		}
	});
});

describe("the target", () => {
	test("is the fund prorated by working days elapsed — 8h a day", async () => {
		await setFund(160 * H);
		const report = await track();
		expect(report.workingDaysInMonth).toBe(22);
		expect(report.workingDaysElapsed).toBe(11);
		expect(report.targetSeconds).toBe(80 * H);
		expect(report.complete).toBe(false);
		expect(report.asOf).toBe(today);
	});

	test("leaves public holidays out of the day count, so a working day stays 8h", async () => {
		// This org is in the US: Memorial Day, Monday 25 May 2026, is off. May
		// has 21 weekdays, 20 working days; before Wednesday the 27th (through
		// Tuesday the 26th), 18 weekdays and 17 working days. 160h over 20 days
		// is 8h a day → 136h.
		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: 2026,
			month: 5,
			fundSeconds: 160 * H,
		});

		const report = await complianceService.tracking(
			adminCtx(),
			{ year: 2026, month: 5 },
			{ now: new Date("2026-05-27T12:00:00Z") },
		);

		expect(report.workingDaysInMonth).toBe(20);
		expect(report.workingDaysElapsed).toBe(17);
		expect(report.targetSeconds).toBe(136 * H);
	});

	test("is the whole fund once the month is over", async () => {
		await setFund(160 * H);
		const report = await track({ now: new Date("2026-05-10T12:00:00Z") });
		expect(report.complete).toBe(true);
		expect(report.asOf).toBe("2026-04-30");
		expect(report.workingDaysElapsed).toBe(22);
		expect(report.targetSeconds).toBe(160 * H);
	});

	test("is zero before the month starts, and nobody is behind", async () => {
		await setFund(160 * H);
		const report = await track({ now: new Date("2026-03-20T12:00:00Z") });
		expect(report.workingDaysElapsed).toBe(0);
		expect(report.targetSeconds).toBe(0);
		expect(report.rows).toEqual([]);
	});

	test("with no fund there is no target and no verdict", async () => {
		await logEntry(DILIGENT, today, devTaskId, 8 * H);
		const report = await track();
		expect(report.fundSeconds).toBeNull();
		expect(report.targetSeconds).toBeNull();

		for (const row of report.rows) {
			expect(row.targetSeconds).toBeNull();
			expect(row.status).toBeNull();
		}
	});
});

describe("the verdict", () => {
	test("on track, slightly behind within the tolerance, behind beyond it", async () => {
		await setFund(160 * H);
		// Target so far: 80h. Tolerance 5% → slightly behind from 76h up.
		await logEntry(DILIGENT, today, devTaskId, 80 * H);
		await logEntry(ADMIN, today, devTaskId, 76 * H);
		await logEntry(ON_LEAVE, today, devTaskId, 75 * H);
		expect((await rowFor(DILIGENT))?.status).toBe("on_track");
		expect((await rowFor(ADMIN))?.status).toBe("slightly_behind");
		expect((await rowFor(ON_LEAVE))?.status).toBe("behind");
		expect((await rowFor(SILENT))?.status).toBe("behind");
	});

	test("time-off counts toward the total like work", async () => {
		await setFund(160 * H);
		await logEntry(ON_LEAVE, "2026-04-06", devTaskId, 40 * H);
		await logEntry(ON_LEAVE, "2026-04-13", vacationTaskId, 40 * H, false);
		const row = await rowFor(ON_LEAVE);
		expect(row?.workSeconds).toBe(40 * H);
		expect(row?.timeOffSeconds).toBe(40 * H);
		expect(row?.totalSeconds).toBe(80 * H);
		expect(row?.deltaSeconds).toBe(0);
		expect(row?.status).toBe("on_track");
	});

	test("the tolerance is the org's setting", async () => {
		await setFund(160 * H);
		await logEntry(DILIGENT, today, devTaskId, 60 * H);
		expect((await rowFor(DILIGENT))?.status).toBe("behind");
		await setTolerance(25);
		expect((await track()).tolerancePct).toBe(25);
		expect((await rowFor(DILIGENT))?.status).toBe("slightly_behind");
		await setTolerance(0);
		expect((await rowFor(DILIGENT))?.status).toBe("behind");
	});

	test("rows come back worst first, people without a target last", async () => {
		await setFund(160 * H);
		await logEntry(DILIGENT, today, devTaskId, 80 * H);
		await logEntry(ADMIN, today, devTaskId, 77 * H);
		await logEntry(ON_LEAVE, today, devTaskId, 10 * H);
		const ids = (await track()).rows.map((r) => r.userId);
		expect(ids.indexOf(SILENT)).toBeLessThan(ids.indexOf(ON_LEAVE));
		expect(ids.indexOf(ON_LEAVE)).toBeLessThan(ids.indexOf(ADMIN));
		expect(ids.indexOf(ADMIN)).toBeLessThan(ids.indexOf(DILIGENT));
		expect(ids.at(-1)).toBe(CONTRACTOR);
	});

	test("a full day logged on every earlier working day is on track before today's own day ends", async () => {
		// 176h over 22 working days is a clean 8h a day. Friday the 17th is the
		// month's 13th working day, so 12 working days (through Thursday the
		// 16th) are elapsed before it — even at 08:00, before anyone would have
		// logged a minute of Friday itself.
		await setFund(176 * H);

		const workingDaysBeforeFriday = [
			"2026-04-01",
			"2026-04-02",
			"2026-04-03",
			"2026-04-06",
			"2026-04-07",
			"2026-04-08",
			"2026-04-09",
			"2026-04-10",
			"2026-04-13",
			"2026-04-14",
			"2026-04-15",
			"2026-04-16",
		];

		for (const date of workingDaysBeforeFriday) {
			await logEntry(DILIGENT, date, devTaskId, 8 * H);
		}

		const report = await track({ now: new Date("2026-04-17T08:00:00Z") });
		expect(report.workingDaysElapsed).toBe(12);
		expect(report.targetSeconds).toBe(96 * H);
		const row = report.rows.find((r) => r.userId === DILIGENT);
		expect(row?.totalSeconds).toBe(96 * H);
		expect(row?.status).toBe("on_track");
	});
});

describe("authorization", () => {
	test("a plain member sees only themselves", async () => {
		await setFund(160 * H);
		const plain = (): Ctx => ({ organizationId: ORG, userId: SILENT });
		const report = await complianceService.tracking(plain(), APRIL, AT);
		expect(report.rows.map((r) => r.userId)).toEqual([SILENT]);
	});

	test("the reminder job's entry point answers without a caller", async () => {
		// It builds an org-only Ctx with an empty userId, which cannot satisfy any
		// access check — the whole reason it is a separately named export.
		await setFund(160 * H);
		const jobCtx: Ctx = { organizationId: ORG, userId: "" };

		const report = await complianceService.trackingForReminderJob(
			jobCtx,
			APRIL,
			AT,
		);

		expect(report.rows.map((r) => r.userId)).toContain(SILENT);
		expect(report.rows.map((r) => r.userId)).toContain(DILIGENT);
	});
});

// ── My targets ─────────────────────────────────────────────────────────────

describe("my targets", () => {
	const ctxOf = (userId: string): Ctx => ({ organizationId: ORG, userId });
	// Thursday 16 April 2026 (`AT`): three working days of its week and 11 of
	// the month's 22 are strictly before today.

	test("the week and the month, each with where you should be by today", async () => {
		await setFund(176 * H);
		await logEntry(DILIGENT, "2026-04-13", devTaskId, 8 * H);
		await logEntry(DILIGENT, "2026-04-14", devTaskId, 8 * H);
		await logEntry(DILIGENT, "2026-04-15", devTaskId, 8 * H);
		// Time off booked for Friday shows in the week's total and its "to go"
		// line — it is hours the week has — but Friday is still ahead of today
		// (Thursday), so it does not count towards where they should be by
		// today, nor towards the verdict.
		await logEntry(DILIGENT, "2026-04-17", vacationTaskId, 8 * H, false);

		const mine = await complianceService.myTargets(ctxOf(DILIGENT), AT);
		expect(mine.today).toBe(today);
		expect(mine.daySeconds).toBe(8 * H);
		expect(mine.week).toMatchObject({
			from: "2026-04-13",
			to: "2026-04-19",
			workingDays: 5,
			// Working days strictly before Thursday: Monday to Wednesday, 3 of
			// the week's 5 — matching the Tracking report's own elapsed count.
			workingDaysElapsed: 3,
			targetSeconds: 40 * H,
			targetSoFarSeconds: 24 * H,
			workSeconds: 24 * H,
			timeOffSeconds: 8 * H,
			totalSeconds: 32 * H,
			// Through today: Monday to Wednesday's work, not Friday's
			// booked-ahead vacation.
			totalSoFarSeconds: 24 * H,
			status: "on_track",
		});
		expect(mine.month).toMatchObject({
			from: "2026-04-01",
			to: "2026-04-30",
			workingDays: 22,
			workingDaysElapsed: 11,
			targetSeconds: 176 * H,
			targetSoFarSeconds: 88 * H,
			totalSeconds: 32 * H,
			// The Tracking row's own total: work through today, Friday's
			// booked-ahead vacation excluded.
			totalSoFarSeconds: 24 * H,
			status: "behind",
		});
	});

	test("booked-ahead time off does not flatter the verdict", async () => {
		await setFund(176 * H);
		// Behind through today: 2h logged against a week whose first two working
		// days (Monday, Tuesday) are worth 16h.
		await logEntry(DILIGENT, "2026-04-13", devTaskId, 2 * H);
		// A full week of vacation booked for next week — still within April, so
		// it inflates the month's whole-period total, but every day of it is
		// after today.
		await logEntry(DILIGENT, "2026-04-20", vacationTaskId, 8 * H, false);
		await logEntry(DILIGENT, "2026-04-21", vacationTaskId, 8 * H, false);
		await logEntry(DILIGENT, "2026-04-22", vacationTaskId, 8 * H, false);
		await logEntry(DILIGENT, "2026-04-23", vacationTaskId, 8 * H, false);
		await logEntry(DILIGENT, "2026-04-24", vacationTaskId, 8 * H, false);

		const mine = await complianceService.myTargets(ctxOf(DILIGENT), AT);
		// The whole-period totals do carry the booked-ahead week — the top
		// figure and "to go" line are allowed to count it.
		expect(mine.week.totalSeconds).toBe(2 * H);
		expect(mine.month.totalSeconds).toBe(42 * H);
		// But the verdict and the gap are read through today only, so booking a
		// week off next week cannot turn "behind" into "on track".
		expect(mine.week.totalSoFarSeconds).toBe(2 * H);
		expect(mine.week.status).toBe("behind");
		expect(mine.month.totalSoFarSeconds).toBe(2 * H);
		expect(mine.month.status).toBe("behind");
	});

	test("without a fund the month has no target but the week still has its 8h days", async () => {
		const mine = await complianceService.myTargets(ctxOf(DILIGENT), AT);
		expect(mine.daySeconds).toBe(8 * H);
		expect(mine.week.targetSeconds).toBe(40 * H);
		// Monday to Wednesday, the working days strictly before Thursday.
		expect(mine.week.targetSoFarSeconds).toBe(24 * H);
		expect(mine.month.targetSeconds).toBeNull();
		expect(mine.month.targetSoFarSeconds).toBeNull();
		expect(mine.month.status).toBeNull();
	});

	test("an hourly person without an override has hours and no target, in either period", async () => {
		await setFund(176 * H);
		await logEntry(CONTRACTOR, "2026-04-14", devTaskId, 5 * H);
		const mine = await complianceService.myTargets(ctxOf(CONTRACTOR), AT);
		expect(mine.week.totalSeconds).toBe(5 * H);
		expect(mine.week.targetSeconds).toBeNull();
		expect(mine.week.status).toBeNull();
		expect(mine.month.targetSeconds).toBeNull();
		expect(mine.month.status).toBeNull();
	});

	test("a day's worth follows the fund: an unofficial fund makes a shorter day", async () => {
		await setFund(154 * H);
		const mine = await complianceService.myTargets(ctxOf(DILIGENT), AT);
		expect(mine.daySeconds).toBe(7 * H);
		expect(mine.week.targetSeconds).toBe(35 * H);
	});
});

// ── the assistant reads the same rule ───────────────────────────────────────
//
// Asked "am I behind", the assistant used to add up a month of hours and judge
// it against 8 hours a day. That is right only for a full-time person in a
// month with no public holiday and no day off, and it is wrong in the exact
// cases the rule exists for. These two tools hand it the rule's own numbers.
describe("the tools that carry the rule to the assistant", () => {
	const ctxOf = (userId: string): Ctx => ({ organizationId: ORG, userId });

	test("no target comes back as null, never as zero hours", async () => {
		// A contractor has no target at all. Reported as 0 it reads as a target
		// they have missed by everything they did not log, which is the one
		// answer worse than no answer.
		await setFund(176 * H);
		const result = await findTool("my_targets")?.run(ctxOf(CONTRACTOR), {});

		// SAFETY: the projection is fixed in assistant-tools.ts, and every
		// expectation below fails loudly if its shape ever changed.
		const mine = result as {
			fullDayHours: number;
			month: { targetHours: number | null; status: string | null };
		};

		expect(mine.month.targetHours).toBeNull();
		expect(mine.month.status).toBeNull();
		// The yardstick still comes back, so the model can say what a full day is
		// worth even for somebody the rule does not measure.
		expect(mine.fullDayHours).toBe(8);
	});

	test("hours, not seconds, and the same figures the screens read", async () => {
		await setFund(176 * H);
		const result = await findTool("tracking_report")?.run(adminCtx(), APRIL);

		// SAFETY: as above — the projection is this file's own, and the
		// expectations name every field they read.
		const report = result as {
			workingDaysInMonth: number;
			rows: {
				userId: string;
				targetSoFarHours: number | null;
				monthTargetHours: number | null;
				deltaHours: number | null;
				status: string | null;
			}[];
		};

		const truth = await complianceService.tracking(adminCtx(), APRIL, AT);
		expect(report.workingDaysInMonth).toBe(truth.workingDaysInMonth);

		const contractor = report.rows.find((row) => row.userId === CONTRACTOR);
		expect(contractor?.monthTargetHours).toBeNull();
		expect(contractor?.deltaHours).toBeNull();
		expect(contractor?.status).toBeNull();

		const diligent = report.rows.find((row) => row.userId === DILIGENT);
		expect(diligent?.monthTargetHours).toBe(176);
	});

	test("the report goes to the people who act on it, my_targets to everyone", async () => {
		// `available` decides what the model is TOLD it can do, not what it may
		// do. A Member gets their own targets; the team report is a lead's
		// question, and their own row is already in my_targets.
		const access = await accessService.resolve(ctxOf(DILIGENT));
		const adminAccess = await accessService.resolve(adminCtx());
		expect(findTool("my_targets")?.available?.(access)).toBe(true);
		expect(findTool("tracking_report")?.available?.(access)).toBe(false);
		expect(findTool("tracking_report")?.available?.(adminAccess)).toBe(true);
	});
});
