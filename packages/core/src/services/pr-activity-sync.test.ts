// Pull request events as the commit engine's second body of evidence.
//
// The engine used to know one kind of evidence, so a day spent reviewing other
// people's pull requests looked, to it, like a day nobody worked: no block, and
// nothing attached to the entry the person logged by hand. These pin the three
// things PR events now do exactly as commits do — find the entry that describes
// the day, file the rest of the day when nothing does, and move with a fill
// block that the day squeezes out — and that a sweep repeated every twenty
// minutes adds nothing twice.

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
	integrationSettings,
	orgSettings,
	pullRequestEventDetachTombstone,
	pullRequestReviewTombstone,
} from "../db/schema/settings";
import type { PullRequestActivityKind } from "../lib/github-activity";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import {
	githubService,
	pullRequestActivityRow,
	type ScannedPullRequestActivity,
	setGithubClientForTests,
} from "./github.service";
import { integrationSettingsService } from "./integration-settings.service";
import {
	type PullRequestSource,
	setCommitSourceForTests,
	setPullRequestSourceForTests,
} from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-pr-activity";
const USER_ID = "user-pr-activity";
/** The engine writes only to days that are over; see commit-attach.test.ts. */
const YESTERDAY = "2026-08-11";
const TODAY = "2026-08-12";

const ctx: Ctx = { organizationId: ORG_ID, userId: USER_ID };
const OTHER_USER_ID = "user-pr-activity-other";
const otherCtx: Ctx = { organizationId: ORG_ID, userId: OTHER_USER_ID };

let harness: TestDb;
let devTaskId: string;
let reviewTaskId: string;
let projectId: string;
let repoId: string;

const runAutomations = () =>
	timeEntriesService.runAutomationsForUser(ctx, {
		now: new Date(`${TODAY}T12:00:00.000Z`),
	});

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

const activityOn = (timeEntryId: string) =>
	db.query.timeEntryGithubPrActivity.findMany({
		where: eq(timeEntryGithubPrActivity.timeEntryId, timeEntryId),
	});

type FakeEvent = {
	day: string;
	number: number;
	kind: PullRequestActivityKind;
	/** Only needed for a second review round on the same PR and day. */
	id?: string;
};

const event = ({
	day,
	number,
	kind,
	id,
}: FakeEvent): ScannedPullRequestActivity => ({
	eventId: id ?? `PR_${String(number)}:${kind}`,
	kind,
	reviewState: kind === "reviewed" ? "approved" : null,
	number,
	title: `Change ${String(number)}`,
	pullRequestUrl: `https://github.com/profico/repo/pull/${String(number)}`,
	url: `https://github.com/profico/repo/pull/${String(number)}`,
	occurredAt: new Date(`${day}T12:00:00.000Z`),
	projectGithubRepoId: repoId,
	projectId,
	repoFullName: "profico/repo",
});

const pullRequestsFor = (events: FakeEvent[]): PullRequestSource => ({
	listUserPullRequestActivityForDay: async () => [],
	listUserPullRequestActivityByDay: async (_ctx, range) => {
		const byDay = new Map<string, ScannedPullRequestActivity[]>();
		for (const fake of events) {
			if (fake.day < range.from || fake.day > range.to) continue;
			byDay.set(fake.day, [...(byDay.get(fake.day) ?? []), event(fake)]);
		}
		return [...byDay].map(([dayKey, activity]) => ({ dayKey, activity }));
	},
});

const noCommits = {
	listUserCommitsForDay: async () => [],
	listUserCommitsByDay: async () => [],
};

/** Archiving the task is how an org without one looks to the engine. */
const setReviewTaskLive = (live: boolean) =>
	db
		.update(task)
		.set({ archivedAt: live ? null : new Date() })
		.where(eq(task.id, reviewTaskId));

const addEntry = async (values: {
	date: string;
	projectId?: string | null;
	taskId?: string;
	durationSeconds: number;
	description?: string;
}) => {
	const [row] = await db
		.insert(timeEntry)
		.values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: values.taskId ?? devTaskId,
			projectId: values.projectId ?? null,
			date: values.date,
			durationSeconds: values.durationSeconds,
			description: values.description ?? "",
		})
		.returning();
	return present(row, "the fixture entry");
};

beforeAll(async () => {
	// A manual attach reads the person's own GitHub login, and that goes through
	// better-auth, which needs a registered GitHub provider.
	setInstanceSettingsForTests({
		GITHUB_CLIENT_ID: "test-client-id",
		GITHUB_CLIENT_SECRET: "test-client-secret",
	});
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "PR Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Reviewer",
		email: "reviewer@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-pr-activity",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
	});

	const [acme] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();
	const [farmer] = await db
		.insert(project)
		.values({
			organizationId: ORG_ID,
			clientId: present(acme, "the client").id,
			name: "Farmer",
		})
		.returning();
	projectId = present(farmer, "the project").id;

	const [repo] = await db
		.insert(projectGithubRepo)
		.values({
			organizationId: ORG_ID,
			projectId,
			githubRepoId: 1,
			owner: "profico",
			name: "repo",
			fullName: "profico/repo",
		})
		.returning({ id: projectGithubRepo.id });
	repoId = present(repo, "the repo").id;

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
	devTaskId = present(dev, "the Development task").id;

	const [review] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Code Review",
			systemKey: "code_review" as const,
			isAbsence: false,
		})
		.returning({ id: task.id });
	reviewTaskId = present(review, "the Code Review task").id;

	await db.insert(user).values({
		id: OTHER_USER_ID,
		name: "Colleague",
		email: "reviewer-other@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-pr-activity-other",
		organizationId: ORG_ID,
		userId: OTHER_USER_ID,
		role: "member",
		createdAt: new Date(),
	});
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
	});
	await db
		.update(projectGithubRepo)
		.set({ installationId: 100 })
		.where(eq(projectGithubRepo.id, repoId));
	await db.insert(account).values({
		id: "account-pr-activity",
		accountId: "4242",
		providerId: "github",
		userId: USER_ID,
		accessToken: "user-token",
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	for (const userId of [USER_ID, OTHER_USER_ID]) {
		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
			await db.insert(memberWorkingHoursDay).values({
				organizationId: ORG_ID,
				userId,
				dayOfWeek,
				enabled: isWeekday,
				startTime: isWeekday ? "09:00" : null,
				endTime: isWeekday ? "17:00" : null,
			});
		}
	}
});

afterAll(async () => {
	setCommitSourceForTests(null);
	setPullRequestSourceForTests(null);
	setGithubClientForTests(null);
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(pullRequestReviewTombstone);
	await db.delete(pullRequestEventDetachTombstone);
	await db.delete(integrationSettings);
	await db.delete(orgSettings);
	setCommitSourceForTests(noCommits);
	setPullRequestSourceForTests(null);
	// The one switch covers both kinds of evidence.
	await integrationSettingsService.update(ctx, {
		githubSyncCommitsAsWorkTime: true,
	});
	// Backdated so these tests are about evidence, not about the `*_since` floor.
	await db
		.update(integrationSettings)
		.set({
			githubSyncCommitsAsWorkTimeSince: new Date("2026-08-01T00:00:00.000Z"),
		})
		.where(
			and(
				eq(integrationSettings.organizationId, ORG_ID),
				eq(integrationSettings.userId, USER_ID),
			),
		);
});

// With no Code Review task, as in an org that renamed it before the key
// existed: every event, reviews included, is evidence on the day's work.
describe("pull request events in the commit engine", () => {
	beforeEach(async () => {
		await setReviewTaskLive(false);
	});

	test("a day of reviews alone is a worked day: the rest of it is filed", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);

		await runAutomations();

		const [fill] = await entriesOn(YESTERDAY);
		expect(fill?.fillsDay).toBe(true);
		expect(fill?.description).toBe("Reviewed #7: Change 7");
		const attached = await activityOn(present(fill, "the fill block").id);
		expect(attached.map((row) => [row.kind, row.reviewState])).toEqual([
			["reviewed", "approved"],
		]);
	});

	test("lands on the project's own entry, beside the day's commits", async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 60 * 60,
			description: "Importer",
		});
		setCommitSourceForTests({
			listUserCommitsForDay: async () => [],
			listUserCommitsByDay: async () => [
				{
					dayKey: YESTERDAY,
					commits: [
						{
							projectGithubRepoId: repoId,
							projectId,
							sha: "sha-importer",
							message: "Fix the importer",
							authorLogin: "reviewer",
							committedAt: new Date(`${YESTERDAY}T10:00:00.000Z`),
							url: "https://github.com/profico/repo/commit/sha-importer",
						},
					],
				},
			],
		});
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "opened" }]),
		);

		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toHaveLength(1);
		expect(await activityOn(entry.id)).toHaveLength(1);
		expect(
			await db.query.timeEntryGithubCommit.findMany({
				where: eq(timeEntryGithubCommit.timeEntryId, entry.id),
			}),
		).toHaveLength(1);
	});

	test("re-running adds no event twice, and the badge counts pull requests", async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 8 * 60 * 60,
			description: "Importer",
		});
		setPullRequestSourceForTests(
			pullRequestsFor([
				{ day: YESTERDAY, number: 7, kind: "opened" },
				{ day: YESTERDAY, number: 7, kind: "merged" },
			]),
		);

		await runAutomations();
		await runAutomations();

		expect(await activityOn(entry.id)).toHaveLength(2);
		const [listed] = await timeEntriesService.listRange(ctx, {
			from: YESTERDAY,
			to: YESTERDAY,
		});
		// Two events on one pull request are one pull request on the badge.
		expect(listed?.pullRequestCount).toBe(1);
	});

	test("move with a fill block that a hand-made entry squeezes out", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);
		await runAutomations();
		const [fill] = await entriesOn(YESTERDAY);
		expect(fill?.fillsDay).toBe(true);

		const own = await timeEntriesService.create(ctx, {
			taskId: devTaskId,
			projectId,
			description: "Reviews",
			date: YESTERDAY,
			durationSeconds: 8 * 60 * 60,
			overtime: false,
			fillsDay: false,
		});

		expect((await entriesOn(YESTERDAY)).map((entry) => entry.id)).toEqual([
			own.id,
		]);
		expect((await activityOn(own.id)).map((row) => row.eventId)).toEqual([
			"PR_7:reviewed",
		]);
	});
});

// With a Code Review task: a reviewed pull request is a block of its own. The
// target is 8 hours, so every figure below is that day minus the blocks.
describe("review blocks", () => {
	const HALF_HOUR = 30 * 60;

	beforeEach(async () => {
		await setReviewTaskLive(true);
	});

	const reviewBlocksOn = async (date: string) =>
		(await entriesOn(date)).filter((entry) => entry.taskId === reviewTaskId);

	test("a reviewed pull request gets a half hour, and the rest of the day is still filed", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);

		await runAutomations();

		const [block] = await reviewBlocksOn(YESTERDAY);
		expect(block?.projectId).toBe(projectId);
		expect(block?.durationSeconds).toBe(HALF_HOUR);
		expect(block?.description).toBe("PR review: Change 7");
		const reviewed = await activityOn(present(block, "the review block").id);
		expect(reviewed.map((row) => row.eventId)).toEqual(["PR_7:reviewed"]);

		const fill = (await entriesOn(YESTERDAY)).find((entry) => entry.fillsDay);
		expect(fill?.durationSeconds).toBe(8 * 3600 - HALF_HOUR);
		// The review is on its own block, so it is not evidence here as well.
		expect(await activityOn(present(fill, "the fill block").id)).toEqual([]);
	});

	test("one block per pull request, however many rounds, and a re-run adds none", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([
				{ day: YESTERDAY, number: 7, kind: "reviewed", id: "PRR_a" },
				{ day: YESTERDAY, number: 7, kind: "reviewed", id: "PRR_b" },
				{ day: YESTERDAY, number: 9, kind: "reviewed" },
			]),
		);

		await runAutomations();
		await runAutomations();

		const blocks = await reviewBlocksOn(YESTERDAY);
		expect(blocks.map((block) => block.description).sort()).toEqual([
			"PR review: Change 7",
			"PR review: Change 9",
		]);
		const seven = blocks.find((b) => b.description === "PR review: Change 7");
		expect(
			await activityOn(present(seven, "the block for #7").id),
		).toHaveLength(2);
		const fill = (await entriesOn(YESTERDAY)).find((entry) => entry.fillsDay);
		expect(fill?.durationSeconds).toBe(8 * 3600 - 2 * HALF_HOUR);
	});

	test("a deleted review block stays deleted, and the review stays on the day", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);
		await runAutomations();
		const [block] = await reviewBlocksOn(YESTERDAY);

		await timeEntriesService.remove(ctx, present(block, "the review block").id);
		await runAutomations();

		expect(await reviewBlocksOn(YESTERDAY)).toEqual([]);
		const fill = (await entriesOn(YESTERDAY)).find((entry) => entry.fillsDay);
		expect(fill?.durationSeconds).toBe(8 * 3600);
		expect(
			(await activityOn(present(fill, "the fill block").id)).map(
				(row) => row.eventId,
			),
		).toEqual(["PR_7:reviewed"]);
	});

	test("a full day gets no block: the review goes on the work already logged", async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 8 * 3600,
			description: "Importer",
		});
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);

		await runAutomations();

		expect((await entriesOn(YESTERDAY)).map((row) => row.id)).toEqual([
			entry.id,
		]);
		expect((await activityOn(entry.id)).map((row) => row.eventId)).toEqual([
			"PR_7:reviewed",
		]);
	});

	test("a Code Review entry logged by hand takes the reviews on its project", async () => {
		const own = await addEntry({
			date: YESTERDAY,
			projectId,
			taskId: reviewTaskId,
			durationSeconds: 3600,
		});
		setPullRequestSourceForTests(
			pullRequestsFor([
				{ day: YESTERDAY, number: 7, kind: "reviewed" },
				{ day: YESTERDAY, number: 9, kind: "reviewed" },
			]),
		);

		await runAutomations();

		const blocks = await reviewBlocksOn(YESTERDAY);
		expect(blocks.map((block) => block.id)).toEqual([own.id]);
		expect(await activityOn(own.id)).toHaveLength(2);
		// Its blank description is written from the reviews, as a work entry's is.
		expect(blocks[0]?.description).toContain("Reviewed #7: Change 7");
	});

	test("a Code Review entry logged by hand keeps taking reviews after its first", async () => {
		const own = await addEntry({
			date: YESTERDAY,
			projectId,
			taskId: reviewTaskId,
			durationSeconds: 2 * 3600,
			description: "Reviews",
		});
		await db
			.insert(timeEntryGithubPrActivity)
			.values(
				pullRequestActivityRow(
					own.id,
					repoId,
					event({ day: YESTERDAY, number: 7, kind: "reviewed" }),
				),
			);
		setPullRequestSourceForTests(
			pullRequestsFor([
				{ day: YESTERDAY, number: 7, kind: "reviewed" },
				{ day: YESTERDAY, number: 9, kind: "reviewed" },
			]),
		);

		await runAutomations();

		expect((await reviewBlocksOn(YESTERDAY)).map((block) => block.id)).toEqual([
			own.id,
		]);
		expect((await activityOn(own.id)).map((row) => row.eventId).sort()).toEqual(
			["PR_7:reviewed", "PR_9:reviewed"],
		);
	});

	test("a pull request's block does not take a review a later run finds", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);
		await runAutomations();
		setPullRequestSourceForTests(
			pullRequestsFor([
				{ day: YESTERDAY, number: 7, kind: "reviewed" },
				{ day: YESTERDAY, number: 9, kind: "reviewed" },
			]),
		);

		await runAutomations();

		const blocks = await reviewBlocksOn(YESTERDAY);
		expect(blocks.map((block) => block.description).sort()).toEqual([
			"PR review: Change 7",
			"PR review: Change 9",
		]);
		for (const block of blocks) {
			expect(await activityOn(block.id)).toHaveLength(1);
		}
	});

	test("a review block stays deleted when its review was taken off first", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);
		await runAutomations();
		const block = present(
			(await reviewBlocksOn(YESTERDAY))[0],
			"the review block",
		);
		const [review] = await activityOn(block.id);

		await githubService.detachPullRequestActivity(
			ctx,
			present(review, "the attached review").id,
		);
		await timeEntriesService.remove(ctx, block.id);
		await runAutomations();

		expect(await reviewBlocksOn(YESTERDAY)).toEqual([]);
	});

	test("a review a run before review blocks already filed gets no second half hour", async () => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 4 * 3600,
			description: "Importer",
		});
		await db
			.insert(timeEntryGithubPrActivity)
			.values(
				pullRequestActivityRow(
					entry.id,
					repoId,
					event({ day: YESTERDAY, number: 7, kind: "reviewed" }),
				),
			);
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);

		await runAutomations();

		expect(await reviewBlocksOn(YESTERDAY)).toEqual([]);
		expect(await activityOn(entry.id)).toHaveLength(1);
	});
});

// Unlinking a pull request event used to delete one row, and the next pass
// attached the event again. The tombstone is per person and event, so it holds
// on whichever entry the engine would choose, and it is a separate "no" from
// the review block's: that one still lets a review stay evidence.
describe("a detached pull request event", () => {
	beforeEach(async () => {
		await setReviewTaskLive(false);
	});

	const allActivity = () => db.query.timeEntryGithubPrActivity.findMany();

	/** A work entry holding the day's events, as the engine files them. */
	const syncedEntry = async (events: FakeEvent[]) => {
		const entry = await addEntry({
			date: YESTERDAY,
			projectId,
			durationSeconds: 8 * 60 * 60,
			description: "Importer",
		});
		setPullRequestSourceForTests(pullRequestsFor(events));
		await runAutomations();
		return entry;
	};

	test("is not attached again by the next pass", async () => {
		const entry = await syncedEntry([
			{ day: YESTERDAY, number: 7, kind: "opened" },
		]);
		const [row] = await activityOn(entry.id);

		await githubService.detachPullRequestActivity(
			ctx,
			present(row, "the attached event").id,
		);
		await runAutomations();

		expect(await allActivity()).toEqual([]);
	});

	test("leaves the same pull request's other events in place", async () => {
		const entry = await syncedEntry([
			{ day: YESTERDAY, number: 7, kind: "opened" },
			{ day: YESTERDAY, number: 7, kind: "merged" },
		]);
		const opened = present(
			(await activityOn(entry.id)).find((row) => row.kind === "opened"),
			"the opened event",
		);

		await githubService.detachPullRequestActivity(ctx, opened.id);
		await runAutomations();

		expect((await allActivity()).map((row) => row.eventId)).toEqual([
			"PR_7:merged",
		]);
	});

	test("does not make a day with only that event a worked day", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "closed" }]),
		);
		await runAutomations();
		const fill = at(await entriesOn(YESTERDAY), 0);
		const row = at(await activityOn(fill.id), 0);
		await githubService.detachPullRequestActivity(ctx, row.id);
		await db.delete(timeEntry);

		await runAutomations();

		expect(await entriesOn(YESTERDAY)).toEqual([]);
	});

	test("records the person and the event's day", async () => {
		const entry = await syncedEntry([
			{ day: YESTERDAY, number: 7, kind: "opened" },
		]);

		await githubService.detachPullRequestActivity(
			ctx,
			at(await activityOn(entry.id), 0).id,
		);

		const rows = await db.query.pullRequestEventDetachTombstone.findMany();
		expect(rows.map((row) => [row.userId, row.eventId, row.date])).toEqual([
			[USER_ID, "PR_7:opened", YESTERDAY],
		]);
	});

	test("does not touch the same event of another person", async () => {
		const entry = await syncedEntry([
			{ day: YESTERDAY, number: 7, kind: "opened" },
		]);
		await githubService.detachPullRequestActivity(
			ctx,
			at(await activityOn(entry.id), 0).id,
		);
		await integrationSettingsService.update(otherCtx, {
			githubSyncCommitsAsWorkTime: true,
		});
		await db
			.update(integrationSettings)
			.set({
				githubSyncCommitsAsWorkTimeSince: new Date("2026-08-01T00:00:00.000Z"),
			})
			.where(eq(integrationSettings.userId, OTHER_USER_ID));

		await timeEntriesService.runAutomationsForUser(otherCtx, {
			now: new Date(`${TODAY}T12:00:00.000Z`),
		});

		const rows = await allActivity();
		expect(rows.map((row) => row.eventId)).toEqual(["PR_7:opened"]);
		const owner = await db.query.timeEntry.findFirst({
			where: eq(timeEntry.id, at(rows, 0).timeEntryId),
		});
		expect(owner?.userId).toBe(OTHER_USER_ID);
	});

	test("is dropped once its day leaves the window", async () => {
		await db.insert(pullRequestEventDetachTombstone).values([
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				eventId: "PR_1:opened",
				date: "2026-07-01",
			},
			{
				organizationId: ORG_ID,
				userId: USER_ID,
				eventId: "PR_2:opened",
				date: YESTERDAY,
			},
		]);
		setPullRequestSourceForTests(pullRequestsFor([]));

		await runAutomations();

		const left = await db.query.pullRequestEventDetachTombstone.findMany();
		expect(left.map((row) => row.eventId)).toEqual(["PR_2:opened"]);
	});

	/** Attach pull request 7 by hand, as the entry dialog does. */
	const attachNow = (timeEntryId: string) => {
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getAuthenticatedUser: async () => ({ id: 1, login: "tester" }),
			getPullRequest: async () => ({
				id: "PR_7",
				number: 7,
				title: "Change 7",
				url: "https://github.com/profico/repo/pull/7",
				createdAt: `${YESTERDAY}T12:00:00.000Z`,
				closedAt: null,
				mergedAt: null,
				merged: false,
				state: "OPEN",
				author: { login: "tester" },
				reviews: { nodes: [] },
			}),
			listInstallationRepos: async () => [],
		});
		return githubService.attachPullRequests(ctx, {
			timeEntryId,
			pullRequests: [{ projectGithubRepoId: repoId, number: 7 }],
		});
	};

	test("moved by hand to another entry, stays off the first", async () => {
		const entry = await syncedEntry([
			{ day: YESTERDAY, number: 7, kind: "opened" },
		]);
		await githubService.detachPullRequestActivity(
			ctx,
			at(await activityOn(entry.id), 0).id,
		);
		const other = await addEntry({ date: YESTERDAY, durationSeconds: 60 * 60 });

		await attachNow(other.id);
		await runAutomations();

		expect((await allActivity()).map((row) => row.timeEntryId)).toEqual([
			other.id,
		]);
		// The hand attach does not take the "no" back.
		expect(
			await db.query.pullRequestEventDetachTombstone.findMany(),
		).toHaveLength(1);
	});

	test("attached by hand to its old entry, is not added twice", async () => {
		const entry = await syncedEntry([
			{ day: YESTERDAY, number: 7, kind: "opened" },
		]);
		await githubService.detachPullRequestActivity(
			ctx,
			at(await activityOn(entry.id), 0).id,
		);

		await attachNow(entry.id);
		await runAutomations();

		expect((await allActivity()).map((row) => row.timeEntryId)).toEqual([
			entry.id,
		]);
	});

	test("already attached by hand to one entry, is not copied to another", async () => {
		const other = await addEntry({ date: YESTERDAY, durationSeconds: 60 * 60 });
		await attachNow(other.id);

		await syncedEntry([{ day: YESTERDAY, number: 7, kind: "opened" }]);

		expect((await allActivity()).map((row) => row.timeEntryId)).toEqual([
			other.id,
		]);
	});
});

// With a Code Review task, a detached review must not come back as a block or
// as evidence on the day's work.
describe("a detached review", () => {
	beforeEach(async () => {
		await setReviewTaskLive(true);
	});

	test("does not come back as evidence once its review block is detached", async () => {
		setPullRequestSourceForTests(
			pullRequestsFor([{ day: YESTERDAY, number: 7, kind: "reviewed" }]),
		);
		await runAutomations();
		const block = present(
			(await entriesOn(YESTERDAY)).find(
				(entry) => entry.taskId === reviewTaskId,
			),
			"the review block",
		);
		const [review] = await activityOn(block.id);

		await githubService.detachPullRequestActivity(
			ctx,
			present(review, "the attached review").id,
		);
		await runAutomations();

		expect(await db.query.timeEntryGithubPrActivity.findMany()).toEqual([]);
		// The block tombstone is kept as well: no second block for that pull request.
		expect(await db.query.pullRequestReviewTombstone.findMany()).toHaveLength(
			1,
		);
	});
});
