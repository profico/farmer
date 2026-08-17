// What counts as logged time, pinned.
//
// The scopes exist because three of the fifteen aggregations they replace
// disagreed about this, and the disagreement reached users: absence counted as
// worked time on one screen and not on another, for the same person and month.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { ledgerByProject, ledgerByUser, ledgerTotal } from "./ledger";
import type { Ctx } from "./types";

const ORG = "org-ledger";
const OTHER_ORG = "org-ledger-other";
const ALICE = "user-alice";
const BOB = "user-bob";
const RANGE = { from: "2026-08-01", to: "2026-08-31" };

const ctx: Ctx = { organizationId: ORG, userId: ALICE };

let harness: TestDb;
let projectId: string;
let otherProjectId: string;
let workTaskId: string;
let absenceTaskId: string;

const HOUR = 3600;

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Ledger Org", slug: ORG, createdAt: new Date() },
		{
			id: OTHER_ORG,
			name: "Other Org",
			slug: OTHER_ORG,
			createdAt: new Date(),
		},
	]);
	await db.insert(user).values([
		{
			id: ALICE,
			name: "Alice",
			email: "a@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: BOB,
			name: "Bob",
			email: "b@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	]);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Client" })
		.returning();
	if (!c) throw new Error("client");

	const [p, otherP] = await db
		.insert(project)
		.values([
			{ organizationId: ORG, clientId: c.id, name: "Alpha" },
			{ organizationId: ORG, clientId: c.id, name: "Beta" },
		])
		.returning();
	if (!p || !otherP) throw new Error("project");
	projectId = p.id;
	otherProjectId = otherP.id;

	const [work] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG,
			name: "Dev",
		})
		.returning();
	if (!work) throw new Error("task");
	workTaskId = work.id;

	const existingAbsence = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.isAbsence, true)),
		columns: { id: true },
	});
	if (existingAbsence) {
		absenceTaskId = existingAbsence.id;
	} else {
		const [absence] = await db
			.insert(task)
			.values({ scope: "site" as const, name: "Vacation", isAbsence: true })
			.returning();
		if (!absence) throw new Error("absence task");
		absenceTaskId = absence.id;
	}

	await db.insert(timeEntry).values([
		// Alice: 3h on a project, 1h unfiled, 8h vacation.
		{
			organizationId: ORG,
			userId: ALICE,
			projectId,
			taskId: workTaskId,
			date: "2026-08-10",
			description: "work",
			durationSeconds: 3 * HOUR,
		},
		{
			organizationId: ORG,
			userId: ALICE,
			projectId: null,
			taskId: workTaskId,
			date: "2026-08-11",
			description: "meeting",
			durationSeconds: HOUR,
		},
		{
			organizationId: ORG,
			userId: ALICE,
			projectId: null,
			taskId: absenceTaskId,
			date: "2026-08-12",
			description: "vacation",
			durationSeconds: 8 * HOUR,
		},
		// Bob: 2h on the other project.
		{
			organizationId: ORG,
			userId: BOB,
			projectId: otherProjectId,
			taskId: workTaskId,
			date: "2026-08-10",
			description: "work",
			durationSeconds: 2 * HOUR,
		},
		// Outside the range.
		{
			organizationId: ORG,
			userId: ALICE,
			projectId,
			taskId: workTaskId,
			date: "2026-07-31",
			description: "last month",
			durationSeconds: 5 * HOUR,
		},
		{
			organizationId: ORG,
			userId: ALICE,
			projectId,
			taskId: workTaskId,
			date: "2026-09-01",
			description: "next month",
			durationSeconds: 5 * HOUR,
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("scopes partition the ledger", () => {
	test("worked excludes absence but includes unfiled", async () => {
		expect(await ledgerTotal(ctx, RANGE, "worked")).toBe(6 * HOUR); // 3 + 1 + 2
	});

	test("project is worked time with a project", async () => {
		expect(await ledgerTotal(ctx, RANGE, "project")).toBe(5 * HOUR); // 3 + 2
	});

	test("unfiled is worked time without one", async () => {
		expect(await ledgerTotal(ctx, RANGE, "unfiled")).toBe(HOUR);
	});

	test("absence is absence", async () => {
		expect(await ledgerTotal(ctx, RANGE, "absence")).toBe(8 * HOUR);
	});

	test("project + unfiled = worked", async () => {
		const [p, u, w] = await Promise.all([
			ledgerTotal(ctx, RANGE, "project"),
			ledgerTotal(ctx, RANGE, "unfiled"),
			ledgerTotal(ctx, RANGE, "worked"),
		]);
		expect(p + u).toBe(w);
	});

	test("worked + absence = all", async () => {
		const [w, a, all] = await Promise.all([
			ledgerTotal(ctx, RANGE, "worked"),
			ledgerTotal(ctx, RANGE, "absence"),
			ledgerTotal(ctx, RANGE, "all"),
		]);
		expect(w + a).toBe(all);
	});
});

describe("tenancy and range", () => {
	test("another org's ctx sees nothing", async () => {
		const otherCtx: Ctx = { organizationId: OTHER_ORG, userId: ALICE };
		expect(await ledgerTotal(otherCtx, RANGE, "all")).toBe(0);
	});

	test("entries outside the range are excluded at both ends", async () => {
		expect(await ledgerTotal(ctx, RANGE, "project")).toBe(5 * HOUR);
		expect(
			await ledgerTotal(
				ctx,
				{ from: "2026-07-01", to: "2026-09-30" },
				"project",
			),
		).toBe(15 * HOUR);
	});

	test("the range is inclusive of both endpoints", async () => {
		// Alice's only project entry in August is on the 10th; a single-day range
		// naming that date must include it.
		const oneDay = { from: "2026-08-10", to: "2026-08-10" };
		expect(await ledgerTotal(ctx, oneDay, "project", { userId: ALICE })).toBe(
			3 * HOUR,
		);
		expect(
			await ledgerTotal(
				ctx,
				{ from: "2026-08-11", to: "2026-08-31" },
				"project",
				{
					userId: ALICE,
				},
			),
		).toBe(0);
	});
});

describe("the absence double-count", () => {
	// The bug this scope vocabulary exists to prevent: compliance's pace check
	// summed every entry in the range with no absence exclusion, while the
	// expectation it compared against SUBTRACTS absence days. A person on
	// vacation had their target lowered and their vacation counted as work.
	test("worked time for a person on vacation excludes the vacation", async () => {
		const byUser = await ledgerByUser(ctx, RANGE, "worked");
		expect(byUser.get(ALICE)).toBe(4 * HOUR); // 3h project + 1h unfiled, not 12h

		const everything = await ledgerByUser(ctx, RANGE, "all");
		expect(everything.get(ALICE)).toBe(12 * HOUR);
	});
});

describe("grouping", () => {
	test("by user", async () => {
		const byUser = await ledgerByUser(ctx, RANGE, "project");
		expect(byUser.get(ALICE)).toBe(3 * HOUR);
		expect(byUser.get(BOB)).toBe(2 * HOUR);
	});

	test("a user with no rows is absent rather than zero", async () => {
		const byUser = await ledgerByUser(ctx, RANGE, "absence");
		expect(byUser.has(BOB)).toBe(false);
		expect(byUser.get(BOB) ?? 0).toBe(0);
	});

	// The close overview folded every unfiled row into an empty-string key,
	// where it read as a project total belonging to no project.
	test("by project drops unfiled rather than bucketing it under an empty key", async () => {
		const byProject = await ledgerByProject(ctx, RANGE, "worked");
		expect(byProject.get(projectId)).toBe(3 * HOUR);
		expect(byProject.get(otherProjectId)).toBe(2 * HOUR);
		expect(byProject.has("")).toBe(false);
		expect([...byProject.values()].reduce((a, b) => a + b, 0)).toBe(5 * HOUR);
	});
});

describe("filters", () => {
	test("by user", async () => {
		expect(await ledgerTotal(ctx, RANGE, "project", { userId: ALICE })).toBe(
			3 * HOUR,
		);
	});

	test("by project", async () => {
		expect(await ledgerTotal(ctx, RANGE, "project", { projectId })).toBe(
			3 * HOUR,
		);
	});

	test("visibleProjectIds scopes to the caller's projects", async () => {
		expect(
			await ledgerTotal(ctx, RANGE, "project", {
				visibleProjectIds: [projectId],
			}),
		).toBe(3 * HOUR);
	});

	// An admin is unscoped (null); someone with no projects is scoped to none,
	// and must see nothing rather than everything.
	test("an empty visible scope yields nothing, not everything", async () => {
		expect(
			await ledgerTotal(ctx, RANGE, "project", { visibleProjectIds: [] }),
		).toBe(0);
		expect(
			await ledgerTotal(ctx, RANGE, "project", { visibleProjectIds: null }),
		).toBe(5 * HOUR);
	});
});

// A break is worked time nobody can attribute: it carries no project, and there
// is no project it could ever be moved to. Counting it as unfiled turned the
// time page's nag and the close guard into a demand the person cannot satisfy —
// reachable through the day assembler's break suggestion, and once a recurring
// break block exists, reachable on every working day of the month.
describe("the Break built-in is worked but never unfiled", () => {
	const BREAK_RANGE = { from: "2026-09-10", to: "2026-09-20" };
	const DATE = "2026-09-15";

	beforeAll(async () => {
		const existing = await db.query.task.findFirst({
			where: and(eq(task.scope, "site"), eq(task.systemKey, "break")),
			columns: { id: true },
		});
		const breakTaskId =
			existing?.id ??
			(
				await db
					.insert(task)
					.values({
						scope: "site" as const,
						name: "Break",
						isAbsence: false,
						systemKey: "break" as const,
					})
					.returning()
			)[0]?.id;
		if (!breakTaskId) throw new Error("break task");

		await db.insert(timeEntry).values([
			{
				organizationId: ORG,
				userId: ALICE,
				projectId: null,
				taskId: breakTaskId,
				date: DATE,
				description: "Break",
				durationSeconds: 1800,
			},
			{
				organizationId: ORG,
				userId: ALICE,
				projectId: null,
				taskId: workTaskId,
				date: DATE,
				description: "meeting",
				durationSeconds: HOUR,
			},
		]);
	});

	test("worked counts it", async () => {
		expect(await ledgerTotal(ctx, BREAK_RANGE, "worked")).toBe(HOUR + 1800);
	});

	// The other half of the assertion: excluding the break must not take the
	// ordinary project-less entries with it. `system_key is distinct from` rather
	// than `!=`, because null != 'break' is null and would drop every row.
	test("unfiled counts the project-less meeting and not the break", async () => {
		expect(await ledgerTotal(ctx, BREAK_RANGE, "unfiled")).toBe(HOUR);
	});
});
