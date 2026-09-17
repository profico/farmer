// A PM's absence correction resizes the person's rest-of-day block.
//
// Absence is a claim on the day like any other entry, so the fill block — "the
// rest of the working day" — has to give way to it. Every self-service write
// already recomputes the day. The three PM writes from the close sheet
// (`createAbsenceForUser`, `overrideAbsence`, `removeAbsence`) did not, so a
// day where the PM logged sick leave kept its 8h block as well: 16h against an
// 8h day, on the sheet the month is invoiced from.

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
import { task, timeEntry } from "../db/schema/domain";
import { createTestDb, present, type TestDb } from "../test/harness";
import { DayCapacityError, timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-absence-fill";

const PM = "user-absence-fill-pm";

const PERSON = "user-absence-fill-person";

const DAY = "2026-08-10"; // a Monday

/** The synthesized default working day: Mon-Fri 09:00-17:00. */
const WORKDAY_SECONDS = 8 * 3600;

/** Fresh per call: Access is memoized on the Ctx object. */
const pmCtx = (): Ctx => ({ organizationId: ORG_ID, userId: PM });

let harness: TestDb;

let leaveTaskId = "";

let devTaskId = "";

const fillOf = async () => {
	const rows = await db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, PERSON),
			eq(timeEntry.date, DAY),
			eq(timeEntry.fillsDay, true),
		),
	});

	return rows[0] ?? null;
};

const addPersonEntry = (durationSeconds: number, fillsDay: boolean) =>
	db.insert(timeEntry).values({
		organizationId: ORG_ID,
		userId: PERSON,
		taskId: devTaskId,
		projectId: null,
		date: DAY,
		description: fillsDay ? "Rest of day" : "Work",
		durationSeconds,
		fillsDay,
	});

const logLeave = (durationSeconds: number) =>
	timeEntriesService.createAbsenceForUser(pmCtx(), {
		userId: PERSON,
		taskId: leaveTaskId,
		date: DAY,
		durationSeconds,
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Absence Fill Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});

	for (const id of [PM, PERSON]) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	// An admin may correct anybody's absence, which keeps this file about the
	// fill block rather than about the PM matrix (access.test.ts owns that).
	await db.insert(member).values([
		{
			id: "member-absence-fill-pm",
			organizationId: ORG_ID,
			userId: PM,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "member-absence-fill-person",
			organizationId: ORG_ID,
			userId: PERSON,
			role: "member",
			createdAt: new Date(),
		},
	]);

	// Migration 0038 seeds Paid Leave, so it is looked up rather than inserted.
	const leave = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "paid_leave")),
		columns: { id: true },
	});

	leaveTaskId = present(leave, "paid leave task").id;

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

	devTaskId = present(dev, "development task").id;
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
});

describe("a PM's absence correction and the person's fill block", () => {
	test("a full day of leave squeezes the block out", async () => {
		await addPersonEntry(WORKDAY_SECONDS, true);

		await logLeave(WORKDAY_SECONDS);

		expect(await fillOf()).toBeNull();
	});

	test("half a day of leave halves it", async () => {
		await addPersonEntry(WORKDAY_SECONDS, true);

		await logLeave(4 * 3600);

		expect((await fillOf())?.durationSeconds).toBe(4 * 3600);
	});

	test("correcting the leave down gives the time back", async () => {
		await addPersonEntry(WORKDAY_SECONDS, true);
		const leave = await logLeave(4 * 3600);

		await timeEntriesService.overrideAbsence(pmCtx(), {
			timeEntryId: leave.id,
			durationSeconds: 2 * 3600,
		});

		expect((await fillOf())?.durationSeconds).toBe(6 * 3600);
	});

	test("removing the leave gives the whole day back", async () => {
		await addPersonEntry(WORKDAY_SECONDS, true);
		const leave = await logLeave(4 * 3600);

		await timeEntriesService.removeAbsence(pmCtx(), leave.id);

		expect((await fillOf())?.durationSeconds).toBe(WORKDAY_SECONDS);
	});

	// The 24-hour ceiling holds on the person's day too: a PM correction is a
	// hand-made write like any other.
	test("leave that would push the person's day past 24 hours is refused", async () => {
		await addPersonEntry(20 * 3600, false);

		await expect(logLeave(WORKDAY_SECONDS)).rejects.toBeInstanceOf(
			DayCapacityError,
		);
	});
});
