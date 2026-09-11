// githubService's own checks — the ones that sit between a caller and a call
// to GitHub with the org's installation token.
//
// That token reads every repo the installation covers, so whatever this
// service lets a caller NAME is what the caller gets to read. Two holes were
// exactly that: `attachCommits` accepted any repo in the org as long as the
// time entry was yours, and put a free-string `sha` into the API path; and
// `listAvailableRepos` answered anyone in the org with every repo every
// installation can reach. GitHub itself is answered in memory here through
// `setGithubClientForTests`, so what is under test is only the gatekeeping.

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
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { projectGithubRepo, timeEntryGithubCommit } from "../db/schema/github";
import type { GithubCommit } from "../lib/github-client";
import { attachCommitsInput } from "../schema/github";
import { at, createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { githubService, setGithubClientForTests } from "./github.service";
import type { Ctx } from "./types";

const ORG_ID = "org-github";
const MEMBER_ID = "user-github-member";
const ADMIN_ID = "user-github-admin";
const SHA = "0123456789abcdef0123456789abcdef01234567";

const memberCtx = (): Ctx => ({ organizationId: ORG_ID, userId: MEMBER_ID });
const adminCtx = (): Ctx => ({ organizationId: ORG_ID, userId: ADMIN_ID });

let harness: TestDb;
let ownRepoId: string;
let otherRepoId: string;
let entryId: string;
/** Every sha `getCommit` was asked for — a refused call must not reach it. */
let fetched: string[] = [];

const fakeCommit = (sha: string): GithubCommit => ({
	sha,
	html_url: `https://github.com/profico/repo/commit/${sha}`,
	commit: {
		message: "Fix the thing",
		author: { date: "2026-09-01T10:00:00Z" },
	},
	author: { login: "tester" },
});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "GitHub Org",
		slug: ORG_ID,
		createdAt: new Date(),
	});
	for (const [id, role] of [
		[MEMBER_ID, "member"],
		[ADMIN_ID, "owner"],
	] as const) {
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
			role,
			createdAt: new Date(),
		});
	}

	const acme = at(
		await db
			.insert(client)
			.values({ organizationId: ORG_ID, name: "Acme" })
			.returning(),
		0,
	);
	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG_ID, clientId: acme.id, name: "Mine" },
			{ organizationId: ORG_ID, clientId: acme.id, name: "Not mine" },
		])
		.returning();
	const mine = at(projects, 0);
	const notMine = at(projects, 1);

	// The member is on "Mine" only.
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId: mine.id,
		userId: MEMBER_ID,
	});

	const repos = await db
		.insert(projectGithubRepo)
		.values([
			{
				organizationId: ORG_ID,
				projectId: mine.id,
				githubRepoId: 1,
				installationId: 100,
				owner: "profico",
				name: "mine",
				fullName: "profico/mine",
			},
			{
				organizationId: ORG_ID,
				projectId: notMine.id,
				githubRepoId: 2,
				installationId: 100,
				owner: "profico",
				name: "secret",
				fullName: "profico/secret",
				private: true,
			},
		])
		.returning();
	ownRepoId = at(repos, 0).id;
	otherRepoId = at(repos, 1).id;

	const dev = at(
		await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG_ID,
				name: "Development",
				isAbsence: false,
			})
			.returning(),
		0,
	);
	entryId = at(
		await db
			.insert(timeEntry)
			.values({
				organizationId: ORG_ID,
				userId: MEMBER_ID,
				taskId: dev.id,
				projectId: mine.id,
				date: "2026-09-01",
				durationSeconds: 3600,
				description: "",
			})
			.returning(),
		0,
	).id;
});

beforeEach(async () => {
	fetched = [];
	await db.delete(timeEntryGithubCommit);
	setGithubClientForTests({
		getInstallationToken: async () => "installation-token",
		getCommit: async (_token, _owner, _repo, sha) => {
			fetched.push(sha);
			return fakeCommit(sha);
		},
		listInstallationRepos: async () => [],
	});
});

afterAll(async () => {
	setGithubClientForTests(null);
	await harness.close();
});

describe("attachCommits", () => {
	test("attaches a commit from a repo on a project the caller is on", async () => {
		const attached = await githubService.attachCommits(memberCtx(), {
			timeEntryId: entryId,
			commits: [{ projectGithubRepoId: ownRepoId, sha: SHA }],
		});
		expect(attached.map((row) => row.sha)).toEqual([SHA]);
	});

	test("refuses a repo on a project the caller is not on, and reads nothing", async () => {
		await expect(
			githubService.attachCommits(memberCtx(), {
				timeEntryId: entryId,
				commits: [{ projectGithubRepoId: otherRepoId, sha: SHA }],
			}),
		).rejects.toBeInstanceOf(AccessError);

		// Refused before GitHub was asked: the leak was the READ, not the insert.
		expect(fetched).toEqual([]);
		expect(
			await db.query.timeEntryGithubCommit.findMany({
				where: eq(timeEntryGithubCommit.timeEntryId, entryId),
			}),
		).toEqual([]);
	});

	test("refuses the whole batch when one repo is not the caller's", async () => {
		await expect(
			githubService.attachCommits(memberCtx(), {
				timeEntryId: entryId,
				commits: [
					{ projectGithubRepoId: ownRepoId, sha: SHA },
					{ projectGithubRepoId: otherRepoId, sha: SHA },
				],
			}),
		).rejects.toBeInstanceOf(AccessError);
		expect(fetched).toEqual([]);
	});

	test("rejects a branch name, or a path, where a sha belongs", async () => {
		for (const sha of ["main", "../../../user", "0123456"]) {
			const parsed = attachCommitsInput.safeParse({
				timeEntryId: entryId,
				commits: [{ projectGithubRepoId: ownRepoId, sha }],
			});
			expect(parsed.success).toBe(sha === "0123456");
		}

		// And the service holds the line on its own, for the day-assembly path
		// that reaches it through a schema of its own.
		await expect(
			githubService.attachCommits(memberCtx(), {
				timeEntryId: entryId,
				commits: [{ projectGithubRepoId: ownRepoId, sha: "main" }],
			}),
		).rejects.toThrow("Expected a commit SHA");
		expect(fetched).toEqual([]);
	});
});

describe("listAvailableRepos", () => {
	test("is refused to a non-admin", async () => {
		await expect(githubService.listAvailableRepos(memberCtx())).rejects.toThrow(
			"Admin access required",
		);
	});

	test("answers an admin", async () => {
		// No installation is connected, so the answer is empty — but an answer.
		expect(await githubService.listAvailableRepos(adminCtx())).toEqual([]);
	});
});
