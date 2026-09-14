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
import { member, organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import {
	projectGithubRepo,
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { integrationSettings, orgSettings } from "../db/schema/settings";
import type { PullRequestActivityKind } from "../lib/github-activity";
import { createTestDb, present, type TestDb } from "../test/harness";
import type { ScannedPullRequestActivity } from "./github.service";
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

let harness: TestDb;
let devTaskId: string;
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

type FakeEvent = { day: string; number: number; kind: PullRequestActivityKind };

const event = ({
	day,
	number,
	kind,
}: FakeEvent): ScannedPullRequestActivity => ({
	eventId: `PR_${String(number)}:${kind}`,
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

const addEntry = async (values: {
	date: string;
	projectId?: string | null;
	durationSeconds: number;
	description?: string;
}) => {
	const [row] = await db
		.insert(timeEntry)
		.values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId: values.projectId ?? null,
			date: values.date,
			durationSeconds: values.durationSeconds,
			description: values.description ?? "",
		})
		.returning();
	return present(row, "the fixture entry");
};

beforeAll(async () => {
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
	setCommitSourceForTests(null);
	setPullRequestSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
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

describe("pull request events in the commit engine", () => {
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
