// Materializing a recurring block has to resize the day's fill block.
//
// A fill block IS "whatever is left of the day", so anything that lands on the
// day afterwards makes it too long. Every hand-written path already recomputed;
// the materializer did not. Turning the daily break on for a day already
// covered by a rest-of-day block left that day at 8h30 against an 8h target.
//
// It used to self-correct, but only by accident and only sometimes — the read
// path rewrote fill blocks for whatever range you happened to scroll to. That
// is now bounded to the automation window and reports read the ledger directly,
// so a day nobody reopened just stayed over-allocated onto the close sheet.

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
import { recurringBlockRule, task, timeEntry } from "../db/schema/domain";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { createTestDb, type TestDb } from "../test/harness";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import type { Ctx } from "./types";

const ORG_ID = "org-rbfill";

const USER_ID = "user-rbfill";

/** Fresh per call — the timezone and holiday memos both hang off the object. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

// A Wednesday, and far enough back that no automation window reaches it — the
// point being that `materializeRange` is called with an explicit range here, so
// the result must not depend on today's date.
const DAY = "2026-02-04";

const HOURS_8 = 28800;

const HALF_HOUR = 1800;

let harness: TestDb;

let devTaskId = "";

let breakTaskId = "";

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Recurring Fill Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "UTC",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "rbfill@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-rbfill",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
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

	// The Break task is site-scoped and seeded by the migrations.
	const seededBreak = await db.query.task.findFirst({
		where: eq(task.systemKey, "break"),
	});

	breakTaskId = seededBreak?.id ?? "";

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

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(recurringBlockRule);
});

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

const loggedOn = async (date: string) =>
	(await entriesOn(date)).reduce((sum, e) => sum + e.durationSeconds, 0);

const addEntry = (
	date: string,
	durationSeconds: number,
	fillsDay: boolean,
	taskId = devTaskId,
) =>
	db.insert(timeEntry).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		taskId,
		projectId: null,
		date,
		durationSeconds,
		description: fillsDay ? "Rest of day" : "Work",
		fillsDay,
	});

/** The daily-break rule, switched on well before `DAY` so the materializer's
 *  activeSince floor doesn't skip it. */
const addBreakRule = () =>
	db.insert(recurringBlockRule).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		taskId: breakTaskId,
		projectId: null,
		description: "Break",
		daysOfWeek: [1, 2, 3, 4, 5],
		durationSeconds: HALF_HOUR,
		active: true,
		activeSince: new Date("2026-01-01T00:00:00Z"),
	});

describe("recurring block materialization and the day's fill block", () => {
	test("a materialized break shrinks the fill block instead of overfilling the day", async () => {
		await addEntry(DAY, HOURS_8, true);
		await addBreakRule();

		await recurringBlockRulesService.materializeRange(ctx(), DAY, DAY);

		const rows = await entriesOn(DAY);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.taskId === breakTaskId)?.durationSeconds).toBe(
			HALF_HOUR,
		);
		expect(rows.find((r) => r.fillsDay)?.durationSeconds).toBe(
			HOURS_8 - HALF_HOUR,
		);
		// The whole point: the day still totals its 8h target, not 8h30.
		expect(await loggedOn(DAY)).toBe(HOURS_8);
	});

	test("a fill block squeezed to nothing is deleted, not left at 0:00", async () => {
		await addEntry(DAY, HOURS_8 - HALF_HOUR, false);
		await addEntry(DAY, HALF_HOUR, true);
		await addBreakRule();

		await recurringBlockRulesService.materializeRange(ctx(), DAY, DAY);

		const rows = await entriesOn(DAY);
		expect(rows.some((r) => r.fillsDay)).toBe(false);
		expect(rows).toHaveLength(2);
		expect(await loggedOn(DAY)).toBe(HOURS_8);
	});

	test("a day with no fill block is left alone apart from the new break", async () => {
		await addEntry(DAY, 3600, false);
		await addBreakRule();

		await recurringBlockRulesService.materializeRange(ctx(), DAY, DAY);

		const rows = await entriesOn(DAY);
		expect(rows).toHaveLength(2);
		// No fill block existed, so none is invented — the day is simply under.
		expect(rows.some((r) => r.fillsDay)).toBe(false);
		expect(await loggedOn(DAY)).toBe(3600 + HALF_HOUR);
	});

	test("re-running is idempotent — the fill block is not shrunk twice", async () => {
		await addEntry(DAY, HOURS_8, true);
		await addBreakRule();

		await recurringBlockRulesService.materializeRange(ctx(), DAY, DAY);
		await recurringBlockRulesService.materializeRange(ctx(), DAY, DAY);

		const rows = await entriesOn(DAY);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.fillsDay)?.durationSeconds).toBe(
			HOURS_8 - HALF_HOUR,
		);
		expect(await loggedOn(DAY)).toBe(HOURS_8);
	});

	test("only days that actually received a block are recomputed", async () => {
		// Thursday: inside the range, but the rule doesn't run on it.
		const THURSDAY = "2026-02-05";
		await addEntry(DAY, HOURS_8, true);
		// A deliberately over-long fill block on a day the materializer must not
		// touch — it recomputes what it wrote to, not the whole range.
		await addEntry(THURSDAY, HOURS_8 + HALF_HOUR, true);
		await db.insert(recurringBlockRule).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: breakTaskId,
			projectId: null,
			description: "Break",
			daysOfWeek: [3],
			durationSeconds: HALF_HOUR,
			active: true,
			activeSince: new Date("2026-01-01T00:00:00Z"),
		});

		await recurringBlockRulesService.materializeRange(ctx(), DAY, THURSDAY);

		expect(await loggedOn(DAY)).toBe(HOURS_8);
		expect(await loggedOn(THURSDAY)).toBe(HOURS_8 + HALF_HOUR);
	});
});
