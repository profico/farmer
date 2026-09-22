// Issue #60: "Meetings not being moved after being modified on google calendar".
//
// Every scenario here is a thing a person does to a meeting ON THE CALENDAR after
// Farmer has already imported it, and what their timesheet should say afterwards.
// The split that matters is whether the person has FILED the meeting in between,
// because filing is the routine act — it is what the unfiled banner asks for —
// and filing is also what sets `syncLocked`.

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
import { syncedMeetingTombstone } from "../db/schema/settings";
import { fakeCalendar } from "../test/calendar";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { setCalendarSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-meeting-moves";
const USER_ID = "user-meeting-moves";
const MONDAY = "2026-08-10";
const TUESDAY = "2026-08-11";
const WEDNESDAY = "2026-08-12";
const WINDOW = { from: MONDAY, to: WEDNESDAY };

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

type Event = {
	id: string;
	title: string;
	start: string;
	end: string;
	meetingUrl: string | null;
	htmlLink: string | null;
};

const eventOn = (
	id: string,
	title: string,
	date: string,
	minutes = 60,
): Event => ({
	id,
	title,
	start: `${date}T09:00:00.000Z`,
	end: new Date(
		new Date(`${date}T09:00:00.000Z`).getTime() + minutes * 60_000,
	).toISOString(),
	meetingUrl: null,
	htmlLink: null,
});

const sync = async (
	events: Event[] | null,
	options: {
		range?: { from: string; to: string };
		lookups?: Parameters<typeof fakeCalendar>[1];
	} = {},
) => {
	setCalendarSourceForTests(fakeCalendar(events, options.lookups));
	await timeEntriesService.syncMeetingsForUser(ctx, options.range ?? WINDOW);
};

const rows = () =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
		),
		orderBy: (t, { asc }) => [asc(t.date)],
	});

let harness: TestDb;
let projectId: string;
let meetingTaskId: string;

/** File the only row on the sheet against the project, the way the dialog does. */
const fileTheMeeting = async () => {
	const row = at(await rows(), 0);
	await timeEntriesService.file(ctx, { timeEntryId: row.id, projectId });
	return row.id;
};

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG_ID,
		name: "Meeting Moves Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "moves@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-meeting-moves",
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
	await db.delete(syncedMeetingTombstone);
});

describe("an UNFILED meeting changed on the calendar", () => {
	test("moved to another day: the entry moves", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		await sync([eventOn("e1", "Planning", TUESDAY)]);

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).date).toBe(TUESDAY);
	});

	test("made longer: the entry grows", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		await sync([eventOn("e1", "Planning", MONDAY, 90)]);

		expect(at(await rows(), 0).durationSeconds).toBe(90 * 60);
	});

	test("the only meeting in the window, moved to next week: the entry goes", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		// Next week is past the window's `to`, so Google returns nothing at all.
		await sync([]);

		expect(await rows()).toHaveLength(0);
	});
});

describe("a FILED meeting changed on the calendar", () => {
	test("moved to another day: the entry moves and stays filed", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		await fileTheMeeting();
		await sync([eventOn("e1", "Planning", TUESDAY)]);

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).date).toBe(TUESDAY);
		expect(at(after, 0).projectId).toBe(projectId);
	});

	test("made longer: the entry grows and stays filed", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		await fileTheMeeting();
		await sync([eventOn("e1", "Planning", MONDAY, 90)]);

		const after = at(await rows(), 0);
		expect(after.durationSeconds).toBe(90 * 60);
		expect(after.projectId).toBe(projectId);
	});

	test("reissued under a new id AND moved: one entry, on the new day", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		await fileTheMeeting();
		// "This and following" on a series: a new event id, on a new day.
		await sync([eventOn("e2", "Planning", TUESDAY)]);

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).date).toBe(TUESDAY);
	});
});

describe("what the person typed in Farmer survives the calendar", () => {
	test("a hand-set length is not overwritten by an unrelated calendar move", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const id = at(await rows(), 0).id;
		// The meeting ran long and the person said so in Farmer, not on the calendar.
		await timeEntriesService.updateDuration(ctx, {
			timeEntryId: id,
			durationSeconds: 2 * 3600,
		});
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);

		expect(at(await rows(), 0).durationSeconds).toBe(2 * 3600);
	});

	test("a hand-written note is not overwritten by a calendar rename", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.updateDescription(ctx, {
			timeEntryId: id,
			description: "Planning — agreed the Q4 scope",
		});
		await sync([eventOn("e1", "Planning (weekly)", MONDAY)]);

		expect(at(await rows(), 0).description).toBe(
			"Planning — agreed the Q4 scope",
		);
	});
});

describe("a meeting cancelled on the calendar", () => {
	test("filed but otherwise untouched: the entry goes", async () => {
		await sync([
			eventOn("e1", "Planning", MONDAY),
			eventOn("e2", "Standup", MONDAY, 15),
		]);
		const planning = at(await rows(), 0);
		await timeEntriesService.file(ctx, { timeEntryId: planning.id, projectId });

		await sync([eventOn("e2", "Standup", MONDAY, 15)]);

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).calendarEventId).toBe("e2");
	});

	test("with a hand-set length: the entry stays, it is the person's record", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.file(ctx, { timeEntryId: id, projectId });
		await timeEntriesService.updateDuration(ctx, {
			timeEntryId: id,
			durationSeconds: 2 * 3600,
		});

		await sync([]);

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).durationSeconds).toBe(2 * 3600);
		// ...and it is the person's own entry now, no longer tied to the event.
		expect(at(after, 0).calendarEventId).toBeNull();
		expect(at(after, 0).projectId).toBe(projectId);
	});

	test("with a hand-written note: the entry stays", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.updateDescription(ctx, {
			timeEntryId: id,
			description: "Planning — agreed the Q4 scope",
		});

		await sync([]);

		expect(await rows()).toHaveLength(1);
	});

	test("then restored on the calendar: the kept entry is not imported a second time", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.updateDescription(ctx, {
			timeEntryId: id,
			description: "Planning — agreed the Q4 scope",
		});
		await sync([]);
		expect(at(await rows(), 0).calendarEventId).toBeNull();

		// The organiser puts the meeting back, on the same day. Nothing ties the
		// person's record to the event any more — that link had to go — so the
		// event arrives as new, lands beside the record of the same meeting and
		// Monday counts it twice. The tombstone is what "nothing touches it
		// again" means.
		await sync([eventOn("e1", "Planning", MONDAY)]);

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).id).toBe(id);
		expect(at(after, 0).description).toBe("Planning — agreed the Q4 scope");
	});

	test("a meeting MOVED out of the window is not tombstoned: only a gone one is", async () => {
		const NEXT_MONDAY = "2026-08-17";
		await sync([eventOn("e1", "Planning", MONDAY)]);
		await timeEntriesService.updateDescription(ctx, {
			timeEntryId: at(await rows(), 0).id,
			description: "Planning — agreed the Q4 scope",
		});

		await sync([], {
			lookups: {
				e1: { status: "found", event: eventOn("e1", "Planning", NEXT_MONDAY) },
			},
		});

		// Still on the calendar, so it is meant to be written again on its new
		// day — the reason the row was unlinked in the first place.
		expect(
			await db.query.syncedMeetingTombstone.findMany({
				where: eq(syncedMeetingTombstone.userId, USER_ID),
			}),
		).toHaveLength(0);
	});
});

describe("a reissued id that another row already holds", () => {
	test("the row outside the window keeps it, and the pass still finishes", async () => {
		const FRIDAY_BEFORE = "2026-08-07";
		// A row on a day this engine may no longer write to: synced while that
		// day was in the window, and holding the very id the reissue mints.
		await sync([eventOn("e2", "Planning", FRIDAY_BEFORE)], {
			range: { from: FRIDAY_BEFORE, to: FRIDAY_BEFORE },
		});
		await sync([eventOn("e1", "Planning", MONDAY)]);
		expect(await rows()).toHaveLength(2);

		// "This and following": e1 is gone, and what Monday's meeting is called
		// now is e2 — the id the out-of-window row holds. Re-pointing Monday's
		// row at it hits te_calendar_event_uidx, and the whole meeting pass goes
		// down with it, imports and fill recompute included.
		await sync([eventOn("e2", "Planning", MONDAY)], {
			lookups: { e1: { status: "absent" } },
		});

		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).date).toBe(FRIDAY_BEFORE);
		expect(at(after, 0).calendarEventId).toBe("e2");
	});
});

describe("asking Google about the rows its list left out", () => {
	test("all of them in one call, however many there are", async () => {
		await sync([
			eventOn("e1", "Planning", MONDAY),
			eventOn("e2", "Standup", MONDAY, 15),
			eventOn("e3", "Retro", TUESDAY, 30),
		]);
		expect(await rows()).toHaveLength(3);

		// The list comes back empty because Google throttled it, not because the
		// week emptied — so every synced row in the window is stale at once. One
		// call carrying every id: per id, the engine used to spend an account
		// read and a better-auth token refresh before it reached Google, in
		// series, and again twenty minutes later.
		const calls: string[][] = [];
		const throttled = fakeCalendar([], {
			e1: { status: "unreadable" },
			e2: { status: "unreadable" },
			e3: { status: "unreadable" },
		});
		setCalendarSourceForTests({
			...throttled,
			lookupEvents: async (lookupCtx, ids) => {
				calls.push([...ids]);
				return throttled.lookupEvents(lookupCtx, ids);
			},
		});
		await timeEntriesService.syncMeetingsForUser(ctx, WINDOW);

		expect(calls).toHaveLength(1);
		expect([...at(calls, 0)].sort()).toEqual(["e1", "e2", "e3"]);
		// And no answer is no evidence: nothing was removed.
		expect(await rows()).toHaveLength(3);
	});
});

describe("a meeting moved beyond the window", () => {
	test("to next week, with other meetings still on: the entry goes, then comes back when the day arrives", async () => {
		const NEXT_MONDAY = "2026-08-17";
		await sync([
			eventOn("e1", "Planning", MONDAY),
			eventOn("e2", "Standup", MONDAY, 15),
		]);
		expect(await rows()).toHaveLength(2);

		// Google's list for this window no longer carries e1; asked by id, it says
		// the event exists and is now next Monday.
		await sync([eventOn("e2", "Standup", MONDAY, 15)], {
			lookups: {
				e1: { status: "found", event: eventOn("e1", "Planning", NEXT_MONDAY) },
			},
		});
		const between = await rows();
		expect(between).toHaveLength(1);
		expect(at(between, 0).calendarEventId).toBe("e2");

		await sync([eventOn("e1", "Planning", NEXT_MONDAY)], {
			range: { from: "2026-08-14", to: NEXT_MONDAY },
		});
		const after = await rows();
		expect(after.map((r) => r.calendarEventId).sort()).toEqual(["e1", "e2"]);
		expect(after.find((r) => r.calendarEventId === "e1")?.date).toBe(
			NEXT_MONDAY,
		);
	});

	test("to next week, filed and with a note: the record stays as the person's own entry, and the meeting arrives fresh on its new day", async () => {
		const NEXT_MONDAY = "2026-08-17";
		await sync([eventOn("e1", "Planning", MONDAY)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.file(ctx, { timeEntryId: id, projectId });
		await timeEntriesService.updateDescription(ctx, {
			timeEntryId: id,
			description: "Planning — agreed the Q4 scope",
		});

		await sync([], {
			lookups: {
				e1: { status: "found", event: eventOn("e1", "Planning", NEXT_MONDAY) },
			},
		});
		// Kept where it was, with everything the person put on it, and no longer
		// tied to an event that now says something else.
		const kept = at(await rows(), 0);
		expect(kept.date).toBe(MONDAY);
		expect(kept.projectId).toBe(projectId);
		expect(kept.description).toBe("Planning — agreed the Q4 scope");
		expect(kept.calendarEventId).toBeNull();

		await sync([eventOn("e1", "Planning", NEXT_MONDAY)], {
			range: { from: "2026-08-14", to: NEXT_MONDAY },
		});
		const after = await rows();
		expect(after).toHaveLength(2);
		const fresh = after.find((r) => r.calendarEventId === "e1");
		expect(fresh?.date).toBe(NEXT_MONDAY);
		expect(fresh?.projectId).toBeNull();
	});
});

describe("when the person and the calendar both change something", () => {
	test("the person moved the day in Farmer; the calendar then changes the length: length follows, day stays", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const row = at(await rows(), 0);
		await timeEntriesService.update(ctx, {
			timeEntryId: row.id,
			taskId: meetingTaskId,
			date: TUESDAY,
			description: row.description,
			durationSeconds: row.durationSeconds,
			overtime: false,
			fillsDay: false,
		});

		await sync([eventOn("e1", "Planning", MONDAY, 90)]);

		const after = at(await rows(), 0);
		expect(after.date).toBe(TUESDAY);
		expect(after.durationSeconds).toBe(90 * 60);
		// And the notice names the length alone. A record that carried the day
		// as well read out as "Moved from Tue" on an entry that is still on
		// Tuesday and was never moved by anybody but the person.
		expect(after.calendarChangeFrom).toEqual({ durationSeconds: 60 * 60 });
	});

	test("both changed the same field: the person wins, and the calendar's value is remembered", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.updateDuration(ctx, {
			timeEntryId: id,
			durationSeconds: 2 * 3600,
		});

		await sync([eventOn("e1", "Planning", MONDAY, 90)]);

		const after = at(await rows(), 0);
		expect(after.durationSeconds).toBe(2 * 3600);
		expect(after.syncedDurationSeconds).toBe(90 * 60);
	});

	test("the person moved the entry out of the window: the calendar cannot pull it back", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const row = at(await rows(), 0);
		await timeEntriesService.update(ctx, {
			timeEntryId: row.id,
			taskId: meetingTaskId,
			date: "2026-07-31",
			description: row.description,
			durationSeconds: row.durationSeconds,
			overtime: false,
			fillsDay: false,
		});

		await sync([eventOn("e1", "Planning", TUESDAY, 90)]);

		const after = at(await rows(), 0);
		expect(after.date).toBe("2026-07-31");
		expect(after.durationSeconds).toBe(3600);
	});
});

describe("rows from before the baseline existed", () => {
	// Filed before this change: sync_locked, no baseline. Nothing says whether
	// its length is the person's or the calendar's, so a value that differs from
	// the calendar is kept, and one that matches starts following from here on.
	const legacyLockedRow = async (durationSeconds: number) => {
		const [row] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: USER_ID,
				projectId,
				taskId: meetingTaskId,
				date: MONDAY,
				description: "Planning",
				durationSeconds,
				calendarEventId: "e1",
				syncLocked: true,
			})
			.returning({ id: timeEntry.id });
		return present(row, "legacy row").id;
	};

	test("a value that differs from the calendar is kept", async () => {
		await legacyLockedRow(2 * 3600);
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		expect(at(await rows(), 0).durationSeconds).toBe(2 * 3600);
	});

	test("a value that matches the calendar follows it from then on", async () => {
		await legacyLockedRow(3600);
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		await sync([eventOn("e1", "Planning", TUESDAY, 90)]);

		const after = at(await rows(), 0);
		expect(after.date).toBe(TUESDAY);
		expect(after.durationSeconds).toBe(90 * 60);
		expect(after.projectId).toBe(projectId);
	});

	test("one whose event is gone is kept as the person's own entry: nobody knows what it holds", async () => {
		await legacyLockedRow(3600);
		await sync([]);
		const after = await rows();
		expect(after).toHaveLength(1);
		expect(at(after, 0).calendarEventId).toBeNull();
	});
});

describe("taking the calendar's values back", () => {
	test("puts a re-lengthed and moved meeting back on the calendar's day and length", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const row = at(await rows(), 0);
		await timeEntriesService.update(ctx, {
			timeEntryId: row.id,
			taskId: meetingTaskId,
			date: TUESDAY,
			description: "Planning — ran long",
			durationSeconds: 2 * 3600,
			overtime: false,
			fillsDay: false,
		});

		await timeEntriesService.useCalendarValues(ctx, { timeEntryId: row.id });

		const after = at(await rows(), 0);
		expect(after.date).toBe(MONDAY);
		expect(after.durationSeconds).toBe(3600);
		// The note is the person's and stays.
		expect(after.description).toBe("Planning — ran long");
	});

	test("after which the entry follows the calendar again", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.updateDuration(ctx, {
			timeEntryId: id,
			durationSeconds: 2 * 3600,
		});
		await timeEntriesService.useCalendarValues(ctx, { timeEntryId: id });

		await sync([eventOn("e1", "Planning", MONDAY, 90)]);
		expect(at(await rows(), 0).durationSeconds).toBe(90 * 60);
	});

	test("refuses an entry that is not a synced meeting", async () => {
		const [row] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: USER_ID,
				taskId: meetingTaskId,
				date: MONDAY,
				description: "Planning",
				durationSeconds: 3600,
			})
			.returning({ id: timeEntry.id });
		await expect(
			timeEntriesService.useCalendarValues(ctx, {
				timeEntryId: present(row, "row").id,
			}),
		).rejects.toThrow("not linked to a calendar meeting");
	});
});

describe("the 'updated by calendar' notice", () => {
	test("a first import carries no notice", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		expect(at(await rows(), 0).calendarChangedAt).toBeNull();
	});

	test("a calendar move stamps the notice with what the entry said before", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		await sync([eventOn("e1", "Planning", TUESDAY, 90)]);

		const row = at(await rows(), 0);
		expect(row.calendarChangedAt).not.toBeNull();
		// The title did not change, so it is not in the record: the record is the
		// list of what moved, which is what the pill reads out.
		expect(row.calendarChangeFrom).toEqual({
			date: MONDAY,
			durationSeconds: 3600,
		});
	});

	test("an unchanged calendar leaves the notice as it was", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		await sync([eventOn("e1", "Planning", TUESDAY)]);
		const stamped = at(await rows(), 0).calendarChangedAt;
		await sync([eventOn("e1", "Planning", TUESDAY)]);
		expect(at(await rows(), 0).calendarChangedAt).toEqual(stamped);
	});

	test("a field the person owns changing on the calendar is not a notice", async () => {
		await sync([eventOn("e1", "Planning", MONDAY, 60)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.updateDuration(ctx, {
			timeEntryId: id,
			durationSeconds: 2 * 3600,
		});
		await sync([eventOn("e1", "Planning", MONDAY, 90)]);
		expect(at(await rows(), 0).calendarChangedAt).toBeNull();
	});

	test("dismissing clears it, and the next real change brings it back", async () => {
		await sync([eventOn("e1", "Planning", MONDAY)]);
		await sync([eventOn("e1", "Planning", TUESDAY)]);
		const id = at(await rows(), 0).id;
		await timeEntriesService.acknowledgeCalendarChange(ctx, {
			timeEntryId: id,
		});
		expect(at(await rows(), 0).calendarChangedAt).toBeNull();
		expect(at(await rows(), 0).calendarChangeFrom).toBeNull();

		await sync([eventOn("e1", "Planning (Q4)", TUESDAY)]);
		expect(at(await rows(), 0).calendarChangeFrom?.description).toBe(
			"Planning",
		);
	});
});
