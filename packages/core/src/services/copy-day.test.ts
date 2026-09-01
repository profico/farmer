// What "copy from previous day" is allowed to do to a day.
//
// Three properties, each of which was missing and each of which was reported by
// a user rather than by a test:
//
//   - a meeting deleted by mistake can be got back (issue #5);
//   - leaning on the button does not stack the day up (issue #5);
//   - a day cannot be pushed past 24 hours (issue #5).
//
// The fill-block cases live here too because copyDay is what surfaced them: it
// is the write most likely to fill a day completely, and a fill block squeezed
// to nothing used to stay behind as a literal `0:00` row.

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
import { syncedMeetingTombstone } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-copy-day";
const USER_ID = "user-copy-day";
const MON = "2026-08-10"; // 8h working day under the synthesized Mon-Fri default
const TUE = "2026-08-11";

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

const HOUR = 3600;

let harness: TestDb;
let taskId: string;

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

/** A plain unfiled entry — no project, so the fixture needs no client or
 *  project rows to satisfy the access guards. The membership row below is
 *  still required: `copyDay` resolves the caller's Access to decide, per
 *  (project, task) pair, whether they may write what they are copying, and
 *  membership is a precondition of that rather than one of its answers. */
const log = (date: string, hours: number, description: string) =>
	timeEntriesService.create(ctx, {
		date,
		taskId,
		description,
		durationSeconds: hours * HOUR,
		overtime: false,
		fillsDay: false,
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Copy Day Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "copy-day@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-copy-day",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
	});

	const meeting = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "meeting")),
		columns: { id: true },
	});
	if (!meeting) throw new Error("migrations no longer seed the Meeting task");
	taskId = meeting.id;
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(syncedMeetingTombstone);
});

describe("copyDay", () => {
	test("copies a calendar-derived entry as a plain manual entry", async () => {
		await timeEntriesService.create(ctx, {
			date: MON,
			taskId,
			description: "Standup",
			durationSeconds: HOUR,
			overtime: false,
			fillsDay: false,
			calendarEventId: "event-1",
			meetingUrl: "https://meet.example.com/abc",
		});

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result.copied).toBe(1);
		const copied = await entriesOn(TUE);
		expect(copied).toHaveLength(1);
		expect(copied[0]?.description).toBe("Standup");
		expect(copied[0]?.durationSeconds).toBe(HOUR);
		// The time comes across; the link to Tuesday-that-never-happened does not,
		// or the sync engine would take the copy for one of its own rows.
		expect(copied[0]?.calendarEventId).toBeNull();
		expect(copied[0]?.meetingUrl).toBeNull();
	});

	test("a second copy adds nothing and reports what it skipped", async () => {
		await log(MON, 2, "Spec review");
		await log(MON, 1, "Standup");

		const first = await timeEntriesService.copyDay(ctx, {
			fromDate: MON,
			toDate: TUE,
		});
		expect(first).toEqual({ copied: 2, skipped: 0 });

		const second = await timeEntriesService.copyDay(ctx, {
			fromDate: MON,
			toDate: TUE,
		});
		expect(second).toEqual({ copied: 0, skipped: 2 });
		expect(await entriesOn(TUE)).toHaveLength(2);
	});

	test("copies only the entries the target day is missing", async () => {
		await log(MON, 2, "Spec review");
		await log(MON, 1, "Standup");
		// Same work, already logged on Tuesday by hand.
		await log(TUE, 2, "Spec review");

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result).toEqual({ copied: 1, skipped: 1 });
		const rows = await entriesOn(TUE);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.description).sort()).toEqual([
			"Spec review",
			"Standup",
		]);
	});

	test("an entry that differs only in its note is real work, not a duplicate", async () => {
		await log(MON, 2, "Spec review");
		await log(TUE, 2, "Something else entirely");

		const result = await timeEntriesService.copyDay(ctx, {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result.copied).toBe(1);
		expect(await entriesOn(TUE)).toHaveLength(2);
	});

	test("refuses to push the target day past 24 hours", async () => {
		await log(MON, 13, "Long day");
		await log(TUE, 12, "Longer day");

		await expect(
			timeEntriesService.copyDay(ctx, { fromDate: MON, toDate: TUE }),
		).rejects.toThrow(/more than 24 hours/);

		// And it is a transaction: the target day is untouched.
		expect(await entriesOn(TUE)).toHaveLength(1);
	});

	test("copying a day onto itself does nothing", async () => {
		await log(MON, 2, "Spec review");

		expect(
			await timeEntriesService.copyDay(ctx, { fromDate: MON, toDate: MON }),
		).toEqual({ copied: 0, skipped: 0 });
		expect(await entriesOn(MON)).toHaveLength(1);
	});
});

describe("copyWeek", () => {
	const LAST_MON = "2026-08-03";
	const LAST_WED = "2026-08-05";
	const THIS_MON = "2026-08-10";
	const THIS_WED = "2026-08-12";

	test("pairs the two weeks up by weekday", async () => {
		await log(LAST_MON, 2, "Monday work");
		await log(LAST_WED, 3, "Wednesday work");

		const result = await timeEntriesService.copyWeek(ctx, {
			fromWeekStart: LAST_MON,
			toWeekStart: THIS_MON,
		});

		expect(result.copied).toBe(2);
		expect(result.blockedDays).toEqual([]);
		// Monday's work lands on Monday, not on whatever day came first.
		expect((await entriesOn(THIS_MON))[0]?.description).toBe("Monday work");
		expect((await entriesOn(THIS_WED))[0]?.description).toBe("Wednesday work");
	});

	test("a second copy of the same week adds nothing", async () => {
		await log(LAST_MON, 2, "Monday work");
		await timeEntriesService.copyWeek(ctx, {
			fromWeekStart: LAST_MON,
			toWeekStart: THIS_MON,
		});

		const second = await timeEntriesService.copyWeek(ctx, {
			fromWeekStart: LAST_MON,
			toWeekStart: THIS_MON,
		});
		expect(second.copied).toBe(0);
		expect(second.skipped).toBe(1);
		expect(await entriesOn(THIS_MON)).toHaveLength(1);
	});

	test("one over-full day does not cost the rest of the week", async () => {
		await log(LAST_MON, 13, "Long Monday");
		await log(LAST_WED, 3, "Wednesday work");
		await log(THIS_MON, 12, "Already a long Monday");

		const result = await timeEntriesService.copyWeek(ctx, {
			fromWeekStart: LAST_MON,
			toWeekStart: THIS_MON,
		});

		expect(result.blockedDays).toEqual([THIS_MON]);
		expect(result.copied).toBe(1);
		// Monday refused, Wednesday still landed.
		expect(await entriesOn(THIS_MON)).toHaveLength(1);
		expect(await entriesOn(THIS_WED)).toHaveLength(1);
	});
});

describe("fill blocks", () => {
	test("a fill block squeezed to nothing is removed, not stored at 0:00", async () => {
		await timeEntriesService.create(ctx, {
			date: MON,
			taskId,
			description: "Rest of day",
			overtime: false,
			fillsDay: true,
		});
		const withFill = await entriesOn(MON);
		expect(withFill).toHaveLength(1);
		// Mon-Fri 9-5 by default, and nothing else logged yet.
		expect(withFill[0]?.durationSeconds).toBe(8 * HOUR);

		// Log the whole day's working hours alongside it.
		await log(MON, 8, "Feature work");

		const after = await entriesOn(MON);
		expect(after).toHaveLength(1);
		expect(after[0]?.fillsDay).toBe(false);
		expect(after[0]?.description).toBe("Feature work");
	});

	test("a fill block cannot be created on an already-full day", async () => {
		await log(MON, 8, "Feature work");

		await expect(
			timeEntriesService.create(ctx, {
				date: MON,
				taskId,
				description: "Rest of day",
				overtime: false,
				fillsDay: true,
			}),
		).rejects.toThrow(/nothing left to fill/);

		expect(await entriesOn(MON)).toHaveLength(1);
	});

	test("copying onto a day with a fill block shrinks the block rather than stacking", async () => {
		await log(MON, 3, "Feature work");
		await timeEntriesService.create(ctx, {
			date: TUE,
			taskId,
			description: "Rest of day",
			overtime: false,
			fillsDay: true,
		});

		await timeEntriesService.copyDay(ctx, { fromDate: MON, toDate: TUE });

		const rows = await entriesOn(TUE);
		expect(rows).toHaveLength(2);
		const fill = rows.find((r) => r.fillsDay);
		expect(fill?.durationSeconds).toBe(5 * HOUR);
	});
});

describe("deleted meeting recovery", () => {
	test("re-creating an entry for a tombstoned event clears the tombstone", async () => {
		const created = await timeEntriesService.create(ctx, {
			date: MON,
			taskId,
			description: "Standup",
			durationSeconds: HOUR,
			overtime: false,
			fillsDay: false,
			calendarEventId: "event-undo",
		});

		await timeEntriesService.remove(ctx, created.id);
		expect(await db.query.syncedMeetingTombstone.findMany()).toHaveLength(1);

		// Exactly what the undo toast does: re-create the entry it just deleted,
		// calendar link and all.
		await timeEntriesService.create(ctx, {
			date: MON,
			taskId,
			description: "Standup",
			durationSeconds: HOUR,
			overtime: false,
			fillsDay: false,
			calendarEventId: "event-undo",
		});

		// Without this the sync engine would keep honouring the tombstone and
		// delete the restored meeting again on the next read.
		expect(await db.query.syncedMeetingTombstone.findMany()).toHaveLength(0);
		expect(await entriesOn(MON)).toHaveLength(1);
	});
});
