// The Tracking rule (PRD 6.2, revised Sept 2026): every figure below is the
// month's hour fund prorated by the Monday-to-Friday days elapsed, against a
// person's work PLUS time-off. April 2026 has 22 working days; the clock is
// pinned to Wednesday the 15th, the 11th of them, so the target so far is
// exactly half the fund.

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
		// has 21 weekdays, 20 working days; through Wednesday the 27th, 19
		// weekdays and 18 working days. 160h over 20 days is 8h a day → 144h.
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
		expect(report.workingDaysElapsed).toBe(18);
		expect(report.targetSeconds).toBe(144 * H);
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
