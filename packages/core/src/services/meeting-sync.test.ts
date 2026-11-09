// The idempotency claim, finally asserted.
//
// docs/domains/automation.md and jobs/meeting-sync.ts both describe the meeting sync as
// "idempotent by construction (onConflictDoNothing + tombstones)", and until
// there was a seam at the calendar and a database that could be stood up in
// process, nothing checked it. The claim was also imprecise: the MEETING path
// upserts with onConflictDoUpdate ... setWhere syncLocked = false. It is
// onConflictDoNothing that guards the COMMIT path. Two engines, one sentence.
//
// What matters to a user is narrower and testable: running the sync twice over
// an unchanged calendar leaves the day exactly as it was, and a meeting they
// deleted stays deleted.
//
// The second group at the bottom is about the day's FILL BLOCK rather than the
// meetings. A meeting claims part of the working day, so the block describing
// "the rest of" that day has to give way to it — and this engine was the one
// automation write path that never resized it.

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
import {
	filingRule,
	integrationSettings,
	orgSettings,
	syncedMeetingTombstone,
} from "../db/schema/settings";
import { fakeCalendar } from "../test/calendar";
import { createTestDb, present, type TestDb } from "../test/harness";
import { setCalendarSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-meeting-sync";
const USER_ID = "user-meeting-sync";
const DATE = "2026-08-10"; // a Monday
const NEXT_DATE = "2026-08-11"; // the Tuesday after it
const RANGE = { from: DATE, to: DATE };
const TWO_DAY_RANGE = { from: DATE, to: NEXT_DATE };
/** The synthesized default working day: Mon-Fri 09:00-17:00. */
const WORKDAY_SECONDS = 8 * 3600;

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

/** A meeting of `minutes` on a chosen day, for the fill-block tests below —
 *  where what matters is which day the meeting lands on and how much of it it
 *  takes, not the hour it starts. */
const shortEventOn = (
	id: string,
	title: string,
	date: string,
	minutes: number,
): Event => ({
	id,
	title,
	start: `${date}T09:00:00.000Z`,
	end: `${date}T09:${String(minutes).padStart(2, "0")}:00.000Z`,
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

let harness: TestDb;
let devTaskId: string;
let fallbackProjectId: string;
let ruleProjectId: string;
let foreignProjectId: string;

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

	// What a fill block is filed against in production. Only its id is needed
	// here — `computeDayFillSeconds` never looks at the task — but seeding the
	// real one keeps the fixture readable as the row it stands in for.
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

	// For the fallback project group. A plain member, not an owner: an admin
	// short-circuits `canTrackOn`, which is one of the checks under test.
	await db.insert(member).values({
		id: "member-meeting-sync",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "member",
		createdAt: new Date(),
	});
	const [acme] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Client One" })
		.returning({ id: client.id });
	const projectIn = async (name: string, assigned: boolean) => {
		const [row] = await db
			.insert(project)
			.values({
				organizationId: ORG_ID,
				clientId: present(acme, "client").id,
				name,
			})
			.returning({ id: project.id });
		const id = present(row, name).id;
		if (assigned) {
			await db.insert(projectMember).values({
				organizationId: ORG_ID,
				projectId: id,
				userId: USER_ID,
				role: "member",
			});
		}
		return id;
	};
	fallbackProjectId = await projectIn("Project A", true);
	ruleProjectId = await projectIn("Project B", true);
	foreignProjectId = await projectIn("Project C", false);
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
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
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
			fakeCalendar([event("e1", "Standup", 1), event("e2", "Review", 2)]),
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
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		for (let i = 0; i < 4; i++) {
			await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		}
		expect(await meetingRows()).toHaveLength(1);
	});

	// Delete-by-absence: an event that disappears from the calendar retires its
	// sync-owned entry.
	test("an event removed from the calendar removes its entry", async () => {
		setCalendarSourceForTests(
			fakeCalendar([event("e1", "Standup", 1), event("e2", "Review", 2)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(2);

		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.calendarEventId).toBe("e1");
	});

	// An empty list is not proof of anything: Google returns one on a throttled
	// request or a partial scope. The engine used to skip deletion on an empty
	// list altogether, which also meant the ONE meeting in a quiet week could
	// never be removed once it moved. It now asks Google about each missing
	// event by id and acts only on a definite answer.
	test("an empty list deletes nothing while Google still lists the event", async () => {
		const standup = event("e1", "Standup", 1);
		setCalendarSourceForTests(fakeCalendar([standup]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);

		setCalendarSourceForTests(
			fakeCalendar([], { e1: { status: "found", event: standup } }),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);
	});

	test("an empty list deletes nothing when Google cannot be asked", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		setCalendarSourceForTests(
			fakeCalendar([], { e1: { status: "unreadable" } }),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);
	});

	test("an empty list DOES delete a meeting Google confirms is gone", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		setCalendarSourceForTests(fakeCalendar([]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(0);
	});

	// An unreadable calendar (disconnected / revoked token) must bail rather than
	// treat "no events" as "every meeting was cancelled".
	test("an unreadable calendar leaves existing entries alone", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);

		setCalendarSourceForTests(fakeCalendar(null));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect(await meetingRows()).toHaveLength(1);
	});

	test("a tombstoned meeting stays deleted across syncs", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
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
	// and following". The old id is then gone and a new one sits on the same day
	// with the same face; the existing row is re-linked to it rather than being
	// retired next to a fresh import, so nothing the person did to it is lost.
	test("a reissued event id re-links the existing row instead of duplicating it", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const [row] = await meetingRows();
		if (!row) throw new Error("expected a synced row");

		// Filing a meeting locks it against the sync engine.
		await db
			.update(timeEntry)
			.set({ syncLocked: true })
			.where(eq(timeEntry.id, row.id));

		// Same day, same title, same length — a new id for the same meeting.
		setCalendarSourceForTests(fakeCalendar([event("e2", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(row.id);
		expect(rows[0]?.calendarEventId).toBe("e2");
	});

	// The old guard matched on the face alone, so once one of two same-shaped
	// meetings was filed, the other could never import.
	test("two different meetings with the same title and length both import", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "1:1", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		const [row] = await meetingRows();
		if (!row) throw new Error("expected a synced row");
		await db
			.update(timeEntry)
			.set({ syncLocked: true })
			.where(eq(timeEntry.id, row.id));

		setCalendarSourceForTests(
			fakeCalendar([event("e1", "1:1", 1), event("e2", "1:1", 1)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await meetingRows()).toHaveLength(2);
	});
	// `snapToQuarterHour` floors at 900s by design, so snap(0) and snap(-3600)
	// are both 900. The engine filtered `durationSeconds > 0` AFTER snapping —
	// a condition that is therefore always true — so a zero-length calendar slot
	// became a 15-minute meeting on the timesheet. The day assembler had always
	// guarded on the raw duration; the engine that actually writes did not.
	test("a zero-length calendar event is not imported", async () => {
		setCalendarSourceForTests(
			fakeCalendar([degenerateEvent("z1", "Placeholder", 0)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await meetingRows()).toHaveLength(0);
	});

	test("an event that ends before it starts is not imported", async () => {
		setCalendarSourceForTests(
			fakeCalendar([
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
			fakeCalendar([degenerateEvent("s1", "Quick sync", 5)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.durationSeconds).toBe(900);
	});

	test("a zero-length event alongside a real one imports only the real one", async () => {
		setCalendarSourceForTests(
			fakeCalendar([
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

// The fill block on a day is sized as "the working day minus everything else on
// it", and it is stored, not derived — see lib/working-day and services/day-fill
// for why. Storing it means every engine that adds to a day has to say so, and
// this one did not: the commit engine writes its block once and guards the
// insert with onConflictDoNothing, and listRange's read-path recompute only
// reaches back AUTOMATION_GRACE_DAYS. So a meeting that arrived after the block
// was written stayed on top of it — an 8h block plus a 0:15 stand-up on an 8h
// day, reported and invoiced as 8:45.
describe("a synced meeting resizes the day's fill block", () => {
	const addFill = (date: string, durationSeconds: number) =>
		db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId: null,
			date,
			durationSeconds,
			description: "Rest of day",
			fillsDay: true,
		});

	const fillOn = async (date: string) => {
		const rows = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ORG_ID),
				eq(timeEntry.userId, USER_ID),
				eq(timeEntry.date, date),
				eq(timeEntry.fillsDay, true),
			),
		});
		return rows[0] ?? null;
	};

	test("importing a meeting shortens a block written before it", async () => {
		await addFill(DATE, WORKDAY_SECONDS);
		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("e1", "Standup", DATE, 15)]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect((await fillOn(DATE))?.durationSeconds).toBe(WORKDAY_SECONDS - 900);
	});

	test("deleting the meeting from the calendar gives the day its time back", async () => {
		await addFill(DATE, WORKDAY_SECONDS);
		// Two events, because delete-by-absence deliberately declines to act on an
		// empty live set — an empty page from Google must not wipe the day.
		setCalendarSourceForTests(
			fakeCalendar([
				shortEventOn("e1", "Standup", DATE, 15),
				shortEventOn("e2", "Review", DATE, 30),
			]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		expect((await fillOn(DATE))?.durationSeconds).toBe(WORKDAY_SECONDS - 2700);

		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("e1", "Standup", DATE, 15)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect((await fillOn(DATE))?.durationSeconds).toBe(WORKDAY_SECONDS - 900);
	});

	// The case the day a meeting LEAVES is invisible to: after the upsert every
	// date the engine still holds is the new one.
	test("moving a meeting to another day resizes both days", async () => {
		await addFill(DATE, WORKDAY_SECONDS);
		await addFill(NEXT_DATE, WORKDAY_SECONDS);

		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("e1", "Standup", DATE, 15)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, TWO_DAY_RANGE);
		expect((await fillOn(DATE))?.durationSeconds).toBe(WORKDAY_SECONDS - 900);
		expect((await fillOn(NEXT_DATE))?.durationSeconds).toBe(WORKDAY_SECONDS);

		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("e1", "Standup", NEXT_DATE, 15)]),
		);
		await timeEntriesService.syncMeetingsForUser(ctx, TWO_DAY_RANGE);

		expect((await fillOn(DATE))?.durationSeconds).toBe(WORKDAY_SECONDS);
		expect((await fillOn(NEXT_DATE))?.durationSeconds).toBe(
			WORKDAY_SECONDS - 900,
		);
	});

	test("a second sync over an unchanged calendar does not shorten it again", async () => {
		await addFill(DATE, WORKDAY_SECONDS);
		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("e1", "Standup", DATE, 15)]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect((await fillOn(DATE))?.durationSeconds).toBe(WORKDAY_SECONDS - 900);
	});

	// The rule day-fill states: a block squeezed to nothing describes nothing, so
	// it is deleted rather than parked at 0:00 next to the entries that filled the
	// day. Nothing about that changes because a meeting is what did the squeezing.
	test("a day filled entirely by meetings loses its block", async () => {
		await addFill(DATE, WORKDAY_SECONDS);
		setCalendarSourceForTests(
			fakeCalendar([event("e1", "All-day workshop", 8)]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await fillOn(DATE)).toBeNull();
	});

	test("a day with no block is left alone", async () => {
		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("e1", "Standup", DATE, 15)]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		expect(await fillOn(DATE)).toBeNull();
		expect(await meetingRows()).toHaveLength(1);
	});
});

// The window bounds what this engine may MOVE, not only what it may add. The
// upsert rewrote `date` on any sync-owned row whose event had moved, wherever
// that row sat — so a stand-up synced onto the 28th and then moved to the 2nd
// left a month already locked, and the fill recompute on the day it left grew
// that month's rest-of-day block back by its length.
describe("the meeting engine and the automation window", () => {
	const AUG_28 = "2026-08-28"; // a Friday, in a month locked through the 31st
	const SEP_02 = "2026-09-02"; // a Wednesday, and "today" for the pass below
	let meetingTaskId = "";

	const rowsOn = (date: string) =>
		db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ORG_ID),
				eq(timeEntry.userId, USER_ID),
				eq(timeEntry.date, date),
			),
		});

	beforeAll(async () => {
		const meeting = await db.query.task.findFirst({
			where: and(eq(task.scope, "site"), eq(task.systemKey, "meeting")),
			columns: { id: true },
		});
		meetingTaskId = present(meeting, "meeting task").id;
		// Switched on well before the lock, so the lock is the bound under test.
		await db.insert(integrationSettings).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			googleAutoSyncMeetings: true,
			googleAutoSyncMeetingsSince: new Date("2026-08-01T00:00:00.000Z"),
		});
		await db.insert(orgSettings).values({
			organizationId: ORG_ID,
			automationLockedThrough: "2026-08-31",
		});
	});

	afterAll(async () => {
		await db.delete(integrationSettings);
		await db.delete(orgSettings);
	});

	test("a meeting moved out of a locked month leaves that month alone", async () => {
		await db.insert(timeEntry).values([
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				taskId: meetingTaskId,
				projectId: null,
				date: AUG_28,
				description: "Standup",
				durationSeconds: 900,
				calendarEventId: "standup-0828",
			},
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				taskId: devTaskId,
				projectId: null,
				date: AUG_28,
				description: "Rest of day",
				durationSeconds: WORKDAY_SECONDS - 900,
				fillsDay: true,
			},
		]);
		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("standup-0828", "Standup", SEP_02, 15)]),
		);

		await timeEntriesService.runAutomationsForUser(ctx, {
			now: new Date(`${SEP_02}T10:00:00.000Z`),
		});

		const august = await rowsOn(AUG_28);
		expect(
			august.find((row) => row.calendarEventId === "standup-0828"),
		).toBeDefined();
		expect(august.find((row) => row.fillsDay)?.durationSeconds).toBe(
			WORKDAY_SECONDS - 900,
		);
	});

	// Google's `timeMin` matches on overlap, so an event that began the evening
	// before the window comes back too, dated by its start.
	test("an event dated before the window is not written", async () => {
		setCalendarSourceForTests(
			fakeCalendar([shortEventOn("eve", "Late call", DATE, 30)]),
		);

		await timeEntriesService.syncMeetingsForUser(ctx, {
			from: NEXT_DATE,
			to: NEXT_DATE,
		});

		expect(await meetingRows()).toHaveLength(0);
	});
});

// `update`, `file` and `updateDescription` all lock a calendar row when a person
// edits it. The week grid matched synced rows too and locked nothing, so the
// next sync set the cell straight back to the calendar's length.
describe("typing into a synced meeting's week cell", () => {
	test("takes the row out of the sync's hands", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);
		const [synced] = await meetingRows();

		await timeEntriesService.setWeekCell(ctx, {
			date: DATE,
			taskId: present(synced, "synced meeting").taskId,
			durationSeconds: 2 * 3600,
		});
		await timeEntriesService.syncMeetingsForUser(ctx, RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.durationSeconds).toBe(2 * 3600);
		expect(rows[0]?.syncLocked).toBe(true);
	});
});

// A meeting that no filing rule matches goes to the person's fallback project.
// The fallback is a preference, not a promise: like a rule, it is checked again
// at each pass and dropped silently when it no longer applies.
describe("the fallback project for a synced meeting", () => {
	const fresh = (): Ctx => ({ ...ctx });

	const setFallback = async (projectId: string | null) => {
		await db.delete(integrationSettings);
		await db.insert(integrationSettings).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			googleMeetingFallbackProjectId: projectId,
		});
	};

	const meetingTaskId = async () => {
		const row = await db.query.task.findFirst({
			where: and(eq(task.scope, "site"), eq(task.systemKey, "meeting")),
			columns: { id: true },
		});
		return present(row, "meeting task").id;
	};

	beforeEach(async () => {
		await db.delete(integrationSettings);
		await db.delete(filingRule);
		await db
			.update(project)
			.set({ status: "active" })
			.where(eq(project.organizationId, ORG_ID));
	});

	test("a meeting with no rule gets the fallback project and the Meeting task", async () => {
		await setFallback(fallbackProjectId);
		setCalendarSourceForTests(fakeCalendar([event("e1", "Ad hoc call", 1)]));
		await timeEntriesService.syncMeetingsForUser(fresh(), RANGE);

		const [row] = await meetingRows();
		expect(row?.projectId).toBe(fallbackProjectId);
		expect(row?.taskId).toBe(await meetingTaskId());
	});

	test("a matching rule wins over the fallback", async () => {
		await setFallback(fallbackProjectId);
		await db.insert(filingRule).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: await meetingTaskId(),
			titleKey: "standup",
			title: "Standup",
			projectId: ruleProjectId,
		});
		setCalendarSourceForTests(fakeCalendar([event("e1", "Standup", 1)]));
		await timeEntriesService.syncMeetingsForUser(fresh(), RANGE);

		expect((await meetingRows())[0]?.projectId).toBe(ruleProjectId);
	});

	test("an archived fallback project files nothing", async () => {
		await setFallback(fallbackProjectId);
		await db
			.update(project)
			.set({ status: "archived" })
			.where(eq(project.id, fallbackProjectId));
		setCalendarSourceForTests(fakeCalendar([event("e1", "Ad hoc call", 1)]));
		await timeEntriesService.syncMeetingsForUser(fresh(), RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.projectId).toBeNull();
	});

	test("a fallback project the person cannot track on files nothing", async () => {
		await setFallback(foreignProjectId);
		setCalendarSourceForTests(fakeCalendar([event("e1", "Ad hoc call", 1)]));
		await timeEntriesService.syncMeetingsForUser(fresh(), RANGE);

		expect((await meetingRows())[0]?.projectId).toBeNull();
	});

	test("an existing row is not filed when the fallback is set later", async () => {
		setCalendarSourceForTests(fakeCalendar([event("e1", "Ad hoc call", 1)]));
		await timeEntriesService.syncMeetingsForUser(fresh(), RANGE);
		await setFallback(fallbackProjectId);
		await timeEntriesService.syncMeetingsForUser(fresh(), RANGE);

		const rows = await meetingRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.projectId).toBeNull();
	});
});
