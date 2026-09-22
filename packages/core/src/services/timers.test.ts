// The stopwatch: what it measures, what it refuses, and what confirming one
// writes (issues #59 and #43).
//
// The load-bearing claims here are the two that answer the objection on #59:
// a measured hour goes through every rule a typed one does, and nothing a rule
// refuses costs the person their measurement.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { runningTimer, timerSettings } from "../db/schema/timer";
import { createTestDb, present, type TestDb } from "../test/harness";
import { DEFAULT_TIMER_MAX_SECONDS, timersService } from "./timers.service";
import type { Ctx } from "./types";

const ORG_ID = "org-timer";
const OTHER_ORG_ID = "org-timer-other";
const USER_ID = "user-timer";
const HOUR = 3600;
// A Tuesday, 09:00 in Europe/Zagreb (UTC+2 in August).
const START = new Date("2026-08-11T07:00:00.000Z");
const DAY = "2026-08-11";

const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });
const otherCtx = (): Ctx => ({
	organizationId: OTHER_ORG_ID,
	userId: USER_ID,
});

let harness: TestDb;
let projectId = "";
let archivedProjectId = "";
let devTaskId = "";
let archivedTaskId = "";
let breakTaskId = "";
let vacationTaskId = "";

const later = (seconds: number) => new Date(START.getTime() + seconds * 1000);

const startDev = (now = START) =>
	timersService.start(
		ctx(),
		{ projectId, taskId: devTaskId, description: "Timed work" },
		{ now },
	);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{
			id: ORG_ID,
			name: "Timer Org",
			slug: ORG_ID,
			createdAt: new Date(),
			timezone: "Europe/Zagreb",
		},
		{
			id: OTHER_ORG_ID,
			name: "Second Org",
			slug: OTHER_ORG_ID,
			createdAt: new Date(),
			timezone: "Europe/Zagreb",
		},
	]);
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "timer@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values([
		{
			id: "member-timer",
			organizationId: ORG_ID,
			userId: USER_ID,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "member-timer-other",
			organizationId: OTHER_ORG_ID,
			userId: USER_ID,
			role: "owner",
			createdAt: new Date(),
		},
	]);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();
	const clientId = present(c, "client").id;

	const [p] = await db
		.insert(project)
		.values({ organizationId: ORG_ID, clientId, name: "Farmer" })
		.returning();
	projectId = present(p, "project").id;

	const [archived] = await db
		.insert(project)
		.values({
			organizationId: ORG_ID,
			clientId,
			name: "Last year",
			status: "archived",
		})
		.returning();
	archivedProjectId = present(archived, "archived project").id;

	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			isAbsence: false,
		})
		.returning();
	devTaskId = present(dev, "development task").id;

	const [gone] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Retired",
			isAbsence: false,
			archivedAt: new Date(),
		})
		.returning();
	archivedTaskId = present(gone, "archived task").id;

	// Absence tasks are site-scoped (`task_absence_is_site_scoped`), and the
	// harness does not run the task seed, so Vacation is inserted once here.
	const [vacation] = await db
		.insert(task)
		.values({
			scope: "site" as const,
			organizationId: null,
			name: "Vacation",
			isAbsence: true,
			systemKey: "vacation",
		})
		.returning();
	vacationTaskId = present(vacation, "vacation task").id;

	// Break is seeded by migration 0024 — looked up, never inserted again.
	const breakTask = await db.query.task.findFirst({
		where: eq(task.systemKey, "break"),
		columns: { id: true },
	});
	breakTaskId = present(breakTask, "the seeded Break task").id;
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(runningTimer);
	await db.delete(timerSettings);
	await db.delete(timeEntry);
});

describe("starting", () => {
	test("measures from the moment it started", async () => {
		await startDev();

		const view = present(
			await timersService.get(ctx(), { now: later(2 * HOUR) }),
			"the running timer",
		);
		expect(view.elapsedSeconds).toBe(2 * HOUR);
		expect(view.here).toBe(true);
		expect(view.droppedAt).toBeNull();
	});

	test("snaps to the nearest quarter hour, which is as often down as up", async () => {
		await startDev();

		// 2h12m rounds up to 2h15m; 50 minutes rounds DOWN to 45. The figure is
		// shown before it is saved, which is the whole reason a stopwatch may
		// round down at all.
		const snapped = async (seconds: number) =>
			present(await timersService.get(ctx(), { now: later(seconds) }), "timer")
				.snappedSeconds;

		expect(await snapped(2 * HOUR + 12 * 60)).toBe(2 * HOUR + 15 * 60);
		expect(await snapped(50 * 60)).toBe(45 * 60);
		// Never below one quarter hour: a two-minute timer still logs 15 minutes.
		expect(await snapped(120)).toBe(15 * 60);
	});

	test("refuses a second timer, naming the one that is running", async () => {
		await startDev();

		await expect(startDev(later(60))).rejects.toThrow(
			/already running on Development/,
		);
	});

	test("refuses a second timer from another workspace", async () => {
		await startDev();

		// One person, one clock. Keyed per workspace, these two would both tick
		// through the same hour and each could be logged.
		await expect(
			timersService.start(
				otherCtx(),
				{ taskId: devTaskId, description: "Elsewhere" },
				{ now: later(60) },
			),
		).rejects.toThrow(/already running in Timer Org/);
	});

	test("refuses time off", async () => {
		await expect(
			timersService.start(ctx(), { taskId: vacationTaskId }, { now: START }),
		).rejects.toThrow(/booked as a span/);
	});

	test("refuses an archived task", async () => {
		await expect(
			timersService.start(
				ctx(),
				{ projectId, taskId: archivedTaskId },
				{ now: START },
			),
		).rejects.toThrow(/Task not available/);
	});

	test("a timer needs no project", async () => {
		const view = await timersService.start(
			ctx(),
			{ taskId: devTaskId, description: "Something" },
			{ now: START },
		);

		expect(view.projectId).toBeNull();
	});
});

describe("reading from another workspace", () => {
	test("says where the timer is running rather than nothing", async () => {
		await startDev();

		const view = present(
			await timersService.get(otherCtx(), { now: later(HOUR) }),
			"the timer, seen from the second workspace",
		);
		expect(view.here).toBe(false);
		expect(view.organizationName).toBe("Timer Org");
	});

	test("refuses to be confirmed from there", async () => {
		await startDev();

		await expect(
			timersService.confirm(otherCtx(), {
				date: DAY,
				taskId: devTaskId,
				description: "Timed work",
				durationSeconds: HOUR,
				overtime: false,
			}),
		).rejects.toThrow(/belongs to Timer Org/);
	});
});

describe("confirming", () => {
	const confirm = (
		over: Partial<Parameters<typeof timersService.confirm>[1]> = {},
	) =>
		timersService.confirm(ctx(), {
			date: DAY,
			projectId,
			taskId: devTaskId,
			description: "Timed work",
			durationSeconds: 2 * HOUR + 15 * 60,
			overtime: false,
			...over,
		});

	test("writes one entry and clears the timer", async () => {
		await startDev();

		const entry = await confirm();

		expect(entry.durationSeconds).toBe(2 * HOUR + 15 * 60);
		expect(entry.date).toBe(DAY);
		expect(await timersService.get(ctx(), { now: later(HOUR) })).toBeNull();

		const rows = await db.select().from(timeEntry);
		expect(rows).toHaveLength(1);
	});

	test("keeps the timer when the day cannot hold the entry", async () => {
		await startDev();
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			projectId,
			taskId: devTaskId,
			date: DAY,
			description: "A full day already",
			durationSeconds: 23 * HOUR,
		});

		await expect(confirm()).rejects.toThrow(/more than 24 hours/);

		// The measurement survives the refusal: the person changes the figure or
		// the day and confirms again.
		expect(
			present(await timersService.get(ctx(), { now: later(HOUR) }), "timer").id,
		).toBeTruthy();
	});

	test("keeps the timer when the task now demands a note nobody wrote", async () => {
		await startDev();

		await expect(confirm({ description: "" })).rejects.toThrow(
			/Describe what you worked on/,
		);
		expect(await timersService.get(ctx(), { now: later(HOUR) })).not.toBeNull();
	});

	test("keeps the timer when the task was archived while it ran", async () => {
		await startDev();

		await expect(confirm({ taskId: archivedTaskId })).rejects.toThrow(
			/Task not available/,
		);
		expect(await timersService.get(ctx(), { now: later(HOUR) })).not.toBeNull();
	});

	test("refuses a project archived while it ran", async () => {
		await startDev();

		await expect(confirm({ projectId: archivedProjectId })).rejects.toThrow(
			/archived/,
		);
		expect(await timersService.get(ctx(), { now: later(HOUR) })).not.toBeNull();
	});

	test("a Break needs no note", async () => {
		await timersService.start(ctx(), { taskId: breakTaskId }, { now: START });

		const entry = await confirm({
			projectId: undefined,
			taskId: breakTaskId,
			description: "",
			durationSeconds: 30 * 60,
		});
		expect(entry.durationSeconds).toBe(30 * 60);
	});

	test("refuses a duration that is not a quarter hour", async () => {
		await startDev();

		// The service takes a parsed input, so this is the DB's own rule standing
		// behind the schema's. Either way, no stopwatch writes 2:12.
		await expect(
			confirm({ durationSeconds: 2 * HOUR + 12 * 60 }),
		).rejects.toThrow(/Failed query: insert into "time_entry"/);
	});
});

describe("pausing", () => {
	// The claim the whole feature rests on: a held clock measures nothing, for
	// as long as it is held.
	test("holds the figure for as long as the pause lasts", async () => {
		await startDev();

		const held = await timersService.pause(ctx(), { now: later(2 * HOUR) });
		expect(held.paused).toBe(true);
		expect(held.elapsedSeconds).toBe(2 * HOUR);

		const days = await timersService.get(ctx(), { now: later(48 * HOUR) });
		expect(present(days, "the held timer").elapsedSeconds).toBe(2 * HOUR);
	});

	test("counts the segments it ran and none of the pauses", async () => {
		await startDev();
		await timersService.pause(ctx(), { now: later(HOUR) });
		await timersService.resume(ctx(), { now: later(5 * HOUR) });

		const view = present(
			await timersService.get(ctx(), { now: later(6 * HOUR) }),
			"the resumed timer",
		);
		expect(view.paused).toBe(false);
		expect(view.elapsedSeconds).toBe(2 * HOUR);
	});

	// The day the entry lands on is the day the work began, so a pause must not
	// move it — not even one held over a night.
	test("never moves the instant the timer started", async () => {
		await startDev();
		await timersService.pause(ctx(), { now: later(HOUR) });
		const resumed = await timersService.resume(ctx(), {
			now: later(20 * HOUR),
		});

		expect(resumed.startedAt).toEqual(START);
	});

	// Two surfaces drive one clock. A phone that pauses a second after a laptop
	// did must not be shown an error about it.
	test("pausing twice and resuming twice change nothing", async () => {
		await startDev();
		await timersService.pause(ctx(), { now: later(HOUR) });
		const again = await timersService.pause(ctx(), { now: later(2 * HOUR) });
		expect(again.elapsedSeconds).toBe(HOUR);

		await timersService.resume(ctx(), { now: later(3 * HOUR) });
		const still = await timersService.resume(ctx(), { now: later(4 * HOUR) });
		expect(still.elapsedSeconds).toBe(2 * HOUR);
	});

	test("logs what the running segments came to", async () => {
		await startDev();
		await timersService.pause(ctx(), { now: later(HOUR) });
		const held = present(
			await timersService.get(ctx(), { now: later(9 * HOUR) }),
			"the held timer",
		);

		const entry = await timersService.confirm(ctx(), {
			date: DAY,
			projectId,
			taskId: devTaskId,
			description: "Timed work",
			durationSeconds: held.snappedSeconds,
			overtime: false,
		});

		expect(entry.durationSeconds).toBe(HOUR);
		expect(await timersService.get(ctx(), { now: later(9 * HOUR) })).toBeNull();
	});

	test("refuses to pause a timer that belongs to another workspace", async () => {
		await startDev();

		await expect(timersService.pause(otherCtx())).rejects.toThrow(
			/belongs to Timer Org/,
		);
	});

	test("refuses to pause when nothing is running", async () => {
		await expect(timersService.pause(ctx())).rejects.toThrow(
			/No timer is running/,
		);
	});
});

describe("discarding", () => {
	test("throws the measurement away", async () => {
		await startDev();

		await timersService.discard(ctx());

		expect(await timersService.get(ctx(), { now: later(HOUR) })).toBeNull();
	});
});

describe("the cap", () => {
	test("is twelve hours until the person says otherwise", async () => {
		expect(await timersService.settings(ctx())).toEqual({
			maxSeconds: DEFAULT_TIMER_MAX_SECONDS,
		});
	});

	test("is remembered per person and workspace", async () => {
		await timersService.setSettings(ctx(), { maxSeconds: 4 * HOUR });

		expect(await timersService.settings(ctx())).toEqual({
			maxSeconds: 4 * HOUR,
		});
		expect(await timersService.settings(otherCtx())).toEqual({
			maxSeconds: DEFAULT_TIMER_MAX_SECONDS,
		});
	});

	test("takes the newer value", async () => {
		await timersService.setSettings(ctx(), { maxSeconds: 4 * HOUR });
		await timersService.setSettings(ctx(), { maxSeconds: 6 * HOUR });

		expect(await timersService.settings(ctx())).toEqual({
			maxSeconds: 6 * HOUR,
		});
	});
});

describe("a head start (issue #107)", () => {
	test("counts the time given as measured, and began that long ago", async () => {
		await timersService.start(
			ctx(),
			{ projectId, taskId: devTaskId, headStartSeconds: 30 * 60 },
			{ now: START },
		);

		const view = present(
			await timersService.get(ctx(), { now: later(HOUR) }),
			"the running timer",
		);
		expect(view.elapsedSeconds).toBe(HOUR + 30 * 60);
		expect(view.startedAt).toEqual(later(-30 * 60));
	});

	test("survives a pause", async () => {
		await timersService.start(
			ctx(),
			{ projectId, taskId: devTaskId, headStartSeconds: 30 * 60 },
			{ now: START },
		);
		await timersService.pause(ctx(), { now: later(HOUR) });

		const view = present(
			await timersService.get(ctx(), { now: later(5 * HOUR) }),
			"the held timer",
		);
		expect(view.elapsedSeconds).toBe(HOUR + 30 * 60);
	});

	// The sweep drops a timer past the cap. A head start at or over it would
	// be dropped on the next pass, which is a refusal the person never sees.
	test("must leave room under the cap", async () => {
		await timersService.setSettings(ctx(), { maxSeconds: 2 * HOUR });

		await expect(
			timersService.start(
				ctx(),
				{ projectId, taskId: devTaskId, headStartSeconds: 2 * HOUR },
				{ now: START },
			),
		).rejects.toThrow(/shorter than your timer limit/);
		expect(await timersService.get(ctx(), { now: START })).toBeNull();
	});
});

describe("continuing an entry (issue #107)", () => {
	const insertEntry = async (
		over: Partial<typeof timeEntry.$inferInsert> = {},
	) => {
		const [row] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: USER_ID,
				date: "2026-08-10",
				projectId,
				taskId: devTaskId,
				description: "Yesterday's work",
				durationSeconds: HOUR,
				...over,
			})
			.returning();
		return present(row, "the entry to continue");
	};

	test("takes the entry's project, task and note, and counts its hours", async () => {
		const entry = await insertEntry();

		await timersService.start(ctx(), { timeEntryId: entry.id }, { now: START });

		const view = present(
			await timersService.get(ctx(), { now: later(40 * 60) }),
			"the running timer",
		);
		expect(view.timeEntryId).toBe(entry.id);
		expect(view.entryDate).toBe("2026-08-10");
		expect(view.projectId).toBe(projectId);
		expect(view.taskId).toBe(devTaskId);
		expect(view.description).toBe("Yesterday's work");
		expect(view.elapsedSeconds).toBe(HOUR + 40 * 60);
		expect(view.snappedSeconds).toBe(HOUR + 45 * 60);
	});

	test("confirming rewrites the entry instead of writing another", async () => {
		const entry = await insertEntry({ overtime: true });
		await timersService.start(ctx(), { timeEntryId: entry.id }, { now: START });

		const saved = await timersService.confirm(ctx(), {
			date: "2026-08-10",
			projectId,
			taskId: devTaskId,
			description: "Yesterday's work, finished",
			durationSeconds: HOUR + 45 * 60,
			overtime: false,
		});

		expect(saved.id).toBe(entry.id);
		const rows = await db.select().from(timeEntry);
		expect(rows).toHaveLength(1);
		const row = present(rows[0], "the continued entry");
		expect(row.durationSeconds).toBe(HOUR + 45 * 60);
		expect(row.description).toBe("Yesterday's work, finished");
		// No surface that confirms a timer shows the mark, so it is kept.
		expect(row.overtime).toBe(true);
		expect(await timersService.get(ctx(), { now: later(HOUR) })).toBeNull();
	});

	test("a pause banks only what the clock measured", async () => {
		const entry = await insertEntry();
		await timersService.start(ctx(), { timeEntryId: entry.id }, { now: START });
		await timersService.pause(ctx(), { now: later(30 * 60) });
		await timersService.resume(ctx(), { now: later(HOUR) });

		const view = present(
			await timersService.get(ctx(), { now: later(HOUR + 15 * 60) }),
			"the resumed timer",
		);
		expect(view.elapsedSeconds).toBe(HOUR + 45 * 60);
	});

	test("follows an edit made to the entry while the clock runs", async () => {
		const entry = await insertEntry();
		await timersService.start(ctx(), { timeEntryId: entry.id }, { now: START });
		await db
			.update(timeEntry)
			.set({ durationSeconds: 2 * HOUR })
			.where(eq(timeEntry.id, entry.id));

		const view = present(
			await timersService.get(ctx(), { now: later(15 * 60) }),
			"the running timer",
		);
		expect(view.elapsedSeconds).toBe(2 * HOUR + 15 * 60);
	});

	test("an entry deleted while the clock ran becomes a new one", async () => {
		const entry = await insertEntry();
		await timersService.start(ctx(), { timeEntryId: entry.id }, { now: START });
		await db.delete(timeEntry).where(eq(timeEntry.id, entry.id));

		const view = present(
			await timersService.get(ctx(), { now: later(30 * 60) }),
			"the running timer",
		);
		expect(view.timeEntryId).toBeNull();
		expect(view.elapsedSeconds).toBe(30 * 60);

		const saved = await timersService.confirm(ctx(), {
			date: DAY,
			projectId,
			taskId: devTaskId,
			description: "Yesterday's work",
			durationSeconds: 30 * 60,
			overtime: false,
		});
		expect(saved.id).not.toBe(entry.id);
	});

	test("refuses a work-time block", async () => {
		const entry = await insertEntry({ fillsDay: true });

		await expect(
			timersService.start(ctx(), { timeEntryId: entry.id }, { now: START }),
		).rejects.toThrow(/cannot continue it/);
	});

	test("refuses time off", async () => {
		const entry = await insertEntry({
			projectId: null,
			taskId: vacationTaskId,
			description: "",
		});

		await expect(
			timersService.start(ctx(), { timeEntryId: entry.id }, { now: START }),
		).rejects.toThrow(/Time off/);
	});

	test("refuses an entry in another workspace", async () => {
		const entry = await insertEntry();

		await expect(
			timersService.start(
				otherCtx(),
				{ timeEntryId: entry.id },
				{ now: START },
			),
		).rejects.toThrow(/not found/);
	});
});
