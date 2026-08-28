// Budget alerts fire once per threshold crossed, and stay quiet on the way down.
//
// The claim table is the whole idempotency story, so what gets WRITTEN to it
// matters as much as what gets sent. Claiming only the highest crossed threshold
// left holes in it: a project that jumped 70% -> 100% in one tick had a `100`
// row and no `80` row, so the first dip back under 100 deleted its only row and
// re-armed an 80% alert the project had already blown past. Spending less than
// before produced a fresh alert.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { projectBudgetAlert } from "../db/schema/notifications";
import {
	type NotifyAdapter,
	setNotifyAdaptersForTests,
} from "../services/notify";
import { createTestDb, type TestDb } from "../test/harness";
import { runBudgetAlertsOnce } from "./budget-alerts";

const ORG_ID = "org-budget";
const USER_ID = "user-budget";
const BUDGET_SECONDS = 100 * 3600; // 100h, so seconds map to percent cleanly.

let harness: TestDb;
let projectId = "";
let taskId = "";

/** Records every send instead of making one. */
const sent: { title: string; body: string }[] = [];
const recording: NotifyAdapter = async (_to, event) => {
	sent.push({ title: event.title ?? "", body: event.body });
	return true;
};

beforeAll(async () => {
	harness = await createTestDb();
	setNotifyAdaptersForTests({ push: recording, slack: recording });

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Budget Org",
		slug: ORG_ID,
		createdAt: new Date(),
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Owner",
		email: "budget@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-budget",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
	});

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();
	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG_ID,
			clientId: c?.id ?? "",
			name: "Fixed Thing",
			type: "fixed_scope" as const,
			status: "active" as const,
			budgetSeconds: BUDGET_SECONDS,
		})
		.returning({ id: project.id });
	projectId = p?.id ?? "";

	const [t] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			systemKey: "development" as const,
			isAbsence: false,
		})
		.returning({ id: task.id });
	taskId = t?.id ?? "";
});

afterAll(async () => {
	setNotifyAdaptersForTests();
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(projectBudgetAlert);
	sent.length = 0;
});

afterEach(() => {
	sent.length = 0;
});

/** Log `hours` against the project, replacing whatever was there. */
const burnHours = async (hours: number) => {
	await db.delete(timeEntry);
	if (hours === 0) return;
	await db.insert(timeEntry).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		projectId,
		taskId,
		date: "2026-02-04",
		durationSeconds: hours * 3600,
		description: "Work",
	});
};

/** Distinct messages sent — `notify` fans one event out to every enabled
 *  channel, and both are pointed at the same recorder here. */
const titles = () => [...new Set(sent.map((m) => m.title))];

const claimedThresholds = async () =>
	(
		await db.query.projectBudgetAlert.findMany({
			where: eq(projectBudgetAlert.projectId, projectId),
		})
	)
		.map((r) => r.threshold)
		.sort((a, b) => a - b);

describe("budget alerts", () => {
	test("crossing 80% alerts once and claims 80", async () => {
		await burnHours(85);
		const first = await runBudgetAlertsOnce();

		expect(first.alerts).toBe(1);
		expect(sent[0]?.title).toContain("has burned 85%");
		expect(await claimedThresholds()).toEqual([80]);

		// Same burn on the next tick says nothing.
		sent.length = 0;
		const second = await runBudgetAlertsOnce();
		expect(second.alerts).toBe(0);
		expect(sent).toHaveLength(0);
	});

	test("jumping straight past both thresholds claims both, announces once", async () => {
		await burnHours(120);
		const summary = await runBudgetAlertsOnce();

		expect(summary.alerts).toBe(1);
		// One message, and it's the 100% one — not an 80% note alongside it.
		expect(titles()).toHaveLength(1);
		expect(sent[0]?.title).toContain("is over its hour budget");
		// Both rows exist, so nothing is left un-claimed for a later dip to re-fire.
		expect(await claimedThresholds()).toEqual([80, 100]);
	});

	test("dipping from over-budget back under 100 does not re-announce 80", async () => {
		await burnHours(120);
		await runBudgetAlertsOnce();
		sent.length = 0;

		// Someone deletes an entry, or a PM raises the budget: burn falls to 95%.
		await burnHours(95);
		const summary = await runBudgetAlertsOnce();

		expect(summary.alerts).toBe(0);
		expect(sent).toHaveLength(0);
		// The 100 row is re-armed, the 80 claim survives — the project is still
		// over 80 and was already told so.
		expect(await claimedThresholds()).toEqual([80]);
	});

	test("falling under every threshold re-arms, and crossing again alerts again", async () => {
		await burnHours(120);
		await runBudgetAlertsOnce();

		await burnHours(50);
		const quiet = await runBudgetAlertsOnce();
		expect(quiet.alerts).toBe(0);
		expect(await claimedThresholds()).toEqual([]);

		sent.length = 0;
		await burnHours(90);
		const again = await runBudgetAlertsOnce();
		expect(again.alerts).toBe(1);
		expect(sent[0]?.title).toContain("has burned 90%");
		expect(await claimedThresholds()).toEqual([80]);
	});

	test("climbing 85% then 105% announces each threshold once", async () => {
		await burnHours(85);
		await runBudgetAlertsOnce();
		sent.length = 0;

		await burnHours(105);
		const summary = await runBudgetAlertsOnce();

		expect(summary.alerts).toBe(1);
		expect(titles()).toHaveLength(1);
		expect(sent[0]?.title).toContain("is over its hour budget");
		expect(await claimedThresholds()).toEqual([80, 100]);
	});
});
