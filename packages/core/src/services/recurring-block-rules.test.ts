// What a recurring block is allowed to write, finally asserted.
//
// Two reports, one engine: the daily break "gets added to every day even if it
// has a break", and it appeared on days that were already filed and closed.
//
// Both came out of `materializeRange`. Its only idempotency was
// `onConflictDoNothing` on `(generatedFromRuleId, generatedForDate)`, which
// recognises an entry THIS rule wrote and nothing else — so a break that came
// from the day assembler, from "copy from previous day", or from someone's own
// hand was invisible to it and got a duplicate. And with no `effectiveFrom` the
// rule reached back to the beginning of time, so scrolling the time page back a
// month wrote a break onto every day of that month.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	recurringBlockRule,
	task,
	timeEntry,
} from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";

const ORG_ID = "org-recurring";
const USER_ID = "user-recurring";
// Fixed and safely in the past, so "does this backfill?" never depends on the
// day the suite happens to run. It has to be a week nobody's real "today" can
// fall inside: creating or resuming a rule materializes today's block now (see
// `materializeNow` in the service), and a fixture week containing today would
// count that block as a backfill.
const MONDAY = "2026-03-09";
const TUESDAY = "2026-03-10";
const WEDNESDAY = "2026-03-11";
const FRIDAY = "2026-03-13";
const WEEKDAYS = [1, 2, 3, 4, 5];

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

let harness: TestDb;
let breakTaskId: string;
let devTaskId: string;
let projectId: string;

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

/** Every entry in the fixture week.
 *
 *  Scoped to the week rather than to the whole table because creating or
 *  resuming a rule now materializes TODAY's block immediately (see
 *  `materializeNow` in the service) — a real, wanted side effect, and one that
 *  would otherwise show up as a phantom row in every backfill assertion below. */
const allEntries = () =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			gte(timeEntry.date, MONDAY),
			lte(timeEntry.date, FRIDAY),
		),
	});

/** A weekday break rule that applies across the fixture week. */
const breakRuleFrom = (effectiveFrom?: string) =>
	recurringBlockRulesService.create(ctx, {
		taskId: breakTaskId,
		daysOfWeek: WEEKDAYS,
		duration: "30m",
		description: "Break",
		effectiveFrom,
	});

/** Backdate a rule's "switched on" stamp, so the fixture week is inside its
 *  reach. Nothing in the product does this — it is how these tests get a rule
 *  that was already running during a week that is permanently in the past. */
const switchedOnAt = async (ruleId: string, dateKey: string) => {
	await db
		.update(recurringBlockRule)
		.set({ activeSince: new Date(`${dateKey}T00:00:00.000Z`) })
		.where(eq(recurringBlockRule.id, ruleId));
};

/** A break rule that has been running since `dateKey`. */
const runningBreakRuleSince = async (dateKey: string) => {
	const rule = await breakRuleFrom();
	await switchedOnAt(rule.id, dateKey);
	return rule;
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Recurring Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "recurring@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-recurring",
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
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Farmer" })
		.returning();
	projectId = p?.id ?? "";

	// Break and the two absence built-ins are seeded by the migrations, like every
	// site task — looked up rather than inserted, or the unique index on site
	// names rejects the duplicate.
	const breakTask = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "break")),
		columns: { id: true },
	});
	breakTaskId = breakTask?.id ?? "";

	const [devTask] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			isAbsence: false,
		})
		.returning({ id: task.id });
	devTaskId = devTask?.id ?? "";

	// The two absence built-ins, so the project-less task list has something to
	// be narrower than.
	await db.insert(task).values([
		{ scope: "site" as const, name: "Vacation", isAbsence: true },
		{ scope: "site" as const, name: "Sick Leave", isAbsence: true },
	]);
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(recurringBlockRule);
});

describe("materializing a recurring block", () => {
	test("a rule written today does not backfill days that predate it", async () => {
		await breakRuleFrom();

		// A range that is over — the rule was made long after these two days.
		await recurringBlockRulesService.materializeRange(ctx, MONDAY, TUESDAY);

		// The report: switching the break on rewrote weeks of already-filed
		// timesheets the moment the time page was scrolled back to them.
		expect(await allEntries()).toHaveLength(0);
	});

	test("a rule that was already running fills the days it covers", async () => {
		await runningBreakRuleSince(MONDAY);

		await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

		expect(await allEntries()).toHaveLength(5); // Mon-Fri
		expect((await entriesOn(MONDAY))[0]?.durationSeconds).toBe(30 * 60);
	});

	test("effectiveFrom can narrow the reach but never widen it", async () => {
		// "Start on Wednesday" is the useful direction. The other way round —
		// an effectiveFrom before the rule existed — is not a licence to backfill,
		// or every rule the UI creates (which sets no effectiveFrom at all) would
		// reach back forever.
		const rule = await breakRuleFrom(WEDNESDAY);
		await switchedOnAt(rule.id, MONDAY);

		await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

		expect(await entriesOn(MONDAY)).toHaveLength(0);
		expect(await entriesOn(WEDNESDAY)).toHaveLength(1);
		expect(await allEntries()).toHaveLength(3); // Wed-Fri
	});

	test("resuming a paused rule does not refill the days it was off for", async () => {
		const rule = await runningBreakRuleSince(MONDAY);
		await recurringBlockRulesService.update(ctx, {
			ruleId: rule.id,
			active: false,
		});
		await recurringBlockRulesService.update(ctx, {
			ruleId: rule.id,
			active: true,
		});

		// The days it was running for before the pause, all safely in the past.
		await recurringBlockRulesService.materializeRange(ctx, MONDAY, WEDNESDAY);

		// Switching it back on today means "from today", not "and catch me up on
		// everything I had it off for".
		expect(await allEntries()).toHaveLength(0);
	});

	test("a day that already has a break gets no second one", async () => {
		await runningBreakRuleSince(MONDAY);
		// However it got there — the day assembler, a copied day, or by hand. What
		// matters is that it was not written by this rule.
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: breakTaskId,
			date: TUESDAY,
			description: "Break",
			durationSeconds: 45 * 60,
		});

		await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

		const tuesday = await entriesOn(TUESDAY);
		expect(tuesday).toHaveLength(1);
		// The one that was already there, untouched — not replaced by the rule's.
		expect(tuesday[0]?.durationSeconds).toBe(45 * 60);
		expect(await allEntries()).toHaveLength(5);
	});

	test("a break already filed against a project still counts as the day's break", async () => {
		// The report, from real data: a hand-logged 30-minute break carrying a
		// project sat next to a project-less one the rule wrote hours later, on
		// three consecutive days. The guard above was project-qualified in both
		// directions, so the rule could not see a break that had been attributed to
		// a client — and a break is exactly the block nobody should be attributing
		// twice.
		await runningBreakRuleSince(MONDAY);
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: breakTaskId,
			projectId,
			date: TUESDAY,
			description: "Break",
			durationSeconds: 30 * 60,
		});

		await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

		const tuesday = await entriesOn(TUESDAY);
		expect(tuesday).toHaveLength(1);
		expect(tuesday[0]?.projectId).toBe(projectId);
		expect(await allEntries()).toHaveLength(5);
	});

	test("materializing the same range twice writes nothing the second time", async () => {
		await runningBreakRuleSince(MONDAY);

		await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);
		await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

		expect(await allEntries()).toHaveLength(5);
	});

	test("the same task on a different project is a different block", async () => {
		// Not everything sharing a task is the same block: a rule against a project
		// must still materialize on a day that holds that task unfiled.
		const rule = await recurringBlockRulesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Retainer",
			daysOfWeek: WEEKDAYS,
			duration: "1h",
		});
		await switchedOnAt(rule.id, MONDAY);
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			date: MONDAY,
			description: "Something else",
			durationSeconds: 3600,
		});

		await recurringBlockRulesService.materializeRange(ctx, MONDAY, MONDAY);

		expect(await entriesOn(MONDAY)).toHaveLength(2);
	});
});

describe("the break needs no project", () => {
	test("the switch writes a rule with no project at all", async () => {
		const rule = await recurringBlockRulesService.enableBreak(ctx);

		expect(rule?.projectId).toBeNull();
		expect(rule?.taskId).toBe(breakTaskId);
	});

	test("turning it on twice resumes the one rule rather than adding a second", async () => {
		const first = await recurringBlockRulesService.enableBreak(ctx);
		const second = await recurringBlockRulesService.enableBreak(ctx);

		expect(second?.id).toBe(first?.id);
	});

	test("the project-less task list offers Break, not just absence", async () => {
		const options = await tasksService.listForProject(ctx, undefined);
		const names = options.map((t) => t.name);

		// The regression: this list was the two absence tasks and nothing else, so
		// a break could not be logged — or ruled — without pinning it to a client's
		// project, which is the one thing a break is never part of.
		expect(names).toContain("Break");
		expect(names).toContain("Vacation");
		expect(names).toContain("Sick Leave");
		// Still not everything: an org's own tasks belong to a project.
		expect(names).not.toContain("Development");
	});
});

// A rule is a time-entry factory — `materializeRange` inserts straight into
// `timeEntry` — so it has to pass the same assignment gate a hand-made entry
// does. It did not: `assertTaskAvailable` was the only check, and that asks
// whether the TASK suits the project, not whether the author has any business
// writing to it. So a rule naming any project in the organization saved happily
// and then materialized real hours onto it, which is the exact write
// `timeEntriesService.create` refuses with "You are not assigned to this
// project".
//
// The fixture's main user is an owner, and an admin may track on everything, so
// these run as a plain member — the only role that can tell the two checks
// apart.
describe("the assignment gate on a rule that names a project", () => {
	const OUTSIDER = "user-recurring-outsider";
	const outsiderCtx = (): Ctx => ({
		organizationId: ORG_ID,
		userId: OUTSIDER,
	});

	const ruleOnProject = (who: Ctx) =>
		recurringBlockRulesService.create(who, {
			taskId: devTaskId,
			projectId,
			daysOfWeek: WEEKDAYS,
			duration: "1h",
			description: "Dev",
		});

	beforeAll(async () => {
		await db.insert(user).values({
			id: OUTSIDER,
			name: "Outsider",
			email: "outsider@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: "member-recurring-outsider",
			organizationId: ORG_ID,
			userId: OUTSIDER,
			role: "member",
			createdAt: new Date(),
		});
	});

	test("a member not assigned to the project is refused", async () => {
		expect(ruleOnProject(outsiderCtx())).rejects.toBeInstanceOf(AccessError);
	});

	test("the same member is allowed once assigned", async () => {
		await db.insert(projectMember).values({
			organizationId: ORG_ID,
			projectId,
			userId: OUTSIDER,
			role: "member",
		});

		const rule = await ruleOnProject(outsiderCtx());
		expect(rule.projectId).toBe(projectId);

		await db.delete(projectMember).where(eq(projectMember.userId, OUTSIDER));
	});

	// Repointing an existing rule is the same write by a slower route, so the
	// check belongs on update too — a rule created project-less and then edited
	// would otherwise walk straight past it.
	test("repointing a project-less rule at a project is refused too", async () => {
		const rule = await recurringBlockRulesService.create(outsiderCtx(), {
			taskId: breakTaskId,
			daysOfWeek: WEEKDAYS,
			duration: "30m",
			description: "Break",
		});

		expect(
			recurringBlockRulesService.update(outsiderCtx(), {
				ruleId: rule.id,
				projectId,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	// A rule with no project is the common case (every break), and must stay
	// unaffected by the gate.
	test("a project-less rule is unaffected", async () => {
		const rule = await recurringBlockRulesService.create(outsiderCtx(), {
			taskId: breakTaskId,
			daysOfWeek: WEEKDAYS,
			duration: "30m",
			description: "Break",
		});
		expect(rule.projectId).toBeNull();
	});
});

// The gate above runs when a rule is SAVED, and a rule then outlives everything
// that made it valid. Taking somebody off a project, archiving the project or
// archiving the task touches none of their rules, so the materializer kept
// writing hours the person could no longer log by hand. It now asks again on
// every pass, the way filing rules do, and a rule that fails is skipped rather
// than deleted.
describe("a rule is re-checked on every pass", () => {
	const ASSIGNED = "user-recurring-assigned";
	const assignedCtx = (): Ctx => ({
		organizationId: ORG_ID,
		userId: ASSIGNED,
	});

	const weekEntriesFor = (userId: string) =>
		db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ORG_ID),
				eq(timeEntry.userId, userId),
				gte(timeEntry.date, MONDAY),
				lte(timeEntry.date, FRIDAY),
			),
		});

	/** A project rule that has been running since the fixture Monday. */
	const runningProjectRule = async (who: Ctx) => {
		const rule = await recurringBlockRulesService.create(who, {
			taskId: devTaskId,
			projectId,
			daysOfWeek: WEEKDAYS,
			duration: "1h",
			description: "Retainer",
		});
		await switchedOnAt(rule.id, MONDAY);
		return rule;
	};

	beforeAll(async () => {
		await db.insert(user).values({
			id: ASSIGNED,
			name: "Assigned",
			email: "assigned@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: "member-recurring-assigned",
			organizationId: ORG_ID,
			userId: ASSIGNED,
			role: "member",
			createdAt: new Date(),
		});
	});

	beforeEach(async () => {
		await db.delete(projectMember).where(eq(projectMember.userId, ASSIGNED));
		await db.insert(projectMember).values({
			organizationId: ORG_ID,
			projectId,
			userId: ASSIGNED,
			role: "member",
		});
	});

	// The control for the three below: the same rule, still valid, fills the week.
	test("a rule that still applies fills the week", async () => {
		await runningProjectRule(assignedCtx());

		await recurringBlockRulesService.materializeRange(
			assignedCtx(),
			MONDAY,
			FRIDAY,
		);

		expect(await weekEntriesFor(ASSIGNED)).toHaveLength(5);
	});

	test("taken off the project, the person gets no new blocks", async () => {
		const rule = await runningProjectRule(assignedCtx());
		await db.delete(projectMember).where(eq(projectMember.userId, ASSIGNED));

		// A fresh Ctx: Access is memoized on the object, and this pass is the one
		// that has to see the assignment gone.
		await recurringBlockRulesService.materializeRange(
			assignedCtx(),
			MONDAY,
			FRIDAY,
		);

		expect(await weekEntriesFor(ASSIGNED)).toHaveLength(0);
		// Skipped, not deleted: re-assigning the person brings the rule back.
		const kept = await db.query.recurringBlockRule.findFirst({
			where: eq(recurringBlockRule.id, rule.id),
		});
		expect(kept).toBeDefined();
	});

	test("an archived project gets no new blocks", async () => {
		await runningProjectRule(ctx);
		await db
			.update(project)
			.set({ status: "archived" })
			.where(eq(project.id, projectId));
		try {
			await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

			expect(await allEntries()).toHaveLength(0);
		} finally {
			await db
				.update(project)
				.set({ status: "active" })
				.where(eq(project.id, projectId));
		}
	});

	test("an archived task gets no new blocks", async () => {
		await runningProjectRule(ctx);
		await db
			.update(task)
			.set({ archivedAt: new Date() })
			.where(eq(task.id, devTaskId));
		try {
			await recurringBlockRulesService.materializeRange(ctx, MONDAY, FRIDAY);

			expect(await allEntries()).toHaveLength(0);
		} finally {
			await db
				.update(task)
				.set({ archivedAt: null })
				.where(eq(task.id, devTaskId));
		}
	});
});
