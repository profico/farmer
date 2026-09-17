// The mandatory description follows the TASK, not the project.
//
// It used to be a refinement on the entry input keyed on "was a project
// supplied" — the only proxy a schema can see. Once every task sits on every
// project that proxy is wrong both ways: a Break on a project demanded a note,
// and a Meeting logged without a project got away without one. The service now
// asks with the task row in hand (`assertDescribed`): worked time must say what
// was done; time off and a Break need not.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { createTestDb, present, type TestDb } from "../test/harness";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-description-rule";
const USER_ID = "user-description-rule";
const MON = "2026-08-10";
const TUE = "2026-08-11";
const WED = "2026-08-12";
const THU = "2026-08-13";

const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

let harness: TestDb;
let projectId = "";
let devTaskId = "";
let meetingTaskId = "";
let breakTaskId = "";
let paidLeaveTaskId = "";

const siteTask = async (systemKey: "meeting" | "break" | "paid_leave") => {
	const row = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, systemKey)),
		columns: { id: true },
	});
	return present(row, `site task ${systemKey}`).id;
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Description Rule Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "description-rule@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-description-rule",
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
		.returning({ id: project.id });
	projectId = p?.id ?? "";
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
		role: "member",
		active: true,
	});

	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			systemKey: "development" as const,
			isAbsence: false,
		})
		.returning({ id: task.id });
	devTaskId = dev?.id ?? "";
	meetingTaskId = await siteTask("meeting");
	breakTaskId = await siteTask("break");
	paidLeaveTaskId = await siteTask("paid_leave");

	// A recurring rule materializes onto working days, so the person needs some.
	for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
		const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			dayOfWeek,
			enabled: isWeekday,
			startTime: isWeekday ? "09:00" : null,
			endTime: isWeekday ? "17:00" : null,
		});
	}
});

afterAll(async () => {
	await harness.close();
});

const baseEntry = {
	durationSeconds: 3600,
	overtime: false,
	fillsDay: false,
};

describe("the description rule follows the task", () => {
	test("worked time on a project without a note is refused", async () => {
		await expect(
			timeEntriesService.create(ctx(), {
				...baseEntry,
				date: MON,
				projectId,
				taskId: devTaskId,
			}),
		).rejects.toThrow("Describe what you worked on");
	});

	test("a Break on a project needs no note", async () => {
		const row = await timeEntriesService.create(ctx(), {
			...baseEntry,
			date: MON,
			projectId,
			taskId: breakTaskId,
		});
		expect(row.description).toBe("");
	});

	test("a Meeting without a project still needs a note", async () => {
		await expect(
			timeEntriesService.create(ctx(), {
				...baseEntry,
				date: TUE,
				taskId: meetingTaskId,
			}),
		).rejects.toThrow("Describe what you worked on");
	});

	test("time off needs no note", async () => {
		const row = await timeEntriesService.create(ctx(), {
			...baseEntry,
			date: TUE,
			taskId: paidLeaveTaskId,
		});
		expect(row.description).toBe("");
	});

	test("clearing the note on worked time is refused on update", async () => {
		const row = await timeEntriesService.create(ctx(), {
			...baseEntry,
			date: WED,
			projectId,
			taskId: devTaskId,
			description: "Wrote the thing",
		});
		await expect(
			timeEntriesService.update(ctx(), {
				...baseEntry,
				timeEntryId: row.id,
				date: WED,
				projectId,
				taskId: devTaskId,
				description: "   ",
			}),
		).rejects.toThrow("Describe what you worked on");
	});

	test("the week grid may log worked time without a note — it cannot ask", async () => {
		const { entryId } = await timeEntriesService.setWeekCell(ctx(), {
			date: THU,
			projectId,
			taskId: devTaskId,
			durationSeconds: 1800,
		});
		const row = await db.query.timeEntry.findFirst({
			where: eq(timeEntry.id, present(entryId, "grid entry")),
		});
		expect(row?.description).toBe("");
	});
});

describe("a recurring block follows the same rule", () => {
	test("a worked-time rule without a note is refused", async () => {
		await expect(
			recurringBlockRulesService.create(ctx(), {
				taskId: devTaskId,
				projectId,
				daysOfWeek: [1, 2, 3, 4, 5],
				duration: "30m",
			}),
		).rejects.toThrow("Describe what you worked on");
	});

	test("a Break rule needs no note, and cannot be turned into an unnoted worked-time rule", async () => {
		const rule = await recurringBlockRulesService.create(ctx(), {
			taskId: breakTaskId,
			projectId,
			daysOfWeek: [1, 2, 3, 4, 5],
			duration: "30m",
		});
		expect(rule.description).toBe("");
		await expect(
			recurringBlockRulesService.update(ctx(), {
				ruleId: rule.id,
				taskId: devTaskId,
			}),
		).rejects.toThrow("Describe what you worked on");
	});

	// The bug this replaced: update asked the note question a second time, keyed
	// on the project rather than the task, so a Break rule on a project saved
	// fine and then refused every later edit over the note its label calls
	// optional.
	test("a Break rule on a project can be edited with no note", async () => {
		const rule = await recurringBlockRulesService.create(ctx(), {
			taskId: breakTaskId,
			projectId,
			daysOfWeek: [1, 2, 3, 4, 5],
			duration: "30m",
		});
		const updated = await recurringBlockRulesService.update(ctx(), {
			ruleId: rule.id,
			taskId: breakTaskId,
			projectId,
			description: "",
			duration: "45m",
		});
		expect(updated?.durationSeconds).toBe(45 * 60);
		expect(updated?.description).toBe("");
	});
});
