// The reports layer — everything that turns logged time into a number somebody
// acts on. `ledger` is well covered; the services that READ it were not, which
// is the wrong way round: a ledger that is right and a report that is wrong
// still produces a wrong decision.
//
// What this file is built around:
//
//   1. THE DETAIL'S TOTAL IS WHOLE EVEN WHEN ITS ROWS ARE NOT. The row cap is
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
import {
	memberProfile,
	memberTypeHistory,
	teamLeadPerson,
} from "../db/schema/people";
import { monthlyHourFund } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { reportsService } from "./reports.service";
import type { Ctx } from "./types";

const H = 3600;
const ORG = "rep-org";
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
/** Overhead: excluded from org-wide lists. */
const OVERHEAD = "u-rep-overhead";
/** Contractor with no override. */
const CONTRACTOR = "u-rep-contractor";
/** Left: archived before the fixture month. */
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

	const [alpha, beta] = await db
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
	if (!alpha || !beta) throw new Error("Failed to seed projects");
	alphaId = alpha.id;
	betaId = beta.id;

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
		// Before the fixture month: gone from May, still on the team in March.
		archivedAt: new Date("2026-03-15T12:00:00Z"),
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
});

// ── Scoping ────────────────────────────────────────────────────────────────

describe("who may read a report", () => {
	const summaryInput = {
		from: FROM,
		to: TO,
		tab: "projects" as const,
	};

	test("a plain member sees their own entries and nobody else's", async () => {
		await logEntry({ userId: WORKER, projectId: alphaId, seconds: 5 * H });
		await logEntry({ userId: PM, projectId: alphaId, seconds: 2 * H });
		await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 9 * H });

		const mine = await reportsService.timeSummary(ctxFor(WORKER), summaryInput);
		expect(mine.rows).toMatchObject([
			{ id: alphaId, name: "Alpha", secondsTotal: 5 * H },
		]);
		expect(mine.totalSeconds).toBe(5 * H);
	});

	test("somebody assigned nowhere gets an empty report, not an error", async () => {
		await logEntry({ userId: WORKER, projectId: alphaId, seconds: 5 * H });
		const nothing = await reportsService.timeSummary(
			ctxFor(CONTRACTOR),
			summaryInput,
		);
		expect(nothing.rows).toEqual([]);
		expect(nothing.totalSeconds).toBe(0);
	});

	test("a Team Lead sees their people's time on every project, plus their own projects", async () => {
		await db.insert(teamLeadPerson).values({
			organizationId: ORG,
			leadUserId: LEAD,
			personUserId: OUTSIDER,
		});
		try {
			await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 9 * H });
			await logEntry({ userId: WORKER, projectId: alphaId, seconds: 5 * H });
			// On Beta, but not one of the lead's people: invisible.
			await logEntry({ userId: PM, projectId: betaId, seconds: 1 * H });

			const lead = await reportsService.timeSummary(ctxFor(LEAD), summaryInput);
			expect(lead.rows.map((r) => [r.name, r.secondsTotal]).sort()).toEqual([
				["Alpha", 5 * H],
				["Beta", 9 * H],
			]);
			expect(lead.totalSeconds).toBe(14 * H);
		} finally {
			await db
				.delete(teamLeadPerson)
				.where(eq(teamLeadPerson.leadUserId, LEAD));
		}
	});

	test("the Absence report is scoped by people: a Member sees only themselves", async () => {
		await db.insert(timeEntry).values(
			[WORKER, OUTSIDER].map((userId) => ({
				organizationId: ORG,
				userId,
				projectId: null,
				taskId: vacationTaskId,
				date: "2026-05-12",
				description: "",
				durationSeconds: 8 * H,
			})),
		);
		const mine = await reportsService.absence(ctxFor(WORKER), {
			from: FROM,
			to: TO,
		});
		expect(mine.rows.map((r) => r.userId)).toEqual([WORKER]);
		const all = await reportsService.absence(ctxFor(ADMIN), {
			from: FROM,
			to: TO,
		});
		expect(all.rows.map((r) => r.userId).sort()).toEqual(
			[OUTSIDER, WORKER].sort(),
		);
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

	test("a PM's Absence report covers the people on their projects, and no one else", async () => {
		await db.insert(timeEntry).values(
			[WORKER, OUTSIDER].map((userId) => ({
				organizationId: ORG,
				userId,
				projectId: null,
				taskId: vacationTaskId,
				date: "2026-05-12",
				description: "",
				durationSeconds: 8 * H,
			})),
		);
		const theirs = await reportsService.absence(ctxFor(PM), {
			from: FROM,
			to: TO,
		});
		// WORKER is on Alpha, which PM runs; OUTSIDER is on Beta only.
		expect(theirs.rows.map((r) => r.userId)).toEqual([WORKER]);
	});
});

// ── Time detail ────────────────────────────────────────────────────────────

describe("the Time report's tabs", () => {
	test("Projects carries the client, the code, the people count and archived; Active only drops an archived project", async () => {
		await logEntry({ userId: WORKER, projectId: alphaId, seconds: 5 * H });
		await logEntry({ userId: PM, projectId: alphaId, seconds: 2 * H });
		await logEntry({ userId: OUTSIDER, projectId: betaId, seconds: 9 * H });
		await db
			.update(project)
			.set({ status: "archived" })
			.where(eq(project.id, betaId));
		try {
			const all = await reportsService.timeSummary(ctxFor(ADMIN), {
				from: FROM,
				to: TO,
				tab: "projects",
			});
			expect(
				all.rows.map((r) => [r.name, r.clientName, r.count, r.archived]),
			).toEqual([
				["Beta", "Globex", 1, true],
				["Alpha", "Acme", 2, false],
			]);
			const active = await reportsService.timeSummary(ctxFor(ADMIN), {
				from: FROM,
				to: TO,
				tab: "projects",
				activeOnly: true,
			});
			expect(active.rows.map((r) => r.name)).toEqual(["Alpha"]);
			expect(active.totalSeconds).toBe(7 * H);
		} finally {
			await db
				.update(project)
				.set({ status: "active" })
				.where(eq(project.id, betaId));
		}
	});

	test("Clients counts projects; Team shows time off beside work", async () => {
		await logEntry({ userId: WORKER, projectId: alphaId, seconds: 5 * H });
		await logEntry({ userId: WORKER, projectId: betaId, seconds: 1 * H });
		await db.insert(timeEntry).values({
			organizationId: ORG,
			userId: WORKER,
			projectId: null,
			taskId: vacationTaskId,
			date: "2026-05-12",
			description: "",
			durationSeconds: 8 * H,
		});
		const clients = await reportsService.timeSummary(ctxFor(ADMIN), {
			from: FROM,
			to: TO,
			tab: "clients",
		});
		expect(clients.rows.map((r) => [r.name, r.count])).toEqual([
			["Acme", 1],
			["Globex", 1],
		]);
		const team = await reportsService.timeSummary(ctxFor(ADMIN), {
			from: FROM,
			to: TO,
			tab: "teammates",
		});
		const worker = team.rows.find((r) => r.id === WORKER);
		// Work only in the hours column: time off is beside it, never in it.
		expect(worker?.secondsTotal).toBe(6 * H);
		expect(worker?.timeOffSeconds).toBe(8 * H);
		expect(worker?.count).toBe(2);
	});
});

describe("time detail", () => {
	const detailInput = {
		from: FROM,
		to: TO,
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

describe("absence report", () => {
	const may = { from: FROM, to: TO };

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
			description: "seaside",
			durationSeconds: 8 * H,
		});

		const report = await reportsService.absence(ctxFor(ADMIN), may);

		// The column is keyed on "vacation" whatever the org calls it, and the
		// label follows the rename.
		const column = report.columns.find((c) => c.key === "vacation");
		expect(column?.label).toBe("Godišnji");

		const row = report.rows.find((r) => r.userId === WORKER);
		expect(row?.seconds).toBe(8 * H);
		expect(row?.byTask.vacation).toBe(8 * H);
		expect(row?.entries).toMatchObject([
			{
				date: "2026-05-04",
				taskKey: "vacation",
				taskName: "Godišnji",
				description: "seaside",
				durationSeconds: 8 * H,
			},
		]);

		await db
			.update(task)
			.set({ name: "Vacation" })
			.where(eq(task.id, vacationTaskId));
	});

	test("covers exactly the period, with the entries behind the figure in date order", async () => {
		await db.insert(timeEntry).values(
			// Out of order on purpose; one of them outside May.
			["2026-05-06", "2026-02-10", "2026-05-04"].map((date) => ({
				organizationId: ORG,
				userId: WORKER,
				projectId: null,
				taskId: vacationTaskId,
				date,
				description: "",
				durationSeconds: 8 * H,
			})),
		);

		const month = await reportsService.absence(ctxFor(ADMIN), may);
		const row = month.rows.find((r) => r.userId === WORKER);
		expect(row?.seconds).toBe(16 * H);
		expect(row?.entries.map((e) => e.date)).toEqual([
			"2026-05-04",
			"2026-05-06",
		]);

		const year = await reportsService.absence(ctxFor(ADMIN), {
			from: "2026-01-01",
			to: "2026-12-31",
		});
		expect(year.rows.find((r) => r.userId === WORKER)?.seconds).toBe(24 * H);
	});

	test("says nothing about somebody with no time off in the period", async () => {
		await logEntry({ userId: WORKER, seconds: 8 * H });
		const report = await reportsService.absence(ctxFor(ADMIN), may);
		expect(report.rows).toEqual([]);
	});
});

// ── Overtime ───────────────────────────────────────────────────────────────

describe("overtime", () => {
	const may = { from: FROM, to: TO };

	test("lists only the flagged entries in the period, per person, with the entries behind the figure", async () => {
		// Outside May, so not in the month's figure.
		await logEntry({
			userId: WORKER,
			date: "2026-02-03",
			seconds: 2 * H,
			overtime: true,
		});
		await logEntry({
			userId: WORKER,
			seconds: 3 * H,
			overtime: true,
			description: "release night",
		});
		// Not overtime, so in neither figure.
		await logEntry({ userId: WORKER, seconds: 40 * H });

		const month = await reportsService.overtime(ctxFor(ADMIN), may);
		expect(month.totalSeconds).toBe(3 * H);
		expect(month.totalEntries).toBe(1);
		const row = month.rows.find((r) => r.userId === WORKER);
		expect(row?.count).toBe(1);
		expect(row?.seconds).toBe(3 * H);
		expect(row?.entries).toMatchObject([
			{
				date: "2026-05-11",
				projectName: "Alpha",
				taskName: "Development",
				description: "release night",
				durationSeconds: 3 * H,
			},
		]);

		const year = await reportsService.overtime(ctxFor(ADMIN), {
			from: "2026-01-01",
			to: "2026-12-31",
		});
		expect(year.rows.find((r) => r.userId === WORKER)?.seconds).toBe(5 * H);
	});

	test("Active only leaves out overtime on an archived project", async () => {
		await logEntry({
			userId: OUTSIDER,
			projectId: betaId,
			seconds: 6 * H,
			overtime: true,
		});
		await db
			.update(project)
			.set({ status: "archived" })
			.where(eq(project.id, betaId));
		try {
			const all = await reportsService.overtime(ctxFor(ADMIN), may);
			expect(all.rows.map((r) => r.userId)).toEqual([OUTSIDER]);
			const active = await reportsService.overtime(ctxFor(ADMIN), {
				...may,
				activeOnly: true,
			});
			expect(active.rows).toEqual([]);
			expect(active.totalSeconds).toBe(0);
		} finally {
			await db
				.update(project)
				.set({ status: "active" })
				.where(eq(project.id, betaId));
		}
	});

	test("is scoped for a Team Lead", async () => {
		await logEntry({
			userId: OUTSIDER,
			projectId: betaId,
			seconds: 6 * H,
			overtime: true,
		});

		const lead = await reportsService.overtime(ctxFor(LEAD), may);
		expect(lead.rows).toEqual([]);
		expect(lead.totalSeconds).toBe(0);
	});
});
