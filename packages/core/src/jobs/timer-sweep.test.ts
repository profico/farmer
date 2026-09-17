// A timer nobody stopped (issues #59 and #43).
//
// The objection this job answers is that people forget. What it must never do
// is answer it by inventing a number: a dropped timer logs nothing, and the row
// stays as a notice so the person is told where they work.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { runningTimer, timerSettings } from "../db/schema/timer";
import {
	type NotifyAdapter,
	type NotifyChannel,
	setNotifyAdaptersForTests,
} from "../services/notify";
import { createTestDb, present, type TestDb } from "../test/harness";
import { runTimerSweepOnce } from "./timer-sweep";

const ORG_ID = "org-sweep";
const USER_ID = "user-sweep";
const HOUR = 3600;
const START = new Date("2026-08-11T07:00:00.000Z");

let harness: TestDb;
let devTaskId = "";

const sent: { channel: NotifyChannel; text: string }[] = [];
const recorder =
	(channel: NotifyChannel): NotifyAdapter =>
	async (_to, event) => {
		sent.push({ channel, text: `${event.title ?? ""}|${event.body}` });
		return true;
	};

const later = (seconds: number) => new Date(START.getTime() + seconds * 1000);

const startTimer = () =>
	db.insert(runningTimer).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		taskId: devTaskId,
		description: "Forgotten",
		startedAt: START,
	});

const droppedAt = async () => {
	const row = await db.query.runningTimer.findFirst({
		where: eq(runningTimer.userId, USER_ID),
		columns: { droppedAt: true },
	});
	return present(row, "the timer row").droppedAt;
};

beforeAll(async () => {
	harness = await createTestDb();
	setNotifyAdaptersForTests({
		push: recorder("push"),
		slack: recorder("slack"),
	});

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Sweep Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "sweep@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-sweep",
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
			isAbsence: false,
		})
		.returning();
	devTaskId = present(dev, "development task").id;
});

afterAll(async () => {
	setNotifyAdaptersForTests();
	await harness.close();
});

beforeEach(async () => {
	await db.delete(runningTimer);
	await db.delete(timerSettings);
	await db.delete(timeEntry);
	sent.length = 0;
});

test("leaves a timer that is still under the limit", async () => {
	await startTimer();

	const summary = await runTimerSweepOnce({ now: later(11 * HOUR) });

	expect(summary).toMatchObject({ running: 1, dropped: 0, failed: 0 });
	expect(await droppedAt()).toBeNull();
});

test("drops one that passed twelve hours, and logs nothing", async () => {
	await startTimer();

	const summary = await runTimerSweepOnce({ now: later(13 * HOUR) });

	expect(summary).toMatchObject({ dropped: 1, failed: 0 });
	expect(await droppedAt()).not.toBeNull();
	// The whole point: a figure nobody chose is never written.
	expect(await db.select().from(timeEntry)).toHaveLength(0);
});

test("obeys the person's own limit", async () => {
	await db.insert(timerSettings).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		maxSeconds: 2 * HOUR,
	});
	await startTimer();

	await runTimerSweepOnce({ now: later(3 * HOUR) });

	expect(await droppedAt()).not.toBeNull();
});

test("tells the person when it started and what the limit was", async () => {
	await startTimer();

	await runTimerSweepOnce({ now: later(13 * HOUR) });

	// 07:00 UTC is 09:00 in Europe/Zagreb, the organization's own clock.
	expect(sent.map((s) => s.channel).sort()).toEqual(["push", "slack"]);
	expect(present(sent[0], "the first notification").text).toContain("09:00");
	expect(present(sent[0], "the first notification").text).toContain("12h");
});

test("a second pass finds nothing left to do", async () => {
	await startTimer();

	await runTimerSweepOnce({ now: later(13 * HOUR) });
	sent.length = 0;
	const again = await runTimerSweepOnce({ now: later(14 * HOUR) });

	expect(again).toMatchObject({ running: 0, dropped: 0 });
	expect(sent).toHaveLength(0);
});
