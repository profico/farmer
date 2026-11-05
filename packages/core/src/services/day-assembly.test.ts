// What "assemble my day" is for, finally asserted.
//
// The engine could only ever propose what it had external evidence for —
// meetings from the calendar, work split across the projects you committed to —
// plus a break carved OUT of the day's target. Nothing covered the remainder.
// So the common case (no calendar, no commits, a heads-down day) offered a
// 30-minute break against an 8-hour target and the dialog concluded the day
// "already matches your working hours".
//
// The `fill` suggestion kind had been declared on the type and rendered by the
// dialog the whole time; only the branch that emits it was missing. These tests
// pin the property that actually matters to a person: what the assembler
// proposes adds up to their working day.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import {
	projectGithubRepo,
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import {
	commitDetachTombstone,
	commitFillTombstone,
	filingRule,
	pullRequestEventDetachTombstone,
	pullRequestReviewTombstone,
	syncedMeetingTombstone,
} from "../db/schema/settings";
import { emptyCalendar, fakeCalendar } from "../test/calendar";
import { createTestDb, present, type TestDb } from "../test/harness";
import { findTool } from "./assistant-tools";
import { dayAssemblyService } from "./day-assembly.service";
import {
	pullRequestActivityRow,
	setGithubClientForTests,
} from "./github.service";
import {
	setCalendarSourceForTests,
	setCommitSourceForTests,
	setPullRequestSourceForTests,
} from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-assembly";
const USER_ID = "user-assembly";
const MONDAY = "2026-08-10";
const SATURDAY = "2026-08-15";
const EIGHT_HOURS = 8 * 3600;

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };

let harness: TestDb;
let devTaskId: string;
let breakTaskId: string;
let reviewTaskId: string;
let projectId: string;
let repoId: string;

const noCalendar = emptyCalendar;
const noCommits = {
	listUserCommitsForDay: async () => [],
	listUserCommitsByDay: async () => [],
};

const siteTask = async (
	systemKey: "development" | "break" | "meeting" | "code_review",
) => {
	const existing = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, systemKey)),
		columns: { id: true },
	});
	if (existing) return existing.id;
	const [row] = await db
		.insert(task)
		.values({
			scope: "site" as const,
			name: systemKey,
			systemKey,
			isAbsence: false,
		})
		.returning({ id: task.id });
	return row!.id;
};

/** Total of what the assembler proposes. Break is carved out of the target
 *  rather than added to it, so a complete proposal sums to exactly the target. */
const proposed = (suggestions: { durationSeconds: number }[]) =>
	suggestions.reduce((sum, s) => sum + s.durationSeconds, 0);

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Assembly Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "assembly@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-assembly",
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
		.values({ organizationId: ORG_ID, clientId: c!.id, name: "Farmer" })
		.returning();
	projectId = p!.id;
	const [repo] = await db
		.insert(projectGithubRepo)
		.values({
			organizationId: ORG_ID,
			projectId,
			githubRepoId: 1,
			owner: "acme",
			name: "farmer",
			fullName: "acme/farmer",
		})
		.returning({ id: projectGithubRepo.id });
	repoId = present(repo, "the repo").id;

	devTaskId = await siteTask("development");
	breakTaskId = await siteTask("break");
	reviewTaskId = await siteTask("code_review");
	await siteTask("meeting");

	// An explicit Mon-Fri 9-17, so the target is stated rather than defaulted.
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
	setPullRequestSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	// Tombstones outlive the entry they were left by — that is their entire job —
	// so they have to be cleared explicitly or one test's deletion becomes the
	// next one's starting state.
	await db.delete(syncedMeetingTombstone);
	await db.delete(commitFillTombstone);
	await db.delete(pullRequestReviewTombstone);
	setCalendarSourceForTests(noCalendar);
	setCommitSourceForTests(noCommits);
	setPullRequestSourceForTests(null);
});

describe("assemble my day", () => {
	test("an empty day is proposed in full, not just a break", async () => {
		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		expect(assembly.targetSeconds).toBe(EIGHT_HOURS);
		// The regression: this used to be exactly one 30-minute break.
		expect(proposed(assembly.suggestions)).toBe(EIGHT_HOURS);

		const fill = assembly.suggestions.find((s) => s.kind === "fill");
		expect(fill).toBeDefined();
		expect(fill?.fillsDay).toBe(true);
		expect(fill?.durationSeconds).toBe(EIGHT_HOURS - 30 * 60);
	});

	test("meetings and the break are covered, and the fill takes the rest", async () => {
		setCalendarSourceForTests({
			...noCalendar,
			listEventsForRange: async () => [
				{
					id: "event-1",
					title: "Standup",
					start: `${MONDAY}T09:00:00.000Z`,
					end: `${MONDAY}T10:00:00.000Z`,
					meetingUrl: null,
					htmlLink: null,
				},
			],
		});

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		const kinds = assembly.suggestions.map((s) => s.kind);

		expect(kinds).toContain("meeting");
		expect(kinds).toContain("break");
		expect(kinds).toContain("fill");
		expect(proposed(assembly.suggestions)).toBe(EIGHT_HOURS);
	});

	test("commits claim the day, so no fill is proposed on top of them", async () => {
		setCommitSourceForTests({
			...noCommits,
			listUserCommitsForDay: async () => [
				{
					projectId,
					projectGithubRepoId: "00000000-0000-0000-0000-000000000001",
					repoFullName: "acme/farmer",
					sha: "abc123",
					message: "fix: the thing",
					committedAt: new Date(`${MONDAY}T12:00:00.000Z`),
				},
			],
		});

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		// The commit split already consumes the whole remainder in 15-minute units.
		expect(assembly.suggestions.some((s) => s.kind === "work")).toBe(true);
		expect(assembly.suggestions.some((s) => s.kind === "fill")).toBe(false);
		expect(proposed(assembly.suggestions)).toBe(EIGHT_HOURS);
	});

	test("a reviewed pull request is proposed as a half hour of its own", async () => {
		setPullRequestSourceForTests({
			listUserPullRequestActivityByDay: async () => [],
			listUserPullRequestActivityForDay: async () => [
				{
					eventId: "PRR_1",
					kind: "reviewed",
					reviewState: "approved",
					number: 7,
					title: "Fix login",
					pullRequestUrl: "https://github.com/acme/farmer/pull/7",
					url: "https://github.com/acme/farmer/pull/7#pullrequestreview-1",
					occurredAt: new Date(`${MONDAY}T12:00:00.000Z`),
					projectGithubRepoId: "00000000-0000-0000-0000-000000000001",
					projectId,
					repoFullName: "acme/farmer",
				},
			],
		});

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		const review = assembly.suggestions.find((s) => s.kind === "review");
		expect(review?.taskId).toBe(reviewTaskId);
		expect(review?.projectId).toBe(projectId);
		expect(review?.durationSeconds).toBe(30 * 60);
		expect(review?.description).toBe("PR review: Fix login");
		// On its own block, so it backs no work suggestion as well.
		expect(assembly.suggestions.some((s) => s.kind === "work")).toBe(false);
		expect(proposed(assembly.suggestions)).toBe(EIGHT_HOURS);
	});

	test("another pull request's block does not account for a review, and a hand-logged entry does", async () => {
		const review = (number: number) => ({
			eventId: `PRR_${String(number)}`,
			kind: "reviewed" as const,
			reviewState: "approved" as const,
			number,
			title: `Change ${String(number)}`,
			pullRequestUrl: `https://github.com/acme/farmer/pull/${String(number)}`,
			url: `https://github.com/acme/farmer/pull/${String(number)}#pullrequestreview-1`,
			occurredAt: new Date(`${MONDAY}T12:00:00.000Z`),
			projectGithubRepoId: repoId,
			projectId,
			repoFullName: "acme/farmer",
		});
		setPullRequestSourceForTests({
			listUserPullRequestActivityByDay: async () => [],
			listUserPullRequestActivityForDay: async () => [review(7), review(9)],
		});
		const [inserted] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: USER_ID,
				taskId: reviewTaskId,
				projectId,
				date: MONDAY,
				durationSeconds: 30 * 60,
				description: "PR review: Change 7",
			})
			.returning({ id: timeEntry.id });
		const block = present(inserted, "the review block");
		await db
			.insert(timeEntryGithubPrActivity)
			.values(pullRequestActivityRow(block.id, repoId, review(7)));

		const beside = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		expect(
			beside.suggestions.flatMap((s) =>
				s.kind === "review" ? [s.description] : [],
			),
		).toEqual(["PR review: Change 9"]);

		// The same entry, renamed, is the person's own: #9 goes on it.
		await db
			.update(timeEntry)
			.set({ description: "Reviews" })
			.where(eq(timeEntry.id, block.id));
		const onOwn = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		expect(onOwn.suggestions.some((s) => s.kind === "review")).toBe(false);
	});

	test("a day that already has a fill block gets no second one", async () => {
		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: MONDAY,
			description: "Rest of day",
			overtime: false,
			fillsDay: true,
		});

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		// One fill block per day is a database constraint, not a preference.
		expect(assembly.suggestions.some((s) => s.kind === "fill")).toBe(false);
	});

	test("the fill covers only what existing entries left over", async () => {
		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Already logged",
			date: MONDAY,
			durationSeconds: 3 * 3600,
			overtime: false,
			fillsDay: false,
		});

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		expect(assembly.loggedSeconds).toBe(3 * 3600);
		expect(proposed(assembly.suggestions)).toBe(EIGHT_HOURS - 3 * 3600);
	});

	test("a day already logged to target proposes nothing", async () => {
		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Full day",
			date: MONDAY,
			durationSeconds: EIGHT_HOURS,
			overtime: false,
			fillsDay: false,
		});

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		// Only now is the dialog's "this day already matches your working hours"
		// a true statement.
		expect(assembly.suggestions).toHaveLength(0);
	});

	test("a non-working day proposes nothing", async () => {
		const assembly = await dayAssemblyService.suggest(ctx, { date: SATURDAY });

		expect(assembly.targetSeconds).toBe(0);
		expect(assembly.suggestions).toHaveLength(0);
	});

	test("applying the proposal fills the day to target", async () => {
		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		const { created, errors } = await dayAssemblyService.apply(ctx, {
			date: MONDAY,
			entries: assembly.suggestions.map((s) => ({
				taskId: s.taskId,
				projectId: s.projectId ?? undefined,
				description: s.description || undefined,
				// The dialog deliberately sends no duration for a fill block; the
				// service re-derives it. Mirror that, so this covers the real path.
				durationSeconds: s.fillsDay ? undefined : s.durationSeconds,
				fillsDay: s.fillsDay || undefined,
			})),
		});

		expect(errors).toEqual([]);
		expect(created).toBe(assembly.suggestions.length);

		const rows = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ORG_ID),
				eq(timeEntry.userId, USER_ID),
				eq(timeEntry.date, MONDAY),
			),
		});
		const logged = rows.reduce((sum, r) => sum + r.durationSeconds, 0);
		expect(logged).toBe(EIGHT_HOURS);
		expect(rows.some((r) => r.taskId === breakTaskId)).toBe(true);
	});

	test("deselecting the break grows the fill to cover it", async () => {
		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		const withoutBreak = assembly.suggestions.filter((s) => s.kind !== "break");

		await dayAssemblyService.apply(ctx, {
			date: MONDAY,
			entries: withoutBreak.map((s) => ({
				taskId: s.taskId,
				projectId: s.projectId ?? undefined,
				description: s.description || undefined,
				durationSeconds: s.fillsDay ? undefined : s.durationSeconds,
				fillsDay: s.fillsDay || undefined,
			})),
		});

		const rows = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ORG_ID),
				eq(timeEntry.userId, USER_ID),
				eq(timeEntry.date, MONDAY),
			),
		});
		// The fill is derived on write, so dropping the break leaves no hole.
		const logged = rows.reduce((sum, r) => sum + r.durationSeconds, 0);
		expect(logged).toBe(EIGHT_HOURS);
	});
});

// `apply` goes through `create`, which refuses an entry past 24 hours — but it
// does so one entry at a time, best-effort, so a proposal that did not fit wrote
// its first entries and refused the rest. The whole proposal is checked first.
describe("the 24-hour ceiling on an accepted proposal", () => {
	const mondayRows = () =>
		db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ORG_ID),
				eq(timeEntry.userId, USER_ID),
				eq(timeEntry.date, MONDAY),
			),
		});

	test("a proposal that would overfill the day writes nothing", async () => {
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId,
			date: MONDAY,
			description: "Long day",
			durationSeconds: 20 * 3600,
		});

		const { created, errors } = await dayAssemblyService.apply(ctx, {
			date: MONDAY,
			entries: [
				// Fits on its own, and used to be written before the next was refused.
				{ taskId: breakTaskId, description: "Break", durationSeconds: 1800 },
				{
					taskId: devTaskId,
					projectId,
					description: "More work",
					durationSeconds: 4 * 3600,
				},
			],
		});

		expect(created).toBe(0);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/more than 24 hours/);
		expect(await mondayRows()).toHaveLength(1);
	});

	test("a database error is not passed to the caller", async () => {
		// 1000 seconds passes the schema and fails the granularity check, so
		// the insert fails with its SQL and parameters in the message.
		const originalError = console.error;
		console.error = () => {};
		try {
			const { created, errors } = await dayAssemblyService.apply(ctx, {
				date: MONDAY,
				entries: [
					{
						taskId: devTaskId,
						projectId,
						description: "Secret note",
						durationSeconds: 1000,
					},
				],
			});
			expect(created).toBe(0);
			expect(errors).toEqual(["Failed to create entry"]);
		} finally {
			console.error = originalError;
		}
	});

	test("the apply_day_assembly tool adds the recovery hint", async () => {
		const tool = present(findTool("apply_day_assembly"), "the tool");
		const result = await tool.run(ctx, {
			date: MONDAY,
			entries: [
				{
					taskId: "00000000-0000-4000-8000-000000000000",
					description: "Stale",
					durationSeconds: 1800,
				},
			],
		});
		// SAFETY: the tool returns the `apply` result, and the expectation reads
		// only `errors` from it.
		const { errors } = result as { errors: string[] };
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Call list_tasks");
	});

	test("an accepted rest-of-day block does not count against it", async () => {
		const { created, errors } = await dayAssemblyService.apply(ctx, {
			date: MONDAY,
			entries: [
				{ taskId: breakTaskId, description: "Break", durationSeconds: 1800 },
				// Whatever a client claims for the fill, `create` sizes it from what
				// the day leaves — so the claim must not trip the ceiling either.
				{ taskId: devTaskId, fillsDay: true, durationSeconds: 23 * 3600 },
			],
		});

		expect(errors).toEqual([]);
		expect(created).toBe(2);
		const fill = (await mondayRows()).find((row) => row.fillsDay);
		expect(fill?.durationSeconds).toBe(EIGHT_HOURS - 1800);
	});
});

// Deleting a synced block records a tombstone, which is what stops the engines
// putting it straight back. Right by default, and a dead end when the deletion
// was a mistake: the block is gone, the engine has been told never to rebuild
// it, and the assembler — the one screen whose whole job is "offer me what's
// missing" — was the one place that agreed not to mention it.
describe("offering back what was deleted", () => {
	const meetingOn = (date: string) => ({
		...noCalendar,
		listEventsForRange: async () => [
			{
				id: "event-deleted",
				title: "Standup",
				start: `${date}T09:00:00.000Z`,
				end: `${date}T10:00:00.000Z`,
				meetingUrl: null,
				htmlLink: null,
			},
		],
	});

	/** Import the meeting the way the sync engine would, then delete it the way a
	 *  person would — which is what leaves the tombstone. */
	const importAndDeleteTheMeeting = async () => {
		const created = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: MONDAY,
			description: "Standup",
			durationSeconds: 3600,
			overtime: false,
			fillsDay: false,
			calendarEventId: "event-deleted",
		});
		await timeEntriesService.remove(ctx, created.id);
	};

	test("a deleted meeting is not re-proposed by default", async () => {
		setCalendarSourceForTests(meetingOn(MONDAY));
		await importAndDeleteTheMeeting();

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		expect(assembly.suggestions.map((s) => s.kind)).not.toContain("meeting");
		// But it is COUNTED, so the dialog can offer the toggle at all. A switch
		// with nothing behind it is a switch people learn to ignore.
		expect(assembly.dismissedCount).toBe(1);
	});

	test("includeDismissed brings it back, flagged", async () => {
		setCalendarSourceForTests(meetingOn(MONDAY));
		await importAndDeleteTheMeeting();

		const assembly = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});

		const meeting = assembly.suggestions.find((s) => s.kind === "meeting");
		expect(meeting).toBeDefined();
		// Flagged rather than silently mixed in: the dialog offers these UNTICKED,
		// so asking to see one mistake doesn't re-add four deliberate deletions.
		expect(meeting?.dismissed).toBe(true);
		// Still counted with the toggle on, or it would erase its own reason for
		// existing the moment it was used.
		expect(assembly.dismissedCount).toBe(1);
	});

	test("a meeting already logged is never re-proposed, toggle or not", async () => {
		// Two different reasons to leave an event out, and only one of them is a
		// decision the toggle may override.
		setCalendarSourceForTests(meetingOn(MONDAY));
		await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: MONDAY,
			description: "Standup",
			durationSeconds: 3600,
			overtime: false,
			fillsDay: false,
			calendarEventId: "event-deleted",
		});

		const assembly = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});

		expect(assembly.suggestions.map((s) => s.kind)).not.toContain("meeting");
		expect(assembly.dismissedCount).toBe(0);
	});

	test("a deleted rest-of-day block is held back, then offered", async () => {
		const created = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			date: MONDAY,
			overtime: false,
			fillsDay: true,
		});
		await timeEntriesService.remove(ctx, created.id);

		const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		expect(quiet.suggestions.map((s) => s.kind)).not.toContain("fill");
		expect(quiet.dismissedCount).toBe(1);

		const loud = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});
		expect(loud.suggestions.find((s) => s.kind === "fill")?.dismissed).toBe(
			true,
		);
	});

	test("a deleted review block is held back, then offered", async () => {
		const url = "https://github.com/acme/farmer/pull/7";
		setPullRequestSourceForTests({
			listUserPullRequestActivityByDay: async () => [],
			listUserPullRequestActivityForDay: async () => [
				{
					eventId: "PRR_1",
					kind: "reviewed",
					reviewState: "approved",
					number: 7,
					title: "Fix login",
					pullRequestUrl: url,
					url: `${url}#pullrequestreview-1`,
					occurredAt: new Date(`${MONDAY}T12:00:00.000Z`),
					projectGithubRepoId: repoId,
					projectId,
					repoFullName: "acme/farmer",
				},
			],
		});
		await db.insert(pullRequestReviewTombstone).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			date: MONDAY,
			pullRequestUrl: url,
		});

		const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		expect(quiet.suggestions.map((s) => s.kind)).not.toContain("review");
		expect(quiet.dismissedCount).toBe(1);

		const loud = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});
		const review = loud.suggestions.find((s) => s.kind === "review");
		expect(review?.dismissed).toBe(true);
		expect(review?.key).toBe(`review:${url}`);
		expect(loud.dismissedCount).toBe(1);
	});

	test("a day with nothing deleted reports nothing to offer", async () => {
		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		// The dialog hides the toggle on this answer, which is almost every day.
		expect(assembly.dismissedCount).toBe(0);
		expect(assembly.suggestions.every((s) => !s.dismissed)).toBe(true);
	});
});

// An unlinked commit or event has a detach tombstone. The engine keeps it off
// every entry, so the assembler holds it back as it holds back a deleted
// meeting, and accepting it again does not take the "no" back.
describe("offering back what was unlinked", () => {
	const SHA = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0";

	beforeAll(async () => {
		// A manual attach reads the repo through the caller's assignment.
		await db
			.insert(projectMember)
			.values({ organizationId: ORG_ID, projectId, userId: USER_ID });
		await db
			.update(projectGithubRepo)
			.set({ installationId: 100 })
			.where(eq(projectGithubRepo.id, repoId));
	});

	beforeEach(async () => {
		await db.delete(commitDetachTombstone);
		await db.delete(pullRequestEventDetachTombstone);
		await db.delete(pullRequestReviewTombstone);
		setCommitSourceForTests({
			...noCommits,
			listUserCommitsForDay: async () => [
				{
					projectId,
					projectGithubRepoId: repoId,
					repoFullName: "acme/farmer",
					sha: SHA,
					message: "fix: the thing",
					committedAt: new Date(`${MONDAY}T12:00:00.000Z`),
				},
			],
		});
	});

	const refuseTheCommit = () =>
		db.insert(commitDetachTombstone).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			sha: SHA,
			date: MONDAY,
		});

	test("an unlinked commit is held back, then offered unticked", async () => {
		await refuseTheCommit();

		const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		expect(quiet.suggestions.some((s) => s.kind === "work")).toBe(false);
		expect(quiet.dismissedCount).toBe(1);

		const loud = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});
		const work = present(
			loud.suggestions.find((s) => s.kind === "work"),
			"the work suggestion",
		);
		expect(work.commits.map((commit) => commit.sha)).toEqual([SHA]);
		expect(work.dismissed).toBe(true);
	});

	test("an unlinked pull request event is held back, then offered unticked", async () => {
		setCommitSourceForTests(noCommits);
		setPullRequestSourceForTests({
			listUserPullRequestActivityByDay: async () => [],
			listUserPullRequestActivityForDay: async () => [
				{
					eventId: "PR_7:opened",
					kind: "opened",
					reviewState: null,
					number: 7,
					title: "Fix login",
					pullRequestUrl: "https://github.com/acme/farmer/pull/7",
					url: "https://github.com/acme/farmer/pull/7",
					occurredAt: new Date(`${MONDAY}T12:00:00.000Z`),
					projectGithubRepoId: repoId,
					projectId,
					repoFullName: "acme/farmer",
				},
			],
		});
		await db.insert(pullRequestEventDetachTombstone).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			eventId: "PR_7:opened",
			date: MONDAY,
		});

		const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
		expect(quiet.suggestions.some((s) => s.kind === "work")).toBe(false);
		expect(quiet.dismissedCount).toBe(1);

		const loud = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});
		expect(loud.suggestions.find((s) => s.kind === "work")?.dismissed).toBe(
			true,
		);
	});

	describe("an unlinked review counts once", () => {
		const PR_URL = "https://github.com/acme/farmer/pull/7";
		const review = (eventId: string) => ({
			eventId,
			kind: "reviewed" as const,
			reviewState: "approved" as const,
			number: 7,
			title: "Fix login",
			pullRequestUrl: PR_URL,
			url: `${PR_URL}#${eventId}`,
			occurredAt: new Date(`${MONDAY}T12:00:00.000Z`),
			projectGithubRepoId: repoId,
			projectId,
			repoFullName: "acme/farmer",
		});
		const reviewsOnTheDay = (eventIds: string[]) => {
			setCommitSourceForTests(noCommits);
			setPullRequestSourceForTests({
				listUserPullRequestActivityByDay: async () => [],
				listUserPullRequestActivityForDay: async () => eventIds.map(review),
			});
		};
		const refuseEvent = (eventId: string) =>
			db.insert(pullRequestEventDetachTombstone).values({
				organizationId: ORG_ID,
				userId: USER_ID,
				eventId,
				date: MONDAY,
			});
		const refuseBlock = () =>
			db.insert(pullRequestReviewTombstone).values({
				organizationId: ORG_ID,
				userId: USER_ID,
				date: MONDAY,
				pullRequestUrl: PR_URL,
			});

		test("the last review of a pull request, with the toggle on or off", async () => {
			reviewsOnTheDay(["PRR_1"]);
			await refuseEvent("PRR_1");
			await refuseBlock();

			const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
			expect(quiet.suggestions.some((s) => s.kind === "review")).toBe(false);
			expect(quiet.dismissedCount).toBe(1);

			const loud = await dayAssemblyService.suggest(ctx, {
				date: MONDAY,
				includeDismissed: true,
			});
			expect(loud.suggestions.some((s) => s.kind === "review")).toBe(true);
			expect(loud.dismissedCount).toBe(1);
		});

		test("an unlinked review beside another review of the same pull request", async () => {
			reviewsOnTheDay(["PRR_1", "PRR_2"]);
			await refuseEvent("PRR_1");
			await refuseBlock();

			const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
			expect(quiet.dismissedCount).toBe(1);
			const loud = await dayAssemblyService.suggest(ctx, {
				date: MONDAY,
				includeDismissed: true,
			});
			expect(loud.dismissedCount).toBe(1);
		});

		test("a deleted block with no event tombstone still counts once", async () => {
			reviewsOnTheDay(["PRR_1"]);
			await refuseBlock();

			const quiet = await dayAssemblyService.suggest(ctx, { date: MONDAY });
			expect(quiet.dismissedCount).toBe(1);
			const loud = await dayAssemblyService.suggest(ctx, {
				date: MONDAY,
				includeDismissed: true,
			});
			expect(loud.dismissedCount).toBe(1);
		});
	});

	test("an unlinked commit moved by hand to another entry is not offered", async () => {
		await refuseTheCommit();
		const [moved] = await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: USER_ID,
				taskId: devTaskId,
				projectId: null,
				date: MONDAY,
				durationSeconds: 3600,
				description: "Moved here",
			})
			.returning({ id: timeEntry.id });
		await db.insert(timeEntryGithubCommit).values({
			timeEntryId: present(moved, "the entry").id,
			projectGithubRepoId: repoId,
			sha: SHA,
			message: "fix: the thing",
			committedAt: new Date(`${MONDAY}T12:00:00.000Z`),
			url: `https://github.com/acme/farmer/commit/${SHA}`,
		});

		const assembly = await dayAssemblyService.suggest(ctx, {
			date: MONDAY,
			includeDismissed: true,
		});

		// It is on an entry already, as a logged meeting is: nothing to offer.
		expect(
			assembly.suggestions.some((s) =>
				s.commits.some((commit) => commit.sha === SHA),
			),
		).toBe(false);
		expect(assembly.dismissedCount).toBe(0);
	});

	test("accepting an unlinked commit keeps the tombstone", async () => {
		await refuseTheCommit();
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getCommit: async (_token, _owner, _repo, sha) => ({
				sha,
				html_url: `https://github.com/acme/farmer/commit/${sha}`,
				commit: {
					message: "fix: the thing",
					author: { date: `${MONDAY}T12:00:00Z` },
				},
				author: { login: "tester" },
			}),
			listInstallationRepos: async () => [],
		});

		const result = await dayAssemblyService.apply(ctx, {
			date: MONDAY,
			entries: [
				{
					taskId: devTaskId,
					projectId,
					description: "fix: the thing",
					durationSeconds: 3600,
					commits: [{ projectGithubRepoId: repoId, sha: SHA }],
				},
			],
		});

		expect(result.errors).toEqual([]);
		const attached = await db.query.timeEntryGithubCommit.findMany({
			where: eq(timeEntryGithubCommit.sha, SHA),
		});
		expect(attached).toHaveLength(1);
		expect(await db.query.commitDetachTombstone.findMany()).toHaveLength(1);
	});
});

describe("filing rules in the assembler", () => {
	// The same answer the sync gives: a meeting the person already filed once
	// arrives on its project and task, so the day is filed as it is added.
	test("a meeting with a rule is proposed on the rule's project and task", async () => {
		const meetingTaskId = await siteTask("meeting");
		await db.insert(filingRule).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: meetingTaskId,
			titleKey: "design review",
			title: "Design review",
			projectId,
			targetTaskId: reviewTaskId,
		});
		setCalendarSourceForTests({
			...noCalendar,
			listEventsForRange: async () => [
				{
					id: "rule-event",
					title: "Design review",
					start: `${MONDAY}T09:00:00.000Z`,
					end: `${MONDAY}T10:00:00.000Z`,
					meetingUrl: null,
					htmlLink: null,
				},
			],
		});

		try {
			const { suggestions } = await dayAssemblyService.suggest(ctx, {
				date: MONDAY,
			});
			const meeting = suggestions.find((s) => s.kind === "meeting");
			expect(meeting?.projectId).toBe(projectId);
			expect(meeting?.projectName).toBe("Farmer");
			expect(meeting?.taskId).toBe(reviewTaskId);
		} finally {
			await db.delete(filingRule);
		}
	});
});

describe("a rule on a proposed block", () => {
	// The case from the report: a rule remembered from filing a rest-of-day block
	// used to be listed under Preferences and never applied anywhere.
	test("a rest-of-day rule files the rest-of-day suggestion", async () => {
		await db.insert(filingRule).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			titleKey: "rest of day",
			title: "Rest of day",
			projectId,
			targetTaskId: reviewTaskId,
		});

		try {
			const { suggestions } = await dayAssemblyService.suggest(ctx, {
				date: MONDAY,
			});
			const fill = suggestions.find((s) => s.kind === "fill");
			expect(fill?.projectId).toBe(projectId);
			expect(fill?.taskId).toBe(reviewTaskId);
			// The break has no rule and stays as proposed.
			expect(suggestions.find((s) => s.kind === "break")?.projectId).toBeNull();
		} finally {
			await db.delete(filingRule);
		}
	});
});

describe("which sources the assembler could read", () => {
	const link = async (providerId: string) => {
		await db.insert(account).values({
			id: `account-${providerId}`,
			accountId: providerId,
			providerId,
			userId: USER_ID,
			updatedAt: new Date(),
		});
	};

	afterEach(async () => {
		await db.delete(account);
	});

	test("both are unavailable while no account is linked", async () => {
		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		expect(assembly.sources).toEqual({
			calendar: "unavailable",
			github: "unavailable",
		});
	});

	test("a linked calendar and GitHub account are ok", async () => {
		await link("google-calendar");
		await link("github");

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		expect(assembly.sources).toEqual({ calendar: "ok", github: "ok" });
	});

	test("a linked calendar that cannot be read is unavailable", async () => {
		await link("google-calendar");
		setCalendarSourceForTests(fakeCalendar(null));

		const assembly = await dayAssemblyService.suggest(ctx, { date: MONDAY });

		expect(assembly.sources.calendar).toBe("unavailable");
	});
});
