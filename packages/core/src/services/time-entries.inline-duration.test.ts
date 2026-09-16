// The row's inline duration box (issue #64) — `updateDuration`.
//
// It is a second door onto the one field a person corrects most often, so the
// question this file answers is which of `update`'s duties a narrow patch still
// owes the day. Two: the 24-hour ceiling, and the fill block, which is sized
// from what the rest of the day holds and is therefore wrong the moment any
// entry beside it changes length. A patch that skipped either would read as a
// working edit and leave the day's total wrong.

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
import { createTestDb, present, type TestDb } from "../test/harness";
import { DayCapacityError, timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-inline-duration";
const USER_ID = "user-inline-duration";
const OTHER_ID = "user-inline-duration-other";
const DAY = "2026-08-10"; // a Monday
const HOUR = 3600;
/** The synthesized default working day: Mon-Fri 09:00-17:00. */
const WORKDAY_SECONDS = 8 * HOUR;

/** Fresh per call: Access is memoized on the Ctx object. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

let harness: TestDb;
let projectId = "";
let devTaskId = "";

/** Straight into the table, so a fixture can build a day — or a fill block —
 *  that the service under test would not build for it. */
const addEntry = async (values: {
	userId?: string;
	durationSeconds: number;
	fillsDay?: boolean;
	calendarEventId?: string;
}) => {
	const [row] = await db
		.insert(timeEntry)
		.values({
			organizationId: ORG_ID,
			userId: values.userId ?? USER_ID,
			projectId: values.fillsDay ? null : projectId,
			taskId: devTaskId,
			date: DAY,
			description: "Work",
			durationSeconds: values.durationSeconds,
			fillsDay: values.fillsDay ?? false,
			calendarEventId: values.calendarEventId,
		})
		.returning();
	return present(row, "fixture entry");
};

const fillOf = async () => {
	const rows = await db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, DAY),
			eq(timeEntry.fillsDay, true),
		),
	});
	return rows[0] ?? null;
};

const reread = async (id: string) =>
	present(
		await db.query.timeEntry.findFirst({ where: eq(timeEntry.id, id) }),
		"entry",
	);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Inline Duration Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	for (const id of [USER_ID, OTHER_ID]) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `member-${id}`,
			organizationId: ORG_ID,
			userId: id,
			role: "member",
			createdAt: new Date(),
		});
	}

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

describe("editing an entry's length in place", () => {
	test("it writes the new length and leaves the rest alone", async () => {
		const entry = await addEntry({ durationSeconds: HOUR });

		await timeEntriesService.updateDuration(ctx(), {
			timeEntryId: entry.id,
			durationSeconds: 90 * 60,
		});

		const after = await reread(entry.id);
		expect(after.durationSeconds).toBe(90 * 60);
		// The point of the narrow patch: nothing the caller did not send moves,
		// so correcting an hour can never re-file an entry or shift its day.
		expect(after.projectId).toBe(entry.projectId);
		expect(after.taskId).toBe(entry.taskId);
		expect(after.date).toBe(entry.date);
		expect(after.description).toBe(entry.description);
	});

	test("growing an entry past the day's 24 hours is refused", async () => {
		await addEntry({ durationSeconds: 20 * HOUR });
		const short = await addEntry({ durationSeconds: HOUR });

		await expect(
			timeEntriesService.updateDuration(ctx(), {
				timeEntryId: short.id,
				durationSeconds: 5 * HOUR,
			}),
		).rejects.toBeInstanceOf(DayCapacityError);
		expect((await reread(short.id)).durationSeconds).toBe(HOUR);
	});

	test("somebody else's entry is not found", async () => {
		const theirs = await addEntry({
			userId: OTHER_ID,
			durationSeconds: HOUR,
		});

		await expect(
			timeEntriesService.updateDuration(ctx(), {
				timeEntryId: theirs.id,
				durationSeconds: 2 * HOUR,
			}),
		).rejects.toThrow("Time entry not found");
		expect((await reread(theirs.id)).durationSeconds).toBe(HOUR);
	});

	// Shortening a synced meeting by hand is the same act as renaming it: from
	// here on the person's figure wins, not Google's.
	test("re-lengthening a synced meeting takes it off the sync engine", async () => {
		const meeting = await addEntry({
			durationSeconds: HOUR,
			calendarEventId: "evt-1",
		});

		await timeEntriesService.updateDuration(ctx(), {
			timeEntryId: meeting.id,
			durationSeconds: 30 * 60,
		});

		expect((await reread(meeting.id)).syncLocked).toBe(true);
	});
});

describe("the day's fill block follows", () => {
	test("shrinking an entry gives the block the time back", async () => {
		const entry = await addEntry({ durationSeconds: 2 * HOUR });
		await addEntry({ durationSeconds: 6 * HOUR, fillsDay: true });

		await timeEntriesService.updateDuration(ctx(), {
			timeEntryId: entry.id,
			durationSeconds: HOUR,
		});

		expect((await fillOf())?.durationSeconds).toBe(WORKDAY_SECONDS - HOUR);
	});

	test("growing one takes it back off the block", async () => {
		const entry = await addEntry({ durationSeconds: 2 * HOUR });
		await addEntry({ durationSeconds: 6 * HOUR, fillsDay: true });

		await timeEntriesService.updateDuration(ctx(), {
			timeEntryId: entry.id,
			durationSeconds: 5 * HOUR,
		});

		expect((await fillOf())?.durationSeconds).toBe(3 * HOUR);
	});

	test("filling the working day drops the block entirely", async () => {
		const entry = await addEntry({ durationSeconds: 2 * HOUR });
		await addEntry({ durationSeconds: 6 * HOUR, fillsDay: true });

		await timeEntriesService.updateDuration(ctx(), {
			timeEntryId: entry.id,
			durationSeconds: WORKDAY_SECONDS,
		});

		expect(await fillOf()).toBeNull();
	});

	// The block's own length is derived, so a number typed at it would be
	// overwritten by the recompute on the same tick. Refused rather than
	// silently discarded — which is why the row renders it as a figure.
	test("the block itself cannot be re-lengthened here", async () => {
		const block = await addEntry({
			durationSeconds: WORKDAY_SECONDS,
			fillsDay: true,
		});

		await expect(
			timeEntriesService.updateDuration(ctx(), {
				timeEntryId: block.id,
				durationSeconds: 2 * HOUR,
			}),
		).rejects.toThrow("comes from the day's remaining hours");
		expect((await reread(block.id)).durationSeconds).toBe(WORKDAY_SECONDS);
	});
});
