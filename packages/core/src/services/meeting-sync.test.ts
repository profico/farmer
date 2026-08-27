// The idempotency claim, finally asserted.
//
// CLAUDE.md and jobs/meeting-sync.ts both describe the meeting sync as
// "idempotent by construction (onConflictDoNothing + tombstones)", and until
// there was a seam at the calendar and a database that could be stood up in
// process, nothing checked it. The claim was also imprecise: the MEETING path
// upserts with onConflictDoUpdate ... setWhere syncLocked = false. It is
// onConflictDoNothing that guards the COMMIT path. Two engines, one sentence.
//
// What matters to a user is narrower and testable: running the sync twice over
// an unchanged calendar leaves the day exactly as it was, and a meeting they
// deleted stays deleted.

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
import { organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { syncedMeetingTombstone } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { setCalendarSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-meeting-sync";
const USER_ID = "user-meeting-sync";
const DATE = "2026-08-10"; // a Monday
const RANGE = { from: DATE, to: DATE };

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

type Event = {
	id: string;
	title: string;
	start: string;
	end: string;
	meetingUrl: string | null;
	htmlLink: string | null;
};

const event = (id: string, title: string, hours: number): Event => ({
	id,
	title,
	start: `${DATE}T09:00:00.000Z`,
	end: `${DATE}T${String(9 + hours).padStart(2, "0")}:00:00.000Z`,
	meetingUrl: null,
	htmlLink: null,
});

/** An event whose end is at or before its start. Google emits these for
 *  cancelled-but-still-listed slots and for the odd zero-length placeholder. */
const degenerateEvent = (
	id: string,
	title: string,
	minutes: number,
): Event => ({
	id,
	title,
	start: `${DATE}T09:00:00.000Z`,
	end: `${DATE}T09:${String(Math.max(0, minutes)).padStart(2, "0")}:00.000Z`,
	meetingUrl: null,
	htmlLink: null,
});

/** In-memory calendar. `null` reproduces "couldn't read the calendar". */
const calendarReturning = (events: Event[] | null) => ({
	listEventsForRange: async () => events,
	listEventsForDay: async () => events ?? [],
});

let harness: TestDb;

const meetingRows = () =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
		),
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Meeting Sync Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "tester@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	// The engine resolves its task by system key, not by name. The migrations
	// already seed the site built-ins, so this only fills the gap if that ever
	// stops being true rather than assuming either way.
	const existing = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "meeting")),
		columns: { id: true },
	});
	if (!existing) {
		await db.insert(task).values({
			scope: "site" as const,
			name: "Meeting",
			systemKey: "meeting" as const,
			isAbsence: false,
		});
	}
});

afterAll(async () => {
	setCalendarSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(syncedMeetingTombstone);
});

describe("meeting sync", () => {
	test("imports one entry per calendar event", async () => {
		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.description).toBe("Standup");
		expect(rows[0]?.durationSeconds).toBe(3600);
		expect(rows[0]?.calendarEventId).toBe("e1");
	});

	// The claim under test.
	test("running twice over an unchanged calendar changes nothing", async () => {
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Standup", 1), event("e2", "Review", 2)]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		const first = await meetingRows();

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		const second = await meetingRows();

		expect(second).toHaveLength(first.length);
		expect(second.map((r) => r.id).sort()).toEqual(
			first.map((r) => r.id).sort(),
		);
		expect(second.map((r) => r.durationSeconds).sort()).toEqual(
			first.map((r) => r.durationSeconds).sort(),
		);
	});

	test("a third and fourth run are still stable", async () => {
		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		for (let i = 0; i < 4; i++) {
			await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		}
		expect(await meetingRows()).toHaveLength(1);
	});

	// Delete-by-absence: an event that disappears from the calendar retires its
	// sync-owned entry.
	test("an event removed from the calendar removes its entry", async () => {
		setCalendarSourceForTests(
			calendarReturning([event("e1", "Standup", 1), event("e2", "Review", 2)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(2);

		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.calendarEventId).toBe("e1");
	});

	// The empty-set guard: an emptied calendar is indistinguishable from a
	// calendar the sync failed to read for this range, so it must not wipe.
	test("an empty calendar does not delete everything", async () => {
		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);

		setCalendarSourceForTests(calendarReturning([]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);
	});

	// An unreadable calendar (disconnected / revoked token) must bail rather than
	// treat "no events" as "every meeting was cancelled".
	test("an unreadable calendar leaves existing entries alone", async () => {
		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);

		setCalendarSourceForTests(calendarReturning(null));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);
	});

	test("a tombstoned meeting stays deleted across syncs", async () => {
		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const [row] = await meetingRows();
		if (!row) throw new Error("expected a synced row");

		// Deleting a synced meeting writes the tombstone.
		await timeEntriesService.remove(ctx, row.id);
		expect(await meetingRows()).toHaveLength(0);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(0);
	});

	// Google mints a new event id when a recurring series is edited with "this
	// and following", and a filed meeting is sync-locked so delete-by-absence
	// spares it. Without the identity guard the new id imports alongside the old
	// row and the day shows the same meeting twice.
	test("a reissued event id does not duplicate a sync-locked meeting", async () => {
		setCalendarSourceForTests(calendarReturning([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const [row] = await meetingRows();
		if (!row) throw new Error("expected a synced row");

		// Filing a meeting locks it against the sync engine.
		await db
			.update(timeEntry)
			.set({ syncLocked: true })
			.where(eq(timeEntry.id, row.id));

		// Same day, same title, same length — a new id for the same meeting.
		setCalendarSourceForTests(calendarReturning([event("e2", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await meetingRows()).toHaveLength(1);
	});
	// `snapToQuarterHour` floors at 900s by design, so snap(0) and snap(-3600)
	// are both 900. The engine filtered `durationSeconds > 0` AFTER snapping —
	// a condition that is therefore always true — so a zero-length calendar slot
	// became a 15-minute meeting on the timesheet. The day assembler had always
	// guarded on the raw duration; the engine that actually writes did not.
	test("a zero-length calendar event is not imported", async () => {
		setCalendarSourceForTests(
			calendarReturning([degenerateEvent("z1", "Placeholder", 0)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await meetingRows()).toHaveLength(0);
	});

	test("an event that ends before it starts is not imported", async () => {
		setCalendarSourceForTests(
			calendarReturning([
				{
					id: "z2",
					title: "Backwards",
					start: `${DATE}T10:00:00.000Z`,
					end: `${DATE}T09:00:00.000Z`,
					meetingUrl: null,
					htmlLink: null,
				},
			]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await meetingRows()).toHaveLength(0);
	});

	// The floor still applies to real meetings: a 5-minute call is a real thing
	// that happened, and rounds up to the smallest slot the app can express.
	test("a very short real meeting still rounds up to 15 minutes", async () => {
		setCalendarSourceForTests(
			calendarReturning([degenerateEvent("s1", "Quick sync", 5)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.durationSeconds).toBe(900);
	});

	test("a zero-length event alongside a real one imports only the real one", async () => {
		setCalendarSourceForTests(
			calendarReturning([
				degenerateEvent("z1", "Placeholder", 0),
				event("e1", "Standup", 1),
			]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.calendarEventId).toBe("e1");
	});
});
