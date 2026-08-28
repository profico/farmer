// The reports layer — everything that turns close data into a number somebody
// acts on. `close` and `ledger` are well covered; the four services that READ
// them were not, which is the wrong way round: a close sheet that is right and
// a utilization figure that is wrong still produces a wrong decision.
//
// What this file is built around:
//
//   1. UTILIZATION PREFERS THE FROZEN EXPECTED. `expectedAtFinalizeSeconds` is
//      snapshotted at finalization precisely so an admin editing a past month's
//      hour fund cannot retroactively move percentages that have already been
//      reported. The fallback to a live computation exists for months that were
//      never finalized, and must not shadow the snapshot when there is one.
//   2. THE TREND AND THE HEADLINE CANNOT DISAGREE. Each trend point is the same
//      roll-up as the single-month figure. They used to diverge — the trend
//      averaged percentages while the PDF divided the totals — and the trend now
//      reads from a span resolved once rather than recomputing per point, which
//      is a second way for them to drift apart if it is ever wrong.
//   3. VARIANCE READS THE SNAPSHOT, NOT A LIVE RECOMPUTE. Entries stay editable
//      in finalized months on purpose, so a live Reported would drift away from
//      the Final it was compared against and the variance would quietly stop
//      meaning anything.
//   4. THE DETAIL'S TOTAL IS WHOLE EVEN WHEN ITS ROWS ARE NOT. The row cap is
//      the safety valve; a total summed from the surviving rows would make the
//      table disagree with the figure above it and give no sign of it.
//
// Plus the scoping rules, which are the reason a Team Lead on one project cannot
// learn what people bill on another.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { monthlyHourFund } from "../db/schema/settings";
import { rollUpUtilization } from "../lib/utilization";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { reportsService } from "./reports.service";
import type { Ctx } from "./types";

const H = 3600;
const ORG = "rep-org";
const YEAR = 2026;
const MONTH = 5;
const FROM = "2026-05-01";
const TO = "2026-05-31";

const ADMIN = "u-rep-admin";
/** PM on Alpha only. Sees Alpha's money, nothing on Beta. */
const PM = "u-rep-pm";
/** Team Lead on Alpha only. Sees Alpha's hours, never its money. */
const LEAD = "u-rep-lead";
/** Assigned to Alpha as a plain member — no report access at all. */
const WORKER = "u-rep-worker";
/** Works on Beta, so a Lead scoped to Alpha must not see their hours. */
const OUTSIDER = "u-rep-outsider";
/** Overhead: excluded from the org-wide utilization list. */
const OVERHEAD = "u-rep-overhead";
/** Contractor with no override: Final hours, no percentage. */
const CONTRACTOR = "u-rep-contractor";
/** Left: excluded from utilization for the same reason as overhead. */
const ARCHIVED = "u-rep-archived";

const EVERYONE = [
	ADMIN,
	PM,
	LEAD,
	WORKER,
	OUTSIDER,
	OVERHEAD,
	CONTRACTOR,
	ARCHIVED,
];

let harness: TestDb;
let alphaId: string;
let betaId: string;
let internalId: string;
let devTaskId: string;
let vacationTaskId: string;

const ctxFor = (userId: string): Ctx => ({ organizationId: ORG, userId });

const logEntry = async (opts: {
	userId: string;
	projectId?: string | null;
	date?: string;
	seconds?: number;
	overtime?: boolean;
	description?: string;
}) => {
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId: opts.userId,
		projectId: opts.projectId === undefined ? alphaId : opts.projectId,
		taskId: devTaskId,
		date: opts.date ?? "2026-05-11",
		description: opts.description ?? "work",
		durationSeconds: opts.seconds ?? 4 * H,
		overtime: opts.overtime ?? false,
	});
};

/** A finalized close for a project/month, with per-person snapshots. Written
 *  directly: this file is about how the reports READ close data. */
const finalize = async (opts: {
	projectId: string;
	year?: number;
	month?: number;
	rows: {
		userId: string;
		finalSeconds?: number | null;
		reportedAtFinalizeSeconds?: number | null;
		expectedAtFinalizeSeconds?: number | null;
	}[];
	status?: "open" | "submitted" | "finalized";
}) => {
	const [close] = await db
		.insert(monthlyClose)
		.values({
			organizationId: ORG,
			projectId: opts.projectId,
			year: opts.year ?? YEAR,
			month: opts.month ?? MONTH,
			status: opts.status ?? "finalized",
			finalizedAt: new Date(),
		})
		.returning();
	if (!close) throw new Error("Failed to seed close");

	if (opts.rows.length > 0) {
		await db.insert(monthlyCloseRow).values(
			opts.rows.map((r) => ({
				organizationId: ORG,
				closeId: close.id,
				userId: r.userId,
				finalSeconds: r.finalSeconds ?? null,
				reportedAtFinalizeSeconds: r.reportedAtFinalizeSeconds ?? null,
				expectedAtFinalizeSeconds: r.expectedAtFinalizeSeconds ?? null,
			})),
		);
	}
	return close.id;
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Reports Org",
		slug: "rep-org",
		timezone: "UTC",
		createdAt: new Date(),
	});

	await db.insert(user).values(
		EVERYONE.map((id) => ({
			id,
			name: id.replace("u-rep-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values(
		EVERYONE.map((id) => ({
			id: `mr-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
	);

	const [acme, globex] = await db
		.insert(client)
		.values([
			{ organizationId: ORG, name: "Acme" },
			{ organizationId: ORG, name: "Globex" },
		])
		.returning();
	if (!acme || !globex) throw new Error("Failed to seed clients");

	const [alpha, beta, internal] = await db
		.insert(project)
		.values([
			{
				organizationId: ORG,
				clientId: acme.id,
				name: "Alpha",
				type: "product_team" as const,
				budgetSeconds: 100 * H,
				budgetAmount: "50000",
			},
			{
				organizationId: ORG,
				clientId: globex.id,
				name: "Beta",
				type: "fixed_scope" as const,
				budgetSeconds: 200 * H,
				budgetAmount: "80000",
			},
			{
				organizationId: ORG,
				clientId: acme.id,
				name: "Internal",
				type: "internal" as const,
			},
		])
		.returning();
	if (!alpha || !beta || !internal) throw new Error("Failed to seed projects");
	alphaId = alpha.id;
	betaId = beta.id;
	internalId = internal.id;

	await db.insert(projectMember).values([
		{
			organizationId: ORG,
			projectId: alphaId,
			userId: PM,
			role: "pm" as const,
			active: true,
		},
		{
			organizationId: ORG,
			projectId: alphaId,
			userId: LEAD,
			role: "team_lead" as const,
			active: true,
		},
		{
			organizationId: ORG,
			projectId: alphaId,
			userId: WORKER,
			role: "member" as const,
			active: true,
		},
		{
			organizationId: ORG,
			projectId: betaId,
			userId: OUTSIDER,
			role: "member" as const,
			active: true,
		},
	]);

	// Vacation is site-scoped and unique on BOTH name and system key, so it is
	// seeded once here rather than per test — two tests each inserting their own
	// would collide, and a test that failed before its cleanup would poison every
	// test after it.
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
			type: "overhead" as const,
			effectiveFrom: "2020-01-01",
		},
		{
			organizationId: ORG,
			userId: CONTRACTOR,
			type: "contractor" as const,
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
	await db.delete(monthlyClose).where(eq(monthlyClose.organizationId, ORG));
	await db
		.delete(monthlyHourFund)
		.where(eq(monthlyHourFund.organizationId, ORG));
});

// ── Scoping ────────────────────────────────────────────────────────────────

describe("who may read a report", () => {
	const summaryInput = {
		from: FROM,
		to: TO,
		tab: "projects" as const,
		groupBy: "date" as const,
	};

	test("a plain member is refused, and with an AccessError", async () => {
		await expect(
			reportsService.timeSummary(ctxFor(WORKER), summaryInput),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("someone with no assignments at all is refused", async () => {
		await expect(
			reportsService.timeSummary(ctxFor(OUTSIDER), {
				...summaryInput,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("a Team Lead sees their own project and not another", async () => {
		await logEntry({ userId: WORKER, projectId: alphaId, seconds: 5 * H });
		await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 9 * H });

		const lead = await reportsService.timeSummary(ctxFor(LEAD), summaryInput);
		expect(lead.rows.map((r) => r.name)).toEqual(["Alpha"]);
		expect(lead.totalSeconds).toBe(5 * H);

		const admin = await reportsService.timeSummary(ctxFor(ADMIN), summaryInput);
		expect(admin.rows.map((r) => r.name).sort()).toEqual(["Alpha", "Beta"]);
		expect(admin.totalSeconds).toBe(14 * H);
	});

	test("a Team Lead's Teammates tab shows hours only within their projects", async () => {
		// The whole point of scoping the Teammates tab: a company-wide per-person
		// total would tell a Lead on one project what people do for other clients.
		await logEntry({ userId: OUTSIDER, projectId: alphaId, seconds: 2 * H });
		await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 30 * H });

		const lead = await reportsService.timeSummary(ctxFor(LEAD), {
			...summaryInput,
			tab: "teammates",
		});
		const row = lead.rows.find((r) => r.name === "outsider");
		expect(row?.secondsTotal).toBe(2 * H);
	});

	test("admin-only reports refuse a PM", async () => {
		const month = { year: YEAR, month: MONTH };
		await expect(
			reportsService.absence(ctxFor(PM), month),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			reportsService.variance(ctxFor(PM), month),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			reportsService.utilization(ctxFor(PM), month),
		).rejects.toBeInstanceOf(AccessError);
	});
});

describe("money is PM-and-above, per project", () => {
	test("a Team Lead gets hour figures but a null budget amount", async () => {
		await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 50 * H });

		// Beta is the fixed-scope project, and the burn report only covers those.
		const asAdmin = await reportsService.budgetBurn(ctxFor(ADMIN));
		const beta = asAdmin.find((r) => r.name === "Beta");
		expect(beta?.budgetAmount).toBe("80000.00");
		expect(beta?.consumedSeconds).toBe(50 * H);
		expect(beta?.burnPct).toBe(25);
	});

	test("a project with no time logged still appears, at zero", async () => {
		// The left join exists for exactly this row: a burn report has to be able
		// to say 0%, not omit the project.
		const rows = await reportsService.budgetBurn(ctxFor(ADMIN));
		const beta = rows.find((r) => r.name === "Beta");
		expect(beta?.consumedSeconds).toBe(0);
		expect(beta?.burnPct).toBe(0);
	});
});

// ── Time detail ────────────────────────────────────────────────────────────

describe("time detail", () => {
	const detailInput = {
		from: FROM,
		to: TO,
		groupBy: "date" as const,
	};

	test("reports its own totals, and is not truncated in the ordinary case", async () => {
		await logEntry({ userId: WORKER, seconds: 3 * H });
		await logEntry({ userId: WORKER, seconds: 5 * H, date: "2026-05-12" });

		const detail = await reportsService.timeDetail(ctxFor(ADMIN), detailInput);
		expect(detail.rows).toHaveLength(2);
		expect(detail.totalRows).toBe(2);
		expect(detail.totalSeconds).toBe(8 * H);
		expect(detail.truncated).toBe(false);
	});

	test("absence and unfiled time are excluded, matching the summary", async () => {
		await logEntry({ userId: WORKER, seconds: 3 * H });
		// Unfiled: real work, but no project to group it under.
		await logEntry({ userId: WORKER, projectId: null, seconds: 4 * H });

		const detail = await reportsService.timeDetail(ctxFor(ADMIN), detailInput);
		expect(detail.totalRows).toBe(1);
		expect(detail.totalSeconds).toBe(3 * H);

		const summary = await reportsService.timeSummary(ctxFor(ADMIN), {
			...detailInput,
			tab: "projects",
		});
		// The two agree on attributed time, and the unfiled hours are reported
		// separately rather than folded into either total.
		expect(summary.totalSeconds).toBe(detail.totalSeconds);
		expect(summary.unfiledSeconds).toBe(4 * H);
	});

	test("the total stays whole when the rows are capped", async () => {
		// The cap is 5000. One row over it, so the response is truncated by
		// exactly one — and the figure the screen prints must still be the sum of
		// all 5001, or the table silently disagrees with its own total.
		const count = 5001;
		const seconds = 900; // 15 minutes, the entry granularity
		// In chunks: a single 5001-row insert overruns PGLite's bind-parameter
		// handling and takes the whole instance down with it.
		const CHUNK = 500;
		for (let start = 0; start < count; start += CHUNK) {
			const size = Math.min(CHUNK, count - start);
			await db.insert(timeEntry).values(
				Array.from({ length: size }, (_, i) => ({
					organizationId: ORG,
					userId: WORKER,
					projectId: alphaId,
					taskId: devTaskId,
					date: "2026-05-11",
					description: `bulk ${start + i}`,
					durationSeconds: seconds,
				})),
			);
		}

		const detail = await reportsService.timeDetail(ctxFor(ADMIN), detailInput);

		expect(detail.rows).toHaveLength(5000);
		expect(detail.truncated).toBe(true);
		expect(detail.totalRows).toBe(count);
		expect(detail.totalSeconds).toBe(count * seconds);
		// The sum of what came back is deliberately NOT the reported total.
		const returned = detail.rows.reduce((s, r) => s + r.durationSeconds, 0);
		expect(returned).toBeLessThan(detail.totalSeconds);
		// Well over the default 5s: seeding 5001 rows through PGLite and then
		// aggregating them twice is genuinely slow, and this is the only test in
		// the suite whose cost is the cap itself.
	}, 60_000);

	test("a Team Lead's detail totals are scoped too", async () => {
		await logEntry({ userId: WORKER, projectId: alphaId, seconds: 3 * H });
		await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 11 * H });

		const detail = await reportsService.timeDetail(ctxFor(LEAD), detailInput);
		expect(detail.totalRows).toBe(1);
		expect(detail.totalSeconds).toBe(3 * H);
	});
});

// ── Variance ───────────────────────────────────────────────────────────────

describe("variance", () => {
	test("compares Final against Reported as it stood at finalization", async () => {
		await finalize({
			projectId: alphaId,
			rows: [
				{
					userId: WORKER,
					reportedAtFinalizeSeconds: 100 * H,
					finalSeconds: 120 * H,
				},
			],
		});

		// Entries edited AFTER finalization must not move the figure — that is the
		// entire reason the snapshot exists.
		await logEntry({ userId: WORKER, seconds: 900 * H });

		const rows = await reportsService.variance(ctxFor(ADMIN), {
			year: YEAR,
			month: MONTH,
		});
		const row = rows.find((r) => r.userId === WORKER);
		expect(row?.reportedSeconds).toBe(100 * H);
		expect(row?.finalSeconds).toBe(120 * H);
		expect(row?.diffSeconds).toBe(20 * H);
		expect(row?.diffPct).toBe(20);
	});

	test("an unfinalized month contributes nothing", async () => {
		await finalize({
			projectId: alphaId,
			status: "submitted",
			rows: [
				{
					userId: WORKER,
					reportedAtFinalizeSeconds: 100 * H,
					finalSeconds: 120 * H,
				},
			],
		});

		expect(
			await reportsService.variance(ctxFor(ADMIN), {
				year: YEAR,
				month: MONTH,
			}),
		).toEqual([]);
	});

	test("a person's rows sum across projects", async () => {
		await finalize({
			projectId: alphaId,
			rows: [
				{
					userId: WORKER,
					reportedAtFinalizeSeconds: 60 * H,
					finalSeconds: 60 * H,
				},
			],
		});
		await finalize({
			projectId: betaId,
			rows: [
				{
					userId: WORKER,
					reportedAtFinalizeSeconds: 40 * H,
					finalSeconds: 50 * H,
				},
			],
		});

		const row = (
			await reportsService.variance(ctxFor(ADMIN), {
				year: YEAR,
				month: MONTH,
			})
		).find((r) => r.userId === WORKER);
		expect(row?.reportedSeconds).toBe(100 * H);
		expect(row?.finalSeconds).toBe(110 * H);
	});

	test("a zero Reported yields no percentage rather than a division by zero", async () => {
		await finalize({
			projectId: alphaId,
			rows: [
				{
					userId: WORKER,
					reportedAtFinalizeSeconds: 0,
					finalSeconds: 8 * H,
				},
			],
		});

		const row = (
			await reportsService.variance(ctxFor(ADMIN), {
				year: YEAR,
				month: MONTH,
			})
		).find((r) => r.userId === WORKER);
		expect(row?.diffPct).toBeNull();
	});
});

// ── Utilization ────────────────────────────────────────────────────────────

describe("utilization", () => {
	const month = { year: YEAR, month: MONTH };

	test("is Final on non-Internal projects over Expected", async () => {
		await finalize({
			projectId: alphaId,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 80 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === WORKER,
		);
		expect(row?.finalSeconds).toBe(80 * H);
		expect(row?.expectedSeconds).toBe(160 * H);
		expect(row?.utilizationPct).toBe(50);
	});

	test("hours on an Internal project are not in the numerator", async () => {
		await finalize({
			projectId: alphaId,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 40 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});
		await finalize({
			projectId: internalId,
			rows: [{ userId: WORKER, finalSeconds: 120 * H }],
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === WORKER,
		);
		// 160h of Final, only 40 of it sold.
		expect(row?.finalSeconds).toBe(40 * H);
		expect(row?.utilizationPct).toBe(25);
	});

	test("the frozen Expected wins over a later edit to the hour fund", async () => {
		await finalize({
			projectId: alphaId,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 80 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});
		// An admin revising the month's fund afterwards must not move a percentage
		// that has already been reported.
		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: YEAR,
			month: MONTH,
			fundSeconds: 80 * H,
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === WORKER,
		);
		expect(row?.expectedSeconds).toBe(160 * H);
		expect(row?.utilizationPct).toBe(50);
	});

	test("without a snapshot it falls back to fund minus absence", async () => {
		// No finalized close for this person at all, so nothing was frozen.
		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: YEAR,
			month: MONTH,
			fundSeconds: 160 * H,
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === WORKER,
		);
		expect(row?.expectedSeconds).toBe(160 * H);
		expect(row?.finalSeconds).toBe(0);
		expect(row?.utilizationPct).toBe(0);
	});

	test("absence lowers the fallback Expected", async () => {
		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: YEAR,
			month: MONTH,
			fundSeconds: 160 * H,
		});
		// Two 8h vacation days in the month.
		await db.insert(timeEntry).values([
			{
				organizationId: ORG,
				userId: WORKER,
				projectId: null,
				taskId: vacationTaskId,
				date: "2026-05-04",
				description: "",
				durationSeconds: 8 * H,
			},
			{
				organizationId: ORG,
				userId: WORKER,
				projectId: null,
				taskId: vacationTaskId,
				date: "2026-05-05",
				description: "",
				durationSeconds: 8 * H,
			},
		]);

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === WORKER,
		);
		expect(row?.expectedSeconds).toBe(160 * H - 16 * H);
	});

	test("overhead and archived people are not in the org-wide list", async () => {
		const ids = (await reportsService.utilization(ctxFor(ADMIN), month)).map(
			(r) => r.userId,
		);
		expect(ids).not.toContain(OVERHEAD);
		expect(ids).not.toContain(ARCHIVED);
		expect(ids).toContain(WORKER);
	});

	test("a contractor with no override gets hours but no percentage", async () => {
		await finalize({
			projectId: alphaId,
			rows: [{ userId: CONTRACTOR, finalSeconds: 90 * H }],
		});
		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: YEAR,
			month: MONTH,
			fundSeconds: 160 * H,
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === CONTRACTOR,
		);
		// The "/" rows of the old sheet: a real Final, and deliberately no number
		// beside it, because no Croatian hour fund applies to them.
		expect(row?.finalSeconds).toBe(90 * H);
		expect(row?.expectedSeconds).toBeNull();
		expect(row?.utilizationPct).toBeNull();
	});

	test("an explicit override gives a contractor a percentage", async () => {
		await db
			.update(memberTypeHistory)
			.set({ expectedSecondsOverride: 100 * H })
			.where(
				and(
					eq(memberTypeHistory.organizationId, ORG),
					eq(memberTypeHistory.userId, CONTRACTOR),
				),
			);
		await finalize({
			projectId: alphaId,
			rows: [{ userId: CONTRACTOR, finalSeconds: 50 * H }],
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === CONTRACTOR,
		);
		expect(row?.expectedSeconds).toBe(100 * H);
		expect(row?.utilizationPct).toBe(50);

		await db
			.update(memberTypeHistory)
			.set({ expectedSecondsOverride: null })
			.where(
				and(
					eq(memberTypeHistory.organizationId, ORG),
					eq(memberTypeHistory.userId, CONTRACTOR),
				),
			);
	});

	test("an unfinalized month contributes no Final", async () => {
		await finalize({
			projectId: alphaId,
			status: "submitted",
			rows: [{ userId: WORKER, finalSeconds: 999 * H }],
		});

		const row = (await reportsService.utilization(ctxFor(ADMIN), month)).find(
			(r) => r.userId === WORKER,
		);
		expect(row?.finalSeconds).toBe(0);
	});
});

describe("utilization trend", () => {
	test("each point equals the single-month figure for that month", async () => {
		// Three months with different shapes, so a trend that mixed months up — or
		// leaked one month's fund into another's point — could not pass.
		await finalize({
			projectId: alphaId,
			year: YEAR,
			month: 3,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 40 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});
		await finalize({
			projectId: alphaId,
			year: YEAR,
			month: 4,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 120 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});
		await finalize({
			projectId: alphaId,
			year: YEAR,
			month: 5,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 80 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});

		const trend = await reportsService.utilizationTrend(ctxFor(ADMIN), {
			year: YEAR,
			month: 5,
			months: 3,
		});

		expect(trend.map((p) => p.month)).toEqual([3, 4, 5]);
		for (const point of trend) {
			const single = await reportsService.utilization(ctxFor(ADMIN), {
				year: point.year,
				month: point.month,
			});
			expect(point).toMatchObject(rollUpUtilization(single));
		}
		// And the shapes really did differ, so the loop above compared something.
		expect(trend.map((p) => p.utilizationPct)).toEqual([25, 75, 50]);
	});

	test("spans a year boundary without borrowing the wrong month's data", async () => {
		await finalize({
			projectId: alphaId,
			year: 2025,
			month: 12,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 160 * H,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});
		await finalize({
			projectId: alphaId,
			year: 2026,
			month: 1,
			rows: [
				{
					userId: WORKER,
					finalSeconds: 0,
					expectedAtFinalizeSeconds: 160 * H,
				},
			],
		});

		const trend = await reportsService.utilizationTrend(ctxFor(ADMIN), {
			year: 2026,
			month: 1,
			months: 2,
		});

		expect(trend.map((p) => `${p.year}-${p.month}`)).toEqual([
			"2025-12",
			"2026-1",
		]);
		expect(trend[0]?.utilizationPct).toBe(100);
		expect(trend[1]?.utilizationPct).toBe(0);
	});

	test("a month with nothing finalized is a real point, not a gap", async () => {
		const trend = await reportsService.utilizationTrend(ctxFor(ADMIN), {
			year: YEAR,
			month: MONTH,
			months: 3,
		});
		expect(trend).toHaveLength(3);
		for (const point of trend) expect(point.finalSeconds).toBe(0);
	});

	test("variance trend lines up month for month too", async () => {
		await finalize({
			projectId: alphaId,
			year: YEAR,
			month: 4,
			rows: [
				{
					userId: WORKER,
					reportedAtFinalizeSeconds: 100 * H,
					finalSeconds: 90 * H,
				},
			],
		});

		const trend = await reportsService.varianceTrend(ctxFor(ADMIN), {
			year: YEAR,
			month: MONTH,
			months: 2,
		});
		expect(trend.map((p) => p.month)).toEqual([4, 5]);
		expect(trend[0]?.rows[0]?.diffSeconds).toBe(-10 * H);
		expect(trend[1]?.rows).toEqual([]);
	});
});

// ── Absence ────────────────────────────────────────────────────────────────

describe("absence report", () => {
	test("groups by system key, so renaming the task does not empty a column", async () => {
		// The org renames the built-in. Nothing about the report may depend on the
		// label: the old lookup matched the literal string "Vacation" and emptied
		// the column the moment somebody translated it.
		await db
			.update(task)
			.set({ name: "Godišnji" })
			.where(eq(task.id, vacationTaskId));

		await db.insert(timeEntry).values({
			organizationId: ORG,
			userId: WORKER,
			projectId: null,
			taskId: vacationTaskId,
			date: "2026-05-04",
			description: "",
			durationSeconds: 8 * H,
		});

		const report = await reportsService.absence(ctxFor(ADMIN), {
			year: YEAR,
			month: MONTH,
		});

		// The column is keyed on "vacation" whatever the org calls it, and the
		// label follows the rename.
		const column = report.columns.find((c) => c.key === "vacation");
		expect(column?.label).toBe("Godišnji");

		const row = report.rows.find((r) => r.userId === WORKER);
		expect(row?.monthByTask.vacation).toBe(8 * H);
		expect(row?.ytdByTask.vacation).toBe(8 * H);

		await db
			.update(task)
			.set({ name: "Vacation" })
			.where(eq(task.id, vacationTaskId));
	});

	test("without a month it reports the year to date", async () => {
		await db.insert(timeEntry).values([
			{
				organizationId: ORG,
				userId: WORKER,
				projectId: null,
				taskId: vacationTaskId,
				date: "2026-02-10",
				description: "",
				durationSeconds: 8 * H,
			},
			{
				organizationId: ORG,
				userId: WORKER,
				projectId: null,
				taskId: vacationTaskId,
				date: "2026-05-04",
				description: "",
				durationSeconds: 8 * H,
			},
		]);

		const report = await reportsService.absence(ctxFor(ADMIN), { year: YEAR });
		const row = report.rows.find((r) => r.userId === WORKER);
		expect(row?.ytdSeconds).toBe(16 * H);
		// No month asked for, so there is no month column to fill.
		expect(row?.monthSeconds).toBe(0);
	});
});

// ── Overtime ───────────────────────────────────────────────────────────────

describe("overtime", () => {
	test("reports the month and the year to date side by side", async () => {
		await logEntry({
			userId: WORKER,
			date: "2026-02-03",
			seconds: 2 * H,
			overtime: true,
		});
		await logEntry({ userId: WORKER, seconds: 3 * H, overtime: true });
		// Not overtime, so in neither figure.
		await logEntry({ userId: WORKER, seconds: 40 * H });

		const row = (
			await reportsService.overtime(ctxFor(ADMIN), {
				year: YEAR,
				month: MONTH,
			})
		).find((r) => r.userId === WORKER);
		expect(row?.monthSeconds).toBe(3 * H);
		expect(row?.yearSeconds).toBe(5 * H);
	});

	test("is scoped for a Team Lead", async () => {
		await logEntry({
			userId: OUTSIDER,
			projectId: betaId,
			seconds: 6 * H,
			overtime: true,
		});

		expect(
			await reportsService.overtime(ctxFor(LEAD), {
				year: YEAR,
				month: MONTH,
			}),
		).toEqual([]);
	});
});
