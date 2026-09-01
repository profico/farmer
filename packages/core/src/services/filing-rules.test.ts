// What a filing rule is allowed to do, and — more to the point — what it is not.
//
// A rule is a standing answer applied by a background engine to time nobody is
// looking at, so the interesting cases are all the ones where it should decline:
// a project the person has been taken off, an archived project, a meeting whose
// title only matches by accident. An engine that keeps quietly filing hours onto
// a project somebody left is worse than one that files nothing, because unfiled
// time is visible and misfiled time is not.

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
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { filingRule } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { present } from "../test/harness";
import { filingRulesService } from "./filing-rules.service";
import { setCalendarSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-filing-rules";
const USER_ID = "user-filing-rules";
const DATE = "2026-08-10"; // a Monday
const RANGE = { from: DATE, to: DATE };

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

let harness: TestDb;
let meetingTaskId: string;
let projectId: string;
let otherProjectId: string;

type Event = {
	id: string;
	title: string;
	start: string;
	end: string;
	meetingUrl: string | null;
	htmlLink: string | null;
};

const event = (id: string, title: string): Event => ({
	id,
	title,
	start: `${DATE}T09:00:00.000Z`,
	end: `${DATE}T10:00:00.000Z`,
	meetingUrl: null,
	htmlLink: null,
});

const calendarReturning = (events: Event[]) => ({
	listEventsForRange: async () => events,
	listEventsForDay: async () => events,
});

const entries = () =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
		),
	});

/** A rule written straight to the table. The product creates these through
 *  `rememberFrom`, which needs entries to have been filed first; these tests are
 *  about what the rule DOES, not about how it got there. */
const ruleFor = async (title: string, targetProjectId: string) => {
	await db.insert(filingRule).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		taskId: meetingTaskId,
		titleKey: title.trim().toLowerCase(),
		title,
		projectId: targetProjectId,
	});
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Filing Rules Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "filing@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	// Deliberately NOT an owner: an admin short-circuits `canTrackOn`, which is
	// exactly the check these tests are here to exercise.
	await db.insert(member).values({
		id: "member-filing",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "member",
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
	projectId = present(p, "project").id;
	const [other] = await db
		.insert(project)
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Other" })
		.returning();
	otherProjectId = present(other, "other project").id;

	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
		role: "member",
	});

	// Meeting is a site built-in seeded by migration 0024 — looked up, never
	// re-inserted (see the note in CLAUDE.md about task_site_name_uidx).
	const meeting = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "meeting")),
		columns: { id: true },
	});
	meetingTaskId = present(meeting, "site Meeting task").id;
});

afterAll(async () => {
	setCalendarSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(filingRule);
	await db
		.update(project)
		.set({ status: "active" })
		.where(eq(project.organizationId, ORG_ID));
});

describe("filing rules applied by the meeting sync", () => {
	test("a matching meeting arrives already filed", async () => {
		await ruleFor("Daily standup", projectId);
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Daily standup")]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await entries();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.projectId).toBe(projectId);
	});

	test("matching ignores case and surrounding whitespace", async () => {
		await ruleFor("Daily standup", projectId);
		setCalendarSourceForTests(
			calendarReturning([event("e1", "  DAILY Standup ")]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect((await entries())[0]?.projectId).toBe(projectId);
	});

	test("a meeting with no rule still lands unfiled", async () => {
		await ruleFor("Daily standup", projectId);
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Something else")]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect((await entries())[0]?.projectId).toBeNull();
	});

	// The rule outlives the assignment that made it valid. Being taken off a
	// project does not delete the rules naming it, and the sweep runs unattended.
	test("a rule for a project the person is not on files nothing", async () => {
		await ruleFor("Daily standup", otherProjectId);
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Daily standup")]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await entries();
		expect(rows).toHaveLength(1);
		// Unfiled, not missing: the entry is still imported, it just waits in the
		// dialog like any other — the same place it would be with no rule at all.
		expect(rows[0]?.projectId).toBeNull();
	});

	test("a rule for an archived project files nothing", async () => {
		await ruleFor("Daily standup", projectId);
		await db
			.update(project)
			.set({ status: "archived" })
			.where(eq(project.id, projectId));
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Daily standup")]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect((await entries())[0]?.projectId).toBeNull();
	});

	// The row stays sync-owned: the rule decides where the time goes, not who
	// owns the row, so Google is still the source of truth for the meeting's
	// existence and a cancelled one must still disappear.
	test("a rule-filed entry is still deleted when the meeting is cancelled", async () => {
		await ruleFor("Daily standup", projectId);
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Daily standup")]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await entries()).toHaveLength(1);

		setCalendarSourceForTests(calendarReturning([event("e2", "Retro")]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await entries();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.description).toBe("Retro");
	});
});

describe("remembering a rule from what was just filed", () => {
	test("one rule per distinct title, whatever the occurrence count", async () => {
		const remembered = await filingRulesService.rememberFrom(ctx, projectId, [
			{ taskId: meetingTaskId, description: "Daily standup" },
			{ taskId: meetingTaskId, description: "daily standup" },
			{ taskId: meetingTaskId, description: "Daily standup" },
			{ taskId: meetingTaskId, description: "Retro" },
		]);

		expect(remembered).toBe(2);
		expect(await filingRulesService.list(ctx)).toHaveLength(2);
	});

	// A blank description falls back to the task name for DISPLAY only. A rule
	// keyed on "" would claim every untitled meeting the sync ever imports, which
	// is the one-default-project behaviour this feature exists instead of.
	test("an entry with no description produces no rule", async () => {
		const remembered = await filingRulesService.rememberFrom(ctx, projectId, [
			{ taskId: meetingTaskId, description: "" },
			{ taskId: meetingTaskId, description: "   " },
		]);

		expect(remembered).toBe(0);
		expect(await filingRulesService.list(ctx)).toHaveLength(0);
	});

	test("re-filing the same meeting elsewhere moves the rule", async () => {
		await filingRulesService.rememberFrom(ctx, otherProjectId, [
			{ taskId: meetingTaskId, description: "Daily standup" },
		]);
		await filingRulesService.rememberFrom(ctx, projectId, [
			{ taskId: meetingTaskId, description: "Daily standup" },
		]);

		const rules = await filingRulesService.list(ctx);
		expect(rules).toHaveLength(1);
		expect(rules[0]?.projectId).toBe(projectId);
	});

	test("removing a rule leaves the entries it already filed alone", async () => {
		await ruleFor("Daily standup", projectId);
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Daily standup")]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rules = await filingRulesService.list(ctx);
		await filingRulesService.remove(ctx, {
			id: present(rules[0], "the rule").id,
		});

		expect(await filingRulesService.list(ctx)).toHaveLength(0);
		expect((await entries())[0]?.projectId).toBe(projectId);
	});

	test("removing a rule that is not yours is not found", async () => {
		await ruleFor("Daily standup", projectId);
		const rules = await filingRulesService.list(ctx);
		const id = present(rules[0], "the rule").id;

		await expect(
			filingRulesService.remove(
				{ organizationId: ORG_ID, userId: "somebody-else" },
				{ id },
			),
		).rejects.toThrow("Filing rule not found");
	});
});
