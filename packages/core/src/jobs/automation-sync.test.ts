// Who the automation sweep picks up.
//
// The engines themselves are asserted elsewhere (meeting-sync.test.ts,
// recurring-block-rules.test.ts, services/automation-since.test.ts). What is
// only testable here is the target query — the thing that decides whose
// automations run at all when nobody is looking, which is the whole point of
// moving this off the read path. Two ways to get it wrong:
//
//   - Miss people. The sweep used to select on the Google switch alone, because
//     it only ever ran the meeting sync. Somebody whose only automation is a
//     daily break qualifies through a table that query never touched, and would
//     silently never be swept.
//   - Include people who left. A settings row or a recurring rule outlives the
//     membership it was made under, so an unjoined query keeps filing entries
//     into an org somebody was removed from.

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
import { dayKeyInTz } from "../lib/time";
import { createTestDb, type TestDb } from "../test/harness";
import { runAutomationSyncOnce } from "./automation-sync";

const ORG_ID = "org-sweep";
const TZ = "Europe/Zagreb";
/** Someone whose only automation is a recurring block — no integration switches. */
const BLOCKS_ONLY = "user-blocks-only";
/** Someone with the same rule who has since been removed from the org. */
const EX_MEMBER = "user-ex-member";

let harness: TestDb;
let breakTaskId: string;

const entriesFor = (userId: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, userId),
		),
	});

/** A rule that applies every day of the week, so "did the sweep reach this
 *  person?" never depends on which weekday the suite runs on. */
const dailyBlockFor = (userId: string) =>
	db.insert(recurringBlockRule).values({
		organizationId: ORG_ID,
		userId,
		taskId: breakTaskId,
		description: "Break",
		daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
		durationSeconds: 30 * 60,
		active: true,
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Sweep Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: TZ,
	});
	for (const id of [BLOCKS_ONLY, EX_MEMBER]) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}
	// Only one of them is still a member. The other's rule is left behind exactly
	// as removal leaves it.
	await db.insert(member).values({
		id: "member-blocks-only",
		organizationId: ORG_ID,
		userId: BLOCKS_ONLY,
		role: "member",
		createdAt: new Date(),
	});

	// Break is a site-wide built-in the migrations already seed — inserting a
	// second one trips task_site_name_uidx.
	const breakTask = await db.query.task.findFirst({
		where: eq(task.systemKey, "break"),
		columns: { id: true },
	});
	breakTaskId = breakTask?.id ?? "";
	expect(breakTaskId).not.toBe("");

	for (const userId of [BLOCKS_ONLY, EX_MEMBER]) {
		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			await db.insert(memberWorkingHoursDay).values({
				organizationId: ORG_ID,
				userId,
				dayOfWeek,
				enabled: true,
				startTime: "09:00",
				endTime: "17:00",
			});
		}
	}
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(recurringBlockRule);
});

describe("the automation sweep", () => {
	test("reaches someone whose only automation is a recurring block", async () => {
		await dailyBlockFor(BLOCKS_ONLY);

		const summary = await runAutomationSyncOnce();

		expect(summary.eligible).toBe(1);
		expect(summary.failed).toBe(0);

		// Today in the ORG's timezone — the sweep's day boundary is the org's
		// midnight, not the server's.
		const today = dayKeyInTz(new Date(), TZ);
		const entries = await entriesFor(BLOCKS_ONLY);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.date).toBe(today);
	});

	test("leaves an ex-member's orphaned rule alone", async () => {
		await dailyBlockFor(EX_MEMBER);

		const summary = await runAutomationSyncOnce();

		expect(summary.eligible).toBe(0);
		expect(await entriesFor(EX_MEMBER)).toHaveLength(0);
	});

	test("counts a person once however many rules they hold", async () => {
		await dailyBlockFor(BLOCKS_ONLY);
		await dailyBlockFor(BLOCKS_ONLY);

		// The sweep is per person, not per qualifying row; two rules must not mean
		// two passes over the same day.
		expect((await runAutomationSyncOnce()).eligible).toBe(1);
	});

	test("does nothing at all when nobody has an automation on", async () => {
		expect(await runAutomationSyncOnce()).toEqual({
			eligible: 0,
			synced: 0,
			failed: 0,
		});
	});
});
