// "Turning a switch on should only apply from today on."
//
// Three engines write entries nobody typed: the recurring block materializer
// (asserted in recurring-block-rules.test.ts), the calendar meeting sync, and
// the commit work-time blocks. All three ran over whatever range was being
// read, so scrolling the time page back through a few months was enough to have
// them file entries across already-closed timesheets — and the commit engine had
// no window of any kind, unlike the calendar sync's forward reach.
//
// The fix is to record WHEN each switch was flipped and floor the engine there.
// These tests pin both halves: that the stamp is written on the transition, and
// that each engine honours it.

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
import { integrationSettings } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { integrationSettingsService } from "./integration-settings.service";
import { setCalendarSourceForTests, setCommitSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-since";
const USER_ID = "user-since";
const MONDAY = "2026-08-10";
const TUESDAY = "2026-08-11";
const WEDNESDAY = "2026-08-12";

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

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
	listEventsForRange: async (
		_ctx: Ctx,
		range: { from: string; to: string },
	) =>
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
});

describe("recording when a switch was flipped", () => {
	test("turning one on stamps the moment", async () => {
		const before = new Date();
		const settings = await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});

		expect(settings.googleAutoSyncMeetingsSince).not.toBeNull();
		expect(
			(settings.googleAutoSyncMeetingsSince as Date).getTime(),
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
			(second.githubSyncCommitsAsWorkTimeSince as Date).getTime(),
		).toBeGreaterThanOrEqual(
			(first.githubSyncCommitsAsWorkTimeSince as Date).getTime(),
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

		await timeEntriesService.syncMeetingsForUser(ctx, {
			from: MONDAY,
			to: WEDNESDAY,
		});

		// Monday predates the switch: a calendar full of last year's meetings does
		// not land on the day someone first ticks the box.
		expect(await entriesOn(MONDAY)).toHaveLength(0);
		expect(await entriesOn(WEDNESDAY)).toHaveLength(1);
	});

	test("with no recorded start, nothing is floored", async () => {
		setCalendarSourceForTests(calendarWithMeetingsOn([MONDAY]));
		await integrationSettingsService.update(ctx, {
			googleAutoSyncMeetings: true,
		});
		// Rows written before the column existed are grandfathered rather than
		// silently switched off; the migration backfills them from created_at.
		await db
			.update(integrationSettings)
			.set({ googleAutoSyncMeetingsSince: null })
			.where(eq(integrationSettings.organizationId, ORG_ID));

		await timeEntriesService.syncMeetingsForUser(ctx, {
			from: MONDAY,
			to: WEDNESDAY,
		});

		expect(await entriesOn(MONDAY)).toHaveLength(1);
	});
});

describe("commit work-time blocks", () => {
	test("commits from before the switch do not become blocks", async () => {
		setCommitSourceForTests(commitsOn([MONDAY, WEDNESDAY]));
		await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await switchedOnAt("githubSyncCommitsAsWorkTimeSince", TUESDAY);

		await timeEntriesService.listRange(ctx, { from: MONDAY, to: WEDNESDAY });

		// The engine had no window at all before this: paging back a month filed a
		// "rest of day" block onto every past day with a commit on it.
		expect(await entriesOn(MONDAY)).toHaveLength(0);
		const wednesday = await entriesOn(WEDNESDAY);
		expect(wednesday).toHaveLength(1);
		expect(wednesday[0]?.fillsDay).toBe(true);
		expect(wednesday[0]?.taskId).toBe(devTaskId);
	});

	test("a range entirely before the switch syncs nothing at all", async () => {
		setCommitSourceForTests(commitsOn([MONDAY]));
		await integrationSettingsService.update(ctx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await switchedOnAt("githubSyncCommitsAsWorkTimeSince", WEDNESDAY);

		await timeEntriesService.listRange(ctx, { from: MONDAY, to: TUESDAY });

		expect(await entriesOn(MONDAY)).toHaveLength(0);
		expect(await entriesOn(TUESDAY)).toHaveLength(0);
	});
});
