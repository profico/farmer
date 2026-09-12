// "Copy from previous day", finally asserted.
//
// The copy filtered fill blocks out of its source query, on the reasoning that a
// fill block's duration is derived and therefore not meaningful to duplicate.
// True of the duration, false of the block: a person whose day is a couple of
// meetings and a "rest of day" block has most of their hours living in exactly
// the row the copy dropped. Copying a day made only of a fill block reported
// "Nothing to copy from the previous day" at someone looking at a full day.
//
// It also wrote its rows with a raw insert, so it bypassed every check `create`
// performs, and it never looked at the target day — so clicking twice, or
// copying onto a day the recurring materializer had already populated, silently
// duplicated entries.

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
import { client, project, task, timeEntry } from "../db/schema/domain";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { createTestDb, type TestDb } from "../test/harness";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-copy";
const USER_ID = "user-copy";
const MONDAY = "2026-08-10";
const TUESDAY = "2026-08-11";
const EIGHT_HOURS = 8 * 3600;

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

let harness: TestDb;
let devTaskId: string;
let breakTaskId: string;
let vacationTaskId: string;
let projectId: string;

const rowsOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

const totalOn = async (date: string) =>
	(await rowsOn(date)).reduce((sum, r) => sum + r.durationSeconds, 0);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Copy Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "copy@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-copy",
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
		.values({ organizationId: ORG_ID, clientId: c!.id, name: "Farmer" })
		.returning();
	projectId = p!.id;

	const findOrMakeSiteTask = async (
		systemKey: "development" | "break",
	): Promise<string> => {
		const existing = await db.query.task.findFirst({
			where: and(eq(task.scope, "site"), eq(task.systemKey, systemKey)),
			columns: { id: true },
		});
		if (existing) return existing.id;
		const [row] = await db
			.insert(task)
			.values({
				scope: "site" as const,
				name: systemKey,
				systemKey,
				isAbsence: false,
			})
			.returning({ id: task.id });
		return row!.id;
	};

	devTaskId = await findOrMakeSiteTask("development");
	breakTaskId = await findOrMakeSiteTask("break");

	const existingVacation = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.isAbsence, true)),
		columns: { id: true },
	});
	vacationTaskId =
		existingVacation?.id ??
		(
			await db
				.insert(task)
				.values({ scope: "site" as const, name: "Vacation", isAbsence: true })
				.returning({ id: task.id })
		)[0]!.id;

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
});

const logWork = (date: string, seconds: number, description: string) =>
	timeEntriesService.create(ctx, {
		taskId: devTaskId,
		projectId,
		description,
		date,
		durationSeconds: seconds,
		overtime: false,
		fillsDay: false,
	});

const logFill = (date: string) =>
	timeEntriesService.create(ctx, {
		taskId: devTaskId,
		description: "Rest of day",
		date,
		overtime: false,
		fillsDay: true,
	});

describe("copy from previous day", () => {
	test("a day whose hours live in a fill block copies as a full day", async () => {
		await logFill(MONDAY);
		expect(await totalOn(MONDAY)).toBe(EIGHT_HOURS);

		// The regression: this reported { copied: 0 } and the UI said "Nothing to
		// copy from the previous day".
		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		expect(result.copied).toBe(1);
		expect(await totalOn(TUESDAY)).toBe(EIGHT_HOURS);
		expect((await rowsOn(TUESDAY)).some((r) => r.fillsDay)).toBe(true);
	});

	test("a mixed day carries both the entry and the fill block", async () => {
		await logWork(MONDAY, 2 * 3600, "Real work");
		await logFill(MONDAY);
		expect(await totalOn(MONDAY)).toBe(EIGHT_HOURS);

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		expect(result.copied).toBe(2);
		const tuesday = await rowsOn(TUESDAY);
		expect(tuesday).toHaveLength(2);
		// The fill is re-derived against the target day, not copied verbatim.
		expect(tuesday.find((r) => r.fillsDay)?.durationSeconds).toBe(
			EIGHT_HOURS - 2 * 3600,
		);
		expect(await totalOn(TUESDAY)).toBe(EIGHT_HOURS);
	});

	test("copying twice does not duplicate the day", async () => {
		await logWork(MONDAY, 2 * 3600, "Real work");

		const first = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});
		const second = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		expect(first.copied).toBe(1);
		expect(second.copied).toBe(0);
		expect(second.skipped).toBe(1);
		expect(await rowsOn(TUESDAY)).toHaveLength(1);
	});

	test("an entry the target day already has is skipped, the rest still copies", async () => {
		// The shape the recurring-block materializer produces: the same break on
		// both days before the copy is even clicked.
		await timeEntriesService.create(ctx, {
			taskId: breakTaskId,
			description: "Break",
			date: MONDAY,
			durationSeconds: 45 * 60,
			overtime: false,
			fillsDay: false,
		});
		await logWork(MONDAY, 2 * 3600, "Real work");
		await timeEntriesService.create(ctx, {
			taskId: breakTaskId,
			description: "Break",
			date: TUESDAY,
			durationSeconds: 45 * 60,
			overtime: false,
			fillsDay: false,
		});

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		expect(result.copied).toBe(1);
		expect(result.skipped).toBe(1);
		const tuesday = await rowsOn(TUESDAY);
		expect(tuesday.filter((r) => r.taskId === breakTaskId)).toHaveLength(1);
		expect(tuesday).toHaveLength(2);
	});

	test("identical rows are deduped as a set, not as a multiset", async () => {
		await logWork(MONDAY, 3600, "Standup follow-up");
		await logWork(MONDAY, 3600, "Standup follow-up");
		await logWork(TUESDAY, 3600, "Standup follow-up");

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		// "Already here" is judged per DISTINCT (project, task, duration, note),
		// not per occurrence: Tuesday having one of these suppresses both of
		// Monday's. The alternative — owing Tuesday a second copy because Monday
		// happened to hold two — makes the second click of the button add a row,
		// which is exactly the doubling the dedup exists to stop.
		expect(result.copied).toBe(0);
		expect(result.skipped).toBe(2);
		expect(await rowsOn(TUESDAY)).toHaveLength(1);
	});

	test("absence is copied forward like any other entry", async () => {
		await timeEntriesService.create(ctx, {
			taskId: vacationTaskId,
			date: MONDAY,
			durationSeconds: EIGHT_HOURS,
			overtime: false,
			fillsDay: false,
		});

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		// Documenting what the copy does, not endorsing it: an absence entry is
		// the shadow of an approved time-off request, so a copied one is time off
		// nobody approved. The copy has no taxonomy gate at all — it is a straight
		// insert — so this would have to be an explicit skip, the way the fill
		// block is an explicit re-derive.
		expect(result.copied).toBe(1);
		expect(await rowsOn(TUESDAY)).toHaveLength(1);
	});

	test("a calendar meeting is copied, but not its link to the event", async () => {
		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Design review",
			date: MONDAY,
			durationSeconds: 3600,
			overtime: false,
			fillsDay: false,
			calendarEventId: "event-1",
		});

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		// The time is copied; the calendar binding is not. Carrying the event id
		// over would put the copy back under the sync engine's control on a day
		// the event never happened on — and skipping the row outright left a
		// mistakenly deleted meeting unrecoverable, because the delete also writes
		// a tombstone that stops the sync re-importing it.
		expect(result.copied).toBe(1);
		const tuesday = await rowsOn(TUESDAY);
		expect(tuesday).toHaveLength(1);
		expect(tuesday[0]?.calendarEventId).toBeNull();
		expect(tuesday[0]?.durationSeconds).toBe(3600);
	});

	test("the target day's existing fill block is kept and resized", async () => {
		await logWork(MONDAY, 2 * 3600, "Real work");
		await logFill(MONDAY);
		await logFill(TUESDAY);

		await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		const tuesday = await rowsOn(TUESDAY);
		// One fill block per day is a database constraint — the copy must not try
		// for a second, and the survivor shrinks around the entry that arrived.
		expect(tuesday.filter((r) => r.fillsDay)).toHaveLength(1);
		expect(tuesday.find((r) => r.fillsDay)?.durationSeconds).toBe(
			EIGHT_HOURS - 2 * 3600,
		);
		expect(await totalOn(TUESDAY)).toBe(EIGHT_HOURS);
	});

	test("an empty source day copies nothing", async () => {
		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: TUESDAY,
		});

		expect(result).toEqual({ copied: 0, skipped: 0 });
	});

	test("copying a day onto itself is a no-op", async () => {
		await logWork(MONDAY, 3600, "Real work");

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MONDAY,
			toDate: MONDAY,
		});

		expect(result).toEqual({ copied: 0, skipped: 0 });
		expect(await rowsOn(MONDAY)).toHaveLength(1);
	});
});
