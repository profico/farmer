// "Automation should only touch the day it is actually about."
//
// Three engines write entries nobody typed: the recurring block materializer
// (asserted in recurring-block-rules.test.ts), the calendar meeting sync, and
// the commit work-time blocks. They used to run over whatever range was being
// READ, so scrolling the time page back through a few months filed entries
// across already-closed timesheets — while the meeting sync separately reached
// fourteen days FORWARD, onto days nobody had lived yet.
//
// Two things fix it, and this file pins both:
//
//   1. The `*_since` stamps: turning a switch on records when, so a calendar
//      full of last year's meetings doesn't land the moment somebody ticks the
//      box. Asserted in the first describe below.
//   2. `lib/automation-window`: one window for all three engines, ending at
//      today in the ORG timezone and reaching back only a short grace period.
//      The stamps alone were not enough — a stamp is a floor, not a window, so
//      the longer a switch had been on the wider the past got.
//
// And the reads themselves no longer sync at all: the engines are scheduled
// jobs now (jobs/automation-sync.ts), driven per (org, user).

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
import { projectGithubRepo } from "../db/schema/github";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { integrationSettings, orgSettings } from "../db/schema/settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { integrationSettingsService } from "./integration-settings.service";
import { setCalendarSourceForTests, setCommitSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-since";
const USER_ID = "user-since";
const MONDAY = "2026-08-10";
const TUESDAY = "2026-08-11";
const WEDNESDAY = "2026-08-12";
const THURSDAY = "2026-08-13";
// A Wednesday, comfortably outside any grace window from the fixture week.
const LAST_MONTH = "2026-07-15";

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

/** Run the whole automation pass with "today" pinned to a fixture day, so the
 *  window under test never depends on when the suite happens to run. */
const runAutomationsOn = (dayKey: string) =>
	timeEntriesService.runAutomationsForUser(ctx, {
		// Midday, so the org's Europe/Zagreb offset can't push the day key over a
		// boundary either way.
		now: new Date(`${dayKey}T12:00:00.000Z`),
	});

let harness: TestDb;
let devTaskId: string;
let projectId: string;
let repoId: string;

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

/** Stamp a switch as having been turned on at the start of `dateKey`, which is
 *  what the service does on the off->on transition. */
const switchedOnAt = async (
	column: "googleAutoSyncMeetingsSince" | "githubSyncCommitsAsWorkTimeSince",
	dateKey: string,
) => {
	await db
		.update(integrationSettings)
		.set({ [column]: new Date(`${dateKey}T00:00:00.000Z`) })
		.where(
			and(
				eq(integrationSettings.organizationId, ORG_ID),
				eq(integrationSettings.userId, USER_ID),
			),
		);
};

/** A calendar that filters by the range it is handed, the way the real Google
 *  adapter does — otherwise a clamped range would prove nothing here. */
const calendarWithMeetingsOn = (dates: string[]) => ({
	listEventsForRange: async (_ctx: Ctx, range: { from: string; to: string }) =>
		dates
			.filter((d) => d >= range.from && d <= range.to)
			.map((d) => ({
				id: `event-${d}`,
				title: "Standup",
				start: `${d}T09:00:00.000Z`,
				end: `${d}T10:00:00.000Z`,
				meetingUrl: null,
				htmlLink: null,
			})),
	listEventsForDay: async () => [],
});

/** Likewise for commits: the GitHub adapter is asked for a range and answers
 *  within it. */
const commitsOn = (dates: string[]) => ({
	listUserCommitsForDay: async () => [],
	listUserCommitsByDay: async (
		_ctx: Ctx,
		range: { from: string; to: string },
	) =>
		dates
			.filter((d) => d >= range.from && d <= range.to)
			.map((d) => ({
				dayKey: d,
				commits: [
					{
						projectGithubRepoId: repoId,
						projectId,
						sha: `sha-${d}`,
						message: "Fix the thing",
						authorLogin: "tester",
						committedAt: new Date(`${d}T12:00:00.000Z`),
						url: `https://example.com/${d}`,
					},
				],
			})),
});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Since Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "since@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-since",
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
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Farmer" })
		.returning();
	projectId = p?.id ?? "";
	// A real repo row, so the commits the engine attaches satisfy their foreign
	// key the way production commits do.
	const [repo] = await db
		.insert(projectGithubRepo)
		.values({
			organizationId: ORG_ID,
			projectId,
			githubRepoId: 1,
			owner: "profico",
			name: "farmer",
			fullName: "profico/farmer",
		})
		.returning({ id: projectGithubRepo.id });
	repoId = repo?.id ?? "";

	// The commit engine resolves its task by system key; "development" is
	// org-scoped and renameable, unlike the site built-ins.
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
	setCalendarSourceForTests(null);
	setCommitSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(integrationSettings);
	await db.delete(orgSettings);
});

describe("recording when a switch was flipped", () => {
	test("turning one on stamps the moment", async () => {
		const before = new Date();
		const settings = await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});

		expect(
			present(
				settings.googleAutoSyncMeetingsSince,
				"the meeting-sync stamp",
			).getTime(),
		).toBeGreaterThanOrEqual(before.getTime() - 1000);
		// The other switch was not touched, so it has no stamp.
		expect(settings.githubSyncCommitsAsWorkTimeSince).toBeNull();
	});

	test("turning it off clears the stamp", async () => {
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		const off = await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: false,
		});

		expect(off.googleAutoSyncMeetingsSince).toBeNull();
	});

	test("switching off and on again moves the floor forward", async () => {
		const first = await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: false,
		});
		const second = await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});

		// Not reopening everything since the first time it was ever on — which is
		// the whole point of clearing the stamp on the way down.
		expect(
			present(
				second.githubSyncCommitsAsWorkTimeSince,
				"the second commit-sync stamp",
			).getTime(),
		).toBeGreaterThanOrEqual(
			present(
				first.githubSyncCommitsAsWorkTimeSince,
				"the first commit-sync stamp",
			).getTime(),
		);
	});

	test("re-saving a switch that is already on does not move its floor", async () => {
		const first = await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		const again = await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
			githubAutoLoadCommits: true,
		});

		// A stamp that moved on every save would creep forward each time the page
		// was saved, quietly narrowing the window.
		expect(again.googleAutoSyncMeetingsSince).toEqual(
			first.googleAutoSyncMeetingsSince,
		);
	});
});

describe("the meeting sync", () => {
	test("leaves days before the switch was turned on alone", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([MONDAY, WEDNESDAY]));
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		await switchedOnAt("googleAutoSyncMeetingsSince", TUESDAY);

		await runAutomationsOn(WEDNESDAY);

		// Monday predates the switch: a calendar full of last year's meetings does
		// not land on the day someone first ticks the box.
		expect(await entriesOn(MONDAY)).toHaveLength(0);
		expect(await entriesOn(WEDNESDAY)).toHaveLength(1);
	});

	test("with no recorded start, the grace window still applies", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([MONDAY, LAST_MONTH]));
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		// Rows written before the column existed are grandfathered rather than
		// silently switched off; the migration backfills them from created_at.
		await db
			.update(integrationSettings)
			.set({ googleAutoSyncMeetingsSince: null })
			.where(eq(integrationSettings.organizationId, ORG_ID));

		await runAutomationsOn(WEDNESDAY);

		// Grandfathered is not the same as unbounded: two days back is inside the
		// window, last month never is.
		expect(await entriesOn(MONDAY)).toHaveLength(1);
		expect(await entriesOn(LAST_MONTH)).toHaveLength(0);
	});

	test("a meeting on a future day is not written", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([WEDNESDAY, THURSDAY]));
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		await switchedOnAt("googleAutoSyncMeetingsSince", MONDAY);

		await runAutomationsOn(WEDNESDAY);

		// The sync used to reach fourteen days forward, filing rows onto days
		// nobody had lived yet — they counted in reports and in the unfiled banner,
		// and got rewritten under the person whenever the calendar moved.
		expect(await entriesOn(WEDNESDAY)).toHaveLength(1);
		expect(await entriesOn(THURSDAY)).toHaveLength(0);
	});
});

// This engine's window is one day narrower than the other two at the top end:
// it may only write to days that are OVER. Every assertion below therefore
// anchors on TUESDAY (yesterday) rather than WEDNESDAY (today), and the last
// test is the reason why.
describe("commit work-time blocks", () => {
	test("commits from before the switch do not become blocks", async () => {
		setCommitSourceForTests(commitsOn([MONDAY, TUESDAY]));
		await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await switchedOnAt("githubSyncCommitsAsWorkTimeSince", TUESDAY);

		await runAutomationsOn(WEDNESDAY);

		// The engine had no window at all before this: paging back a month filed a
		// "rest of day" block onto every past day with a commit on it.
		expect(await entriesOn(MONDAY)).toHaveLength(0);
		const tuesday = await entriesOn(TUESDAY);
		expect(tuesday).toHaveLength(1);
		expect(tuesday[0]?.fillsDay).toBe(true);
		expect(tuesday[0]?.taskId).toBe(devTaskId);
	});

	test("a switch flipped long ago does not reopen the past", async () => {
		setCommitSourceForTests(commitsOn([LAST_MONTH, TUESDAY]));
		await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await switchedOnAt("githubSyncCommitsAsWorkTimeSince", LAST_MONTH);

		await runAutomationsOn(WEDNESDAY);

		// This is the leak the `since` stamp could not close on its own: it is a
		// floor, not a window, so the longer a switch had been on the further back
		// the engine wrote. A month-old switch is not permission to file a month.
		expect(await entriesOn(LAST_MONTH)).toHaveLength(0);
		expect(await entriesOn(TUESDAY)).toHaveLength(1);
	});

	test("today gets no block, because the day is not over yet", async () => {
		setCommitSourceForTests(commitsOn([WEDNESDAY]));
		await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await switchedOnAt("githubSyncCommitsAsWorkTimeSince", MONDAY);

		await runAutomationsOn(WEDNESDAY);

		// The block claims "the rest of the working day" and is sized from the
		// day's WHOLE target — a number that is only true once the day has been
		// worked. Run against today, the 09:15 commit that wakes the engine
		// produced a 7.5-hour block at 09:20, and since it guards on
		// te_fill_day_uidx with onConflictDoNothing no later tick ever corrected
		// it. It only looked survivable while this ran on page load, because you
		// had to open the app for it to happen at all.
		//
		// Today is not lost, only un-automated: Assemble my day proposes the same
		// fill on demand, which is a person asking rather than a timer deciding.
		expect(await entriesOn(WEDNESDAY)).toHaveLength(0);
	});

	test("the meeting engine still writes to today", async () => {
		// The ceiling is this engine's alone. A meeting contributes its own length,
		// which is known as soon as the event is — so holding it back until
		// tomorrow would be a regression, not a symmetry.
		setCalendarSourceForTests(calendarWithMeetingsOn([WEDNESDAY]));
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		await switchedOnAt("googleAutoSyncMeetingsSince", MONDAY);

		await runAutomationsOn(WEDNESDAY);

		expect(await entriesOn(WEDNESDAY)).toHaveLength(1);
	});
});

describe("the org automation lock", () => {
	/** Lock everything up to and including `dayKey`. */
	const lockThrough = (dayKey: string | null) =>
		db
			.insert(orgSettings)
			.values({
				organizationId: ORG_ID,
				automationLockedThrough: dayKey,
			})
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: { automationLockedThrough: dayKey },
			});

	/** Both switches on and stamped as having been on since `dayKey`, so the
	 *  `since` floor is never the one under test here — the lock is. */
	const switchesOnSince = async (dayKey: string) => {
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
			githubSyncCommitsAsWorkTime: true,
		});
		await switchedOnAt("googleAutoSyncMeetingsSince", dayKey);
		await switchedOnAt("githubSyncCommitsAsWorkTimeSince", dayKey);
	};

	test("a locked day is left alone even inside the grace window", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([TUESDAY, WEDNESDAY]));
		setCommitSourceForTests(commitsOn([TUESDAY, WEDNESDAY]));
		await switchesOnSince(MONDAY);
		await lockThrough(TUESDAY);

		await runAutomationsOn(WEDNESDAY);

		// Tuesday is one day back — comfortably inside the three-day grace window,
		// and reachable by every engine — but the books are closed through it.
		expect(await entriesOn(TUESDAY)).toHaveLength(0);
		expect((await entriesOn(WEDNESDAY)).length).toBeGreaterThan(0);
	});

	test("holds the line across a month boundary", async () => {
		// The case grace alone cannot cover: on the 1st, "today - 3" reaches into
		// the month that was just reconciled and invoiced. It happens every month.
		const AUG_31 = "2026-08-31";
		const SEP_01 = "2026-09-01";
		setCalendarSourceForTests(calendarWithMeetingsOn([AUG_31, SEP_01]));
		await switchesOnSince(MONDAY);
		await lockThrough(AUG_31);

		await runAutomationsOn(SEP_01);

		expect(await entriesOn(AUG_31)).toHaveLength(0);
		expect(await entriesOn(SEP_01)).toHaveLength(1);
	});

	test("a lock covering today stops every engine", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([WEDNESDAY]));
		setCommitSourceForTests(commitsOn([WEDNESDAY]));
		await switchesOnSince(MONDAY);
		await lockThrough(WEDNESDAY);

		const result = await runAutomationsOn(WEDNESDAY);

		expect(await entriesOn(WEDNESDAY)).toHaveLength(0);
		// Skipped, not failed: there is nothing wrong, there is simply nothing the
		// engines are allowed to do.
		expect(result.failed).toEqual([]);
	});

	test("no lock means the grace window applies as before", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([TUESDAY]));
		await switchesOnSince(MONDAY);
		await lockThrough(null);

		await runAutomationsOn(WEDNESDAY);

		expect(await entriesOn(TUESDAY)).toHaveLength(1);
	});
});

describe("reading", () => {
	test("does not sync anything", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([MONDAY, WEDNESDAY]));
		setCommitSourceForTests(commitsOn([MONDAY, WEDNESDAY]));
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
			githubSyncCommitsAsWorkTime: true,
		});

		await timeEntriesService.listRange(ctx, { from: MONDAY, to: WEDNESDAY });

		// Reading is reading. All three engines used to run inside listRange, so
		// which entries existed depended on which screen somebody had open — and
		// scrolling the Month view back was enough to file months of them. The
		// worker owns this now (jobs/automation-sync.ts).
		expect(await entriesOn(MONDAY)).toHaveLength(0);
		expect(await entriesOn(WEDNESDAY)).toHaveLength(0);
	});
});
