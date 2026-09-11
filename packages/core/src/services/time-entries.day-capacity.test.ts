// A day holds at most 24 hours, whichever door the time comes through.
//
// Issue #14. `copyDay` enforced `MAX_DAY_SECONDS` and nothing else did: the
// entry dialog, an edit and a week-grid cell could each stack a day past 24
// hours one save at a time. The ceiling is only a ceiling if every hand-made
// write that adds time to a day checks it.
//
// The other half is what must keep working: an edit that does not grow the day
// is accepted on a day already at the ceiling — and on one already OVER it
// (imported, or written before the check), or it could never be corrected.

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
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import { createTestDb, present, type TestDb } from "../test/harness";
import { DayCapacityError, timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-day-capacity";
const USER_ID = "user-day-capacity";
const DAY = "2026-08-10";
const OTHER_DAY = "2026-08-11";
const HOUR = 3600;

const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

let harness: TestDb;
let projectId = "";
let devTaskId = "";
let reviewTaskId = "";

/** Straight into the table, so the fixture can build a day the checks under
 *  test would refuse to build. */
const addEntry = async (values: {
	date?: string;
	taskId?: string;
	durationSeconds: number;
}) => {
	const [row] = await db
		.insert(timeEntry)
		.values({
			organizationId: ORG_ID,
			userId: USER_ID,
			projectId,
			taskId: values.taskId ?? devTaskId,
			date: values.date ?? DAY,
			description: "Work",
			durationSeconds: values.durationSeconds,
		})
		.returning();
	return present(row, "fixture entry");
};

const updateTo = (
	entry: { id: string; taskId: string },
	change: { date?: string; durationSeconds: number; description?: string },
) =>
	timeEntriesService.update(ctx(), {
		timeEntryId: entry.id,
		projectId,
		taskId: entry.taskId,
		date: change.date ?? DAY,
		description: change.description ?? "Work",
		durationSeconds: change.durationSeconds,
		overtime: false,
		fillsDay: false,
	});

const secondsOn = async (date: string) => {
	const rows = await db.query.timeEntry.findMany({
		where: and(eq(timeEntry.userId, USER_ID), eq(timeEntry.date, date)),
	});
	return rows.reduce((sum, row) => sum + row.durationSeconds, 0);
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Day Capacity Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "capacity@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-day-capacity",
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
			clientId: present(c, "client").id,
			name: "Farmer",
		})
		.returning();
	projectId = present(p, "project").id;

	const tasks = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG_ID,
				name: "Development",
				isAbsence: false,
			},
			{
				scope: "organization" as const,
				organizationId: ORG_ID,
				name: "Review",
				isAbsence: false,
			},
		])
		.returning({ id: task.id, name: task.name });
	devTaskId = present(
		tasks.find((t) => t.name === "Development"),
		"development task",
	).id;
	reviewTaskId = present(
		tasks.find((t) => t.name === "Review"),
		"review task",
	).id;
	await db.insert(projectTask).values([
		{ organizationId: ORG_ID, projectId, taskId: devTaskId },
		{ organizationId: ORG_ID, projectId, taskId: reviewTaskId },
	]);
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
});

describe("the 24-hour ceiling on hand-made writes", () => {
	test("creating an entry past it is refused", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });

		await expect(
			timeEntriesService.create(ctx(), {
				date: DAY,
				projectId,
				taskId: reviewTaskId,
				description: "Review",
				durationSeconds: 5 * HOUR,
				overtime: false,
				fillsDay: false,
			}),
		).rejects.toBeInstanceOf(DayCapacityError);
		expect(await secondsOn(DAY)).toBe(20 * HOUR);
	});

	test("the refusal says what went wrong, for the toast", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });

		await expect(
			timeEntriesService.create(ctx(), {
				date: DAY,
				projectId,
				taskId: reviewTaskId,
				description: "Review",
				durationSeconds: 5 * HOUR,
				overtime: false,
				fillsDay: false,
			}),
		).rejects.toThrow(/more than 24 hours on 2026-08-10/);
	});

	test("lengthening an entry past it is refused", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });
		const short = await addEntry({
			taskId: reviewTaskId,
			durationSeconds: HOUR,
		});

		await expect(
			updateTo(short, { durationSeconds: 5 * HOUR }),
		).rejects.toBeInstanceOf(DayCapacityError);
	});

	test("moving an entry onto a day it would overfill is refused", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });
		const elsewhere = await addEntry({
			date: OTHER_DAY,
			taskId: reviewTaskId,
			durationSeconds: 5 * HOUR,
		});

		await expect(
			updateTo(elsewhere, { date: DAY, durationSeconds: 5 * HOUR }),
		).rejects.toBeInstanceOf(DayCapacityError);
	});

	test("a new week-grid cell past it is refused", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });

		await expect(
			timeEntriesService.setWeekCell(ctx(), {
				date: DAY,
				projectId,
				taskId: reviewTaskId,
				durationSeconds: 5 * HOUR,
			}),
		).rejects.toBeInstanceOf(DayCapacityError);
	});

	test("raising an existing week-grid cell past it is refused", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });
		await addEntry({ taskId: reviewTaskId, durationSeconds: 2 * HOUR });

		await expect(
			timeEntriesService.setWeekCell(ctx(), {
				date: DAY,
				projectId,
				taskId: reviewTaskId,
				durationSeconds: 5 * HOUR,
			}),
		).rejects.toBeInstanceOf(DayCapacityError);
		expect(await secondsOn(DAY)).toBe(22 * HOUR);
	});
});

describe("what the ceiling must still allow", () => {
	test("an edit that keeps a full day's length", async () => {
		await addEntry({ durationSeconds: 16 * HOUR });
		const review = await addEntry({
			taskId: reviewTaskId,
			durationSeconds: 8 * HOUR,
		});

		await updateTo(review, {
			durationSeconds: 8 * HOUR,
			description: "Code review",
		});
		await timeEntriesService.setWeekCell(ctx(), {
			date: DAY,
			projectId,
			taskId: reviewTaskId,
			durationSeconds: 8 * HOUR,
		});

		expect(await secondsOn(DAY)).toBe(24 * HOUR);
	});

	test("shortening an entry on a day already over it", async () => {
		// 28 hours: only reachable by writing around the checks, which is what an
		// import or an older row looks like.
		await addEntry({ durationSeconds: 20 * HOUR });
		const review = await addEntry({
			taskId: reviewTaskId,
			durationSeconds: 8 * HOUR,
		});

		await updateTo(review, { durationSeconds: 6 * HOUR });

		expect(await secondsOn(DAY)).toBe(26 * HOUR);
	});
});
