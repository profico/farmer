// The assistant's unlink tools and the reads that feed them.
//
// `detachCommit` is tested by the people who call it. What is new is the
// tool around it: a batch that reports each id, a read that returns the ids
// the write needs, and tenancy that holds when the model sends an id it
// should not have.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

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
	projectGithubRepo,
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { findTool } from "./assistant-tools";
import type { Ctx } from "./types";

const ORG = "org-unlink";
const OTHER_ORG = "org-unlink-other";
const ME = "user-unlink-me";
const COLLEAGUE = "user-unlink-colleague";
const STRANGER = "user-unlink-stranger";

const ctx = (): Ctx => ({ organizationId: ORG, userId: ME });

let harness: TestDb;
let myCommitIds: string[] = [];
let farmerCommitIds: string[] = [];
let colleagueCommitId = "";
let strangerCommitId = "";
let prActivityIds: string[] = [];
let strangerActivityId = "";

const tool = (name: string) => present(findTool(name), `tool ${name}`);

const commitList = z.object({
	truncated: z.boolean(),
	commits: z.array(
		z.object({
			attachmentId: z.string(),
			message: z.string(),
			repository: z.string().nullable(),
		}),
	),
});
const activityList = z.object({
	activity: z.array(z.object({ activityId: z.string() })),
});
const unlinkResult = z.object({
	unlinked: z.number(),
	failed: z.number(),
	results: z.array(
		z.object({
			attachmentId: z.string().optional(),
			activityId: z.string().optional(),
			unlinked: z.boolean(),
			error: z.string().optional(),
		}),
	),
});

const seedOrg = async (orgId: string, userId: string, repoName: string) => {
	await db.insert(organization).values({
		id: orgId,
		name: orgId,
		slug: orgId,
		createdAt: new Date(),
	});
	await db.insert(user).values({
		id: userId,
		name: userId,
		email: `${userId}@example.com`,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: `member-${userId}`,
		organizationId: orgId,
		userId,
		role: "member",
		createdAt: new Date(),
	});
	const acme = at(
		await db
			.insert(client)
			.values({ organizationId: orgId, name: "Acme" })
			.returning(),
		0,
	);
	const proj = at(
		await db
			.insert(project)
			.values({ organizationId: orgId, clientId: acme.id, name: "P" })
			.returning(),
		0,
	);
	await db
		.insert(projectMember)
		.values({ organizationId: orgId, projectId: proj.id, userId });
	const dev = at(
		await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: orgId,
				name: "Development",
				isAbsence: false,
			})
			.returning(),
		0,
	);
	return { proj, dev, repoName };
};

const seedRepo = async (
	orgId: string,
	projectId: string,
	githubRepoId: number,
	owner: string,
	name: string,
) =>
	at(
		await db
			.insert(projectGithubRepo)
			.values({
				organizationId: orgId,
				projectId,
				githubRepoId,
				installationId: 1,
				owner,
				name,
				fullName: `${owner}/${name}`,
			})
			.returning(),
		0,
	);

const seedEntry = async (
	orgId: string,
	userId: string,
	projectId: string,
	taskId: string,
	date: string,
) =>
	at(
		await db
			.insert(timeEntry)
			.values({
				organizationId: orgId,
				userId,
				projectId,
				taskId,
				date,
				durationSeconds: 3600,
				description: "",
			})
			.returning(),
		0,
	);

const seedCommits = async (
	timeEntryId: string,
	repoId: string,
	count: number,
	prefix: string,
) => {
	const rows = await db
		.insert(timeEntryGithubCommit)
		.values(
			Array.from({ length: count }, (_, index) => ({
				timeEntryId,
				projectGithubRepoId: repoId,
				sha: `${prefix}${String(index).padStart(7, "0")}`,
				message: `Commit ${prefix}${index}\n\nA long body.`,
				committedAt: new Date(`2026-10-06T${10 + index}:00:00Z`),
				url: "https://github.com/x/y/commit/z",
			})),
		)
		.returning();
	return rows.map((row) => row.id);
};

const exists = async (id: string) =>
	(
		await db
			.select({ id: timeEntryGithubCommit.id })
			.from(timeEntryGithubCommit)
			.where(eq(timeEntryGithubCommit.id, id))
	).length > 0;

beforeAll(async () => {
	harness = await createTestDb();

	const mine = await seedOrg(ORG, ME, "farmer");
	await db.insert(user).values({
		id: COLLEAGUE,
		name: COLLEAGUE,
		email: `${COLLEAGUE}@example.com`,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: `member-${COLLEAGUE}`,
		organizationId: ORG,
		userId: COLLEAGUE,
		role: "member",
		createdAt: new Date(),
	});
	const farmer = await seedRepo(ORG, mine.proj.id, 1, "profico", "farmer");
	const other = await seedRepo(ORG, mine.proj.id, 2, "profico", "other");

	const day = await seedEntry(ORG, ME, mine.proj.id, mine.dev.id, "2026-10-06");
	farmerCommitIds = await seedCommits(day.id, farmer.id, 3, "aaaa");
	const otherRepoIds = await seedCommits(day.id, other.id, 1, "bbbb");
	myCommitIds = [...farmerCommitIds, ...otherRepoIds];
	// Outside the date span the tests ask for.
	const old = await seedEntry(ORG, ME, mine.proj.id, mine.dev.id, "2026-08-01");
	await seedCommits(old.id, farmer.id, 1, "cccc");

	prActivityIds = (
		await db
			.insert(timeEntryGithubPrActivity)
			.values(
				[1, 2].map((number) => ({
					timeEntryId: day.id,
					projectGithubRepoId: farmer.id,
					eventId: `evt-${number}`,
					kind: "opened" as const,
					number,
					title: `PR ${number}`,
					pullRequestUrl: `https://github.com/profico/farmer/pull/${number}`,
					url: `https://github.com/profico/farmer/pull/${number}`,
					occurredAt: new Date("2026-10-06T12:00:00Z"),
				})),
			)
			.returning()
	).map((row) => row.id);

	// A colleague in the same organization.
	const theirs = await seedEntry(
		ORG,
		COLLEAGUE,
		mine.proj.id,
		mine.dev.id,
		"2026-10-06",
	);
	colleagueCommitId = at(await seedCommits(theirs.id, farmer.id, 1, "dddd"), 0);

	// A stranger in another organization.
	const away = await seedOrg(OTHER_ORG, STRANGER, "away");
	const awayRepo = await seedRepo(OTHER_ORG, away.proj.id, 3, "x", "away");
	const awayEntry = await seedEntry(
		OTHER_ORG,
		STRANGER,
		away.proj.id,
		away.dev.id,
		"2026-10-06",
	);
	strangerCommitId = at(
		await seedCommits(awayEntry.id, awayRepo.id, 1, "eeee"),
		0,
	);
	strangerActivityId = at(
		await db
			.insert(timeEntryGithubPrActivity)
			.values({
				timeEntryId: awayEntry.id,
				projectGithubRepoId: awayRepo.id,
				eventId: "evt-away",
				kind: "opened" as const,
				number: 9,
				title: "Away",
				pullRequestUrl: "https://github.com/x/away/pull/9",
				url: "https://github.com/x/away/pull/9",
				occurredAt: new Date("2026-10-06T12:00:00Z"),
			})
			.returning(),
		0,
	).id;
});

afterAll(async () => {
	await harness.close();
});

const range = { from: "2026-10-01", to: "2026-10-07" };

describe("list_attached_commits", () => {
	test("returns the attachment ids for the span, not the old ones", async () => {
		const result = commitList.parse(
			await tool("list_attached_commits").run(ctx(), range),
		);
		expect(result.truncated).toBe(false);
		expect(result.commits.map((c) => c.attachmentId).sort()).toEqual(
			[...myCommitIds].sort(),
		);
		// First line only, and never a colleague's commit.
		expect(result.commits.every((c) => !c.message.includes("\n"))).toBe(true);
		expect(
			result.commits.some((c) => c.attachmentId === colleagueCommitId),
		).toBe(false);
	});

	test("keeps one repository, whatever its case", async () => {
		const result = commitList.parse(
			await tool("list_attached_commits").run(ctx(), {
				...range,
				repository: "Profico/FARMER",
			}),
		);
		expect(result.commits.map((c) => c.attachmentId).sort()).toEqual(
			[...farmerCommitIds].sort(),
		);
	});
});

describe("unlink_commits", () => {
	test("is destructive, so the assistant asks first", () => {
		expect(tool("unlink_commits").kind).toBe("destructive");
		expect(tool("unlink_pull_requests").kind).toBe("destructive");
	});

	test("refuses an empty list and a list over the cap", () => {
		expect(
			tool("unlink_commits").schema.safeParse({ attachmentIds: [] }).success,
		).toBe(false);
		const many = Array.from({ length: 101 }, () => crypto.randomUUID());
		expect(
			tool("unlink_commits").schema.safeParse({ attachmentIds: many }).success,
		).toBe(false);
	});

	test("reports another user's, another org's and a missing id, and leaves them", async () => {
		const missing = crypto.randomUUID();
		const result = unlinkResult.parse(
			await tool("unlink_commits").run(ctx(), {
				attachmentIds: [colleagueCommitId, strangerCommitId, missing],
			}),
		);
		expect(result.unlinked).toBe(0);
		expect(result.failed).toBe(3);
		for (const row of result.results) {
			expect(row.unlinked).toBe(false);
			expect(row.error).toBe("Commit attachment not found");
		}
		expect(await exists(colleagueCommitId)).toBe(true);
		expect(await exists(strangerCommitId)).toBe(true);
	});

	test("unlinks the good ids and reports the bad one beside them", async () => {
		const missing = crypto.randomUUID();
		const first = at(farmerCommitIds, 0);
		const second = at(farmerCommitIds, 1);
		const result = unlinkResult.parse(
			await tool("unlink_commits").run(ctx(), {
				attachmentIds: [first, missing, second, first],
			}),
		);
		expect(result.unlinked).toBe(2);
		expect(result.failed).toBe(1);
		expect(await exists(first)).toBe(false);
		expect(await exists(second)).toBe(false);
		// The rest of the session is untouched, and the entry stays.
		expect(await exists(at(farmerCommitIds, 2))).toBe(true);
		const entries = await db.select().from(timeEntry);
		expect(entries.length).toBe(4);
	});

	test("the list no longer returns an unlinked commit", async () => {
		const result = commitList.parse(
			await tool("list_attached_commits").run(ctx(), range),
		);
		expect(result.commits.map((c) => c.attachmentId)).not.toContain(
			at(farmerCommitIds, 0),
		);
	});

	test("the approval preview names the commits and honours unticking", async () => {
		const ids = [at(farmerCommitIds, 2), at(myCommitIds, 3)];
		const preview = present(
			await tool("unlink_commits").preview?.(ctx(), { attachmentIds: ids }),
			"preview",
		);
		expect(preview.rows.map((row) => row.id).sort()).toEqual([...ids].sort());
		const kept = tool("unlink_commits").withSelection?.(
			{ attachmentIds: ids },
			new Set([at(ids, 0)]),
		);
		expect(kept).toEqual({ attachmentIds: [at(ids, 1)] });
	});
});

describe("the pull request pair", () => {
	test("list_attached_pull_requests returns the activity ids", async () => {
		const result = activityList.parse(
			await tool("list_attached_pull_requests").run(ctx(), range),
		);
		expect(result.activity.map((a) => a.activityId).sort()).toEqual(
			[...prActivityIds].sort(),
		);
	});

	test("unlink_pull_requests refuses another org's id and unlinks the rest", async () => {
		const result = unlinkResult.parse(
			await tool("unlink_pull_requests").run(ctx(), {
				activityIds: [at(prActivityIds, 0), strangerActivityId],
			}),
		);
		expect(result.unlinked).toBe(1);
		expect(result.failed).toBe(1);
		expect(
			present(
				result.results.find((row) => row.activityId === strangerActivityId),
				"stranger result",
			).error,
		).toBe("Pull request activity not found");
		const left = await db.select().from(timeEntryGithubPrActivity);
		expect(left.map((row) => row.id)).toContain(strangerActivityId);
		expect(left.map((row) => row.id)).not.toContain(at(prActivityIds, 0));
	});
});
