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
import { account, member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import {
	orgGithubInstallation,
	projectGithubRepo,
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import {
	type GithubCommit,
	GithubTokenInvalidError,
} from "../lib/github-client";
import { attachCommitsInput } from "../schema/github";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import {
	githubService,
	setGithubClientForTests,
	settleRepoListRefreshesForTests,
} from "./github.service";
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

// The same gate as attachCommits, for the same reason: `getPullRequest` reads
// with the installation token, so naming a repo is reading it.
describe("attachPullRequests", () => {
	/** Every GitHub call the service made — a refused attach must make none. */
	let asked: string[] = [];

	beforeEach(() => {
		asked = [];
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getAuthenticatedUser: async () => {
				asked.push("user");
				return { login: "tester" };
			},
			getPullRequest: async (_token, _owner, _repo, number) => {
				asked.push(`pr-${number}`);
				return null;
			},
			listInstallationRepos: async () => [],
		});
	});

	const attachedToEntry = () =>
		db.query.timeEntryGithubPrActivity.findMany({
			where: eq(timeEntryGithubPrActivity.timeEntryId, entryId),
		});

	test("refuses a repo on a project the caller is not on, and reads nothing", async () => {
		await expect(
			githubService.attachPullRequests(memberCtx(), {
				timeEntryId: entryId,
				pullRequests: [
					{ projectGithubRepoId: ownRepoId, number: 7 },
					{ projectGithubRepoId: otherRepoId, number: 8 },
				],
			}),
		).rejects.toBeInstanceOf(AccessError);
		expect(asked).toEqual([]);
		expect(await attachedToEntry()).toEqual([]);
	});

	test("refuses an entry that is not the caller's", async () => {
		await expect(
			githubService.attachPullRequests(adminCtx(), {
				timeEntryId: entryId,
				pullRequests: [{ projectGithubRepoId: ownRepoId, number: 7 }],
			}),
		).rejects.toThrow("Time entry not found");
		expect(asked).toEqual([]);
	});
});

describe("projectsForRepository", () => {
	const OTHER_ORG_ID = "org-github-other";
	const OTHER_ORG_ADMIN_ID = "user-github-other-admin";

	beforeAll(async () => {
		// A second project the member is also assigned to, whose linked repo
		// shares a full name with "Mine" — a rename can leave two rows with the
		// same cached name, and the function must return both.
		const acme2 = at(
			await db
				.insert(client)
				.values({ organizationId: ORG_ID, name: "Acme 2" })
				.returning(),
			0,
		);
		const alsoMine = at(
			await db
				.insert(project)
				.values({
					organizationId: ORG_ID,
					clientId: acme2.id,
					name: "Also mine",
				})
				.returning(),
			0,
		);
		await db.insert(projectMember).values({
			organizationId: ORG_ID,
			projectId: alsoMine.id,
			userId: MEMBER_ID,
		});
		await db.insert(projectGithubRepo).values({
			organizationId: ORG_ID,
			projectId: alsoMine.id,
			githubRepoId: 3,
			installationId: 100,
			owner: "profico",
			name: "mine",
			fullName: "profico/mine",
		});

		// A different organization with a project whose linked repo has the same
		// full name — must never leak into this organization's answer.
		await db.insert(organization).values({
			id: OTHER_ORG_ID,
			name: "Other GitHub Org",
			slug: OTHER_ORG_ID,
			createdAt: new Date(),
		});
		await db.insert(user).values({
			id: OTHER_ORG_ADMIN_ID,
			name: OTHER_ORG_ADMIN_ID,
			email: `${OTHER_ORG_ADMIN_ID}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `member-${OTHER_ORG_ADMIN_ID}`,
			organizationId: OTHER_ORG_ID,
			userId: OTHER_ORG_ADMIN_ID,
			role: "owner",
			createdAt: new Date(),
		});
		const otherClient = at(
			await db
				.insert(client)
				.values({ organizationId: OTHER_ORG_ID, name: "Other Acme" })
				.returning(),
			0,
		);
		const otherProject = at(
			await db
				.insert(project)
				.values({
					organizationId: OTHER_ORG_ID,
					clientId: otherClient.id,
					name: "Other org's project",
				})
				.returning(),
			0,
		);
		await db.insert(projectGithubRepo).values({
			organizationId: OTHER_ORG_ID,
			projectId: otherProject.id,
			githubRepoId: 4,
			installationId: 200,
			owner: "profico",
			name: "mine",
			fullName: "profico/mine",
		});
	});

	test("matches case-insensitively", async () => {
		const rows = await githubService.projectsForRepository(
			memberCtx(),
			"PROFICO/Mine",
		);
		expect(rows.some((r) => r.name === "Mine")).toBe(true);
	});

	test("a project in another organization with the same repository name is not returned", async () => {
		const rows = await githubService.projectsForRepository(
			memberCtx(),
			"profico/mine",
		);
		expect(rows.every((r) => r.name !== "Other org's project")).toBe(true);
	});

	test("a project the caller is not assigned to is not returned", async () => {
		const rows = await githubService.projectsForRepository(
			memberCtx(),
			"profico/secret",
		);
		expect(rows).toEqual([]);
	});

	test("a repository linked to two projects returns both", async () => {
		const rows = await githubService.projectsForRepository(
			memberCtx(),
			"profico/mine",
		);
		expect(rows.map((r) => r.name).sort()).toEqual(["Also mine", "Mine"]);
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
		expect(await githubService.listAvailableRepos(adminCtx())).toEqual({
			repos: [],
			fetchedAt: null,
		});
	});
});

// The list is stale-while-revalidate per installation. What is pinned here is
// the trade it makes: how often GitHub is asked, and that nobody is shown less
// than the last good answer while it is being asked again.
describe("the repo list cache", () => {
	const T0 = new Date("2026-09-14T09:00:00Z");
	const minutesIn = (minutes: number) =>
		new Date(T0.getTime() + minutes * 60_000);
	const DAY = 24 * 60;

	let reads = 0;
	let names: string[] = [];
	let failing = false;

	const list = (minutes: number, refresh = false) =>
		githubService.listAvailableRepos(adminCtx(), {
			now: minutesIn(minutes),
			refresh,
		});
	const namesAt = async (minutes: number, refresh = false) =>
		(await list(minutes, refresh)).repos.map((r) => r.fullName);

	beforeAll(async () => {
		await db.insert(orgGithubInstallation).values({
			organizationId: ORG_ID,
			installationId: 100,
			accountLogin: "profico",
			accountType: "Organization",
		});
	});

	afterAll(async () => {
		await db.delete(orgGithubInstallation);
	});

	beforeEach(() => {
		reads = 0;
		names = ["profico/one"];
		failing = false;
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			listInstallationRepos: async () => {
				reads++;
				if (failing) throw new Error("GitHub is down");
				return names.map((fullName, i) => ({
					id: 1000 + i,
					name: fullName,
					full_name: fullName,
					owner: { login: "profico" },
					private: false,
				}));
			},
		});
	});

	test("serves a fresh list without asking GitHub again", async () => {
		expect(await namesAt(0)).toEqual(["profico/one"]);
		names = ["profico/one", "profico/two"];
		expect(await namesAt(4)).toEqual(["profico/one"]);
		expect(reads).toBe(1);
	});

	test("shares one read between callers who ask at once", async () => {
		await Promise.all([list(0), list(0), list(0)]);
		expect(reads).toBe(1);
	});

	test("serves a stale list at once and refreshes it behind the answer", async () => {
		await namesAt(0);
		names = ["profico/one", "profico/two"];

		expect(await namesAt(6)).toEqual(["profico/one"]);
		await settleRepoListRefreshesForTests();
		expect(reads).toBe(2);

		const next = await list(7);
		expect(next.repos.map((r) => r.fullName)).toEqual([
			"profico/one",
			"profico/two",
		]);
		expect(next.fetchedAt).toEqual(minutesIn(6));
		expect(reads).toBe(2);
	});

	test("waits for GitHub once the list is more than a day old", async () => {
		await namesAt(0);
		names = ["profico/two"];
		expect(await namesAt(DAY + 1)).toEqual(["profico/two"]);
		expect(reads).toBe(2);
	});

	test("refresh reads past a fresh list, but not one seconds old", async () => {
		await namesAt(0);
		names = ["profico/two"];
		expect(await namesAt(0.1, true)).toEqual(["profico/one"]);
		expect(reads).toBe(1);
		expect(await namesAt(1, true)).toEqual(["profico/two"]);
		expect(reads).toBe(2);
	});

	test("keeps the last good list, and says how old it is, when GitHub fails", async () => {
		await namesAt(0);
		failing = true;
		const answer = await list(DAY + 1);
		expect(answer.repos.map((r) => r.fullName)).toEqual(["profico/one"]);
		expect(answer.fetchedAt).toEqual(T0);
	});

	test("forgets an installation's list when it is disconnected", async () => {
		await namesAt(0);
		names = ["profico/two"];
		const row = present(
			await db.query.orgGithubInstallation.findFirst({
				where: eq(orgGithubInstallation.organizationId, ORG_ID),
			}),
			"the connected installation",
		);
		await githubService.disconnectInstallation(adminCtx(), row.id);
		await db.insert(orgGithubInstallation).values({
			organizationId: ORG_ID,
			installationId: 100,
			accountLogin: "profico",
			accountType: "Organization",
		});
		expect(await namesAt(1)).toEqual(["profico/two"]);
	});
});

// A revoked or expired OAuth grant is answered 401 for as long as it stays
// revoked, and every read here begins by resolving the caller's login. That
// throw used to leave the automation sweep with a failed engine and a stack
// trace every twenty minutes, for an account that could not have worked either
// way — and nothing anywhere told the person the one thing that ends it.
describe("an OAuth token GitHub refuses", () => {
	beforeAll(async () => {
		await db.insert(account).values({
			id: "account-github-member",
			accountId: "12345",
			providerId: "github",
			userId: MEMBER_ID,
			accessToken: "revoked-token",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	});

	const refuseTheToken = () =>
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getAuthenticatedUser: async () => {
				throw new GithubTokenInvalidError("https://api.github.com/user");
			},
		});

	test("leaves the background reads answering as 'no account linked'", async () => {
		refuseTheToken();
		expect(
			await githubService.listUserCommitsByDay(memberCtx(), {
				from: "2026-09-01",
				to: "2026-09-02",
			}),
		).toEqual([]);
		expect(
			await githubService.listUserCommitsForDay(memberCtx(), "2026-09-01"),
		).toEqual([]);
		expect(
			await githubService.listUserPullRequestActivityForDay(
				memberCtx(),
				"2026-09-01",
			),
		).toEqual([]);
	});

	test("asks the person to reconnect, rather than reporting an outage", async () => {
		refuseTheToken();
		expect(await githubService.connectionStatus(memberCtx())).toEqual({
			connected: true,
			login: null,
			unreachable: false,
			needsReconnect: true,
		});
	});

	test("a failure that is not the token stays an outage to wait out", async () => {
		setGithubClientForTests({
			getAuthenticatedUser: async () => {
				throw new Error("GitHub API error 503: https://api.github.com/user");
			},
		});
		expect(await githubService.connectionStatus(memberCtx())).toEqual({
			connected: true,
			login: null,
			unreachable: true,
			needsReconnect: false,
		});
	});
});
