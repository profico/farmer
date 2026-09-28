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
	GithubInstallationGoneError,
	GithubTokenInvalidError,
} from "../lib/github-client";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
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
	// The user-token paths go through better-auth's getAccessToken, which
	// needs a registered GitHub provider. The auth instance registers one
	// only when the settings hold its credentials, and CI has none.
	setInstanceSettingsForTests({
		GITHUB_CLIENT_ID: "test-client-id",
		GITHUB_CLIENT_SECRET: "test-client-secret",
	});
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
	setInstanceSettingsForTests(undefined);
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
				return { id: 1, login: "tester" };
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
		await githubService.disconnectInstallation(adminCtx(), {
			installationRowId: row.id,
			uninstall: false,
		});
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

// Disconnecting is two acts, and the second one is not this org's to spend on
// its own: it removes the App from a GitHub account that another workspace on
// the same deployment may also be reading. The local half must land whatever
// GitHub says, or a refused uninstall leaves an admin still connected to an
// installation they just disconnected.
describe("disconnecting an installation", () => {
	/** A second workspace on the same deployment, for the cases where one GitHub
	 *  installation is connected to more than one of them. */
	const SECOND_ORG_ID = "org-github-second";
	let uninstalled: number[] = [];
	let failing = false;

	const connect = async (organizationId: string, installationId: number) => {
		const [row] = await db
			.insert(orgGithubInstallation)
			.values({
				organizationId,
				installationId,
				accountLogin: "profico",
				accountType: "Organization",
			})
			.returning({ id: orgGithubInstallation.id });
		return present(row, "the connected installation").id;
	};

	beforeAll(async () => {
		await db.insert(organization).values({
			id: SECOND_ORG_ID,
			name: "A second workspace",
			slug: SECOND_ORG_ID,
			createdAt: new Date(),
		});
		// The App's credentials, so the service gets past `isGithubAppConfigured`
		// to the seam below. The seam is what actually answers.
		process.env.GITHUB_APP_ID = "12345";
		process.env.GITHUB_APP_PRIVATE_KEY = "not-a-real-key";
	});

	afterAll(async () => {
		await db.delete(orgGithubInstallation);
		// `delete`, not `= undefined`: assigning undefined to a process.env slot
		// stores the STRING "undefined", which reads as configured.
		delete process.env.GITHUB_APP_ID;
		delete process.env.GITHUB_APP_PRIVATE_KEY;
		setGithubClientForTests(null);
	});

	beforeEach(async () => {
		await db.delete(orgGithubInstallation);
		uninstalled = [];
		failing = false;
		setGithubClientForTests({
			deleteInstallation: async (installationId: number) => {
				if (failing) throw new Error("GitHub is down");
				uninstalled.push(installationId);
				return true;
			},
		});
	});

	test("leaves the app installed when nobody asked for it", async () => {
		const rowId = await connect(ORG_ID, 200);
		const result = await githubService.disconnectInstallation(adminCtx(), {
			installationRowId: rowId,
			uninstall: false,
		});
		expect(result.uninstall).toBe("not-requested");
		expect(uninstalled).toEqual([]);
	});

	test("uninstalls from GitHub when it is asked for", async () => {
		const rowId = await connect(ORG_ID, 201);
		const result = await githubService.disconnectInstallation(adminCtx(), {
			installationRowId: rowId,
			uninstall: true,
		});
		expect(result.uninstall).toBe("uninstalled");
		expect(uninstalled).toEqual([201]);
		expect(
			await db.query.orgGithubInstallation.findFirst({
				where: eq(orgGithubInstallation.id, rowId),
			}),
		).toBeUndefined();
	});

	test("keeps the app installed while another workspace is connected", async () => {
		const rowId = await connect(ORG_ID, 202);
		await connect(SECOND_ORG_ID, 202);

		const result = await githubService.disconnectInstallation(adminCtx(), {
			installationRowId: rowId,
			uninstall: true,
		});
		expect(result.uninstall).toBe("shared");
		expect(uninstalled).toEqual([]);
		// This workspace is still disconnected — the other one is untouched.
		const left = await db.query.orgGithubInstallation.findMany({
			where: eq(orgGithubInstallation.installationId, 202),
		});
		expect(left.map((r) => r.organizationId)).toEqual([SECOND_ORG_ID]);
	});

	test("disconnects anyway, and says so, when GitHub refuses", async () => {
		const rowId = await connect(ORG_ID, 203);
		failing = true;

		const result = await githubService.disconnectInstallation(adminCtx(), {
			installationRowId: rowId,
			uninstall: true,
		});
		expect(result.uninstall).toBe("failed");
		expect(
			await db.query.orgGithubInstallation.findFirst({
				where: eq(orgGithubInstallation.id, rowId),
			}),
		).toBeUndefined();
	});

	test("refuses a member, who cannot disconnect at all", async () => {
		const rowId = await connect(ORG_ID, 204);
		await expect(
			githubService.disconnectInstallation(memberCtx(), {
				installationRowId: rowId,
				uninstall: true,
			}),
		).rejects.toThrow(AccessError);
		expect(uninstalled).toEqual([]);
	});

	test("another org's row is not this admin's to disconnect", async () => {
		const rowId = await connect(SECOND_ORG_ID, 205);
		const result = await githubService.disconnectInstallation(adminCtx(), {
			installationRowId: rowId,
			uninstall: true,
		});
		expect(result.uninstall).toBe("not-requested");
		expect(uninstalled).toEqual([]);
		expect(
			await db.query.orgGithubInstallation.findFirst({
				where: eq(orgGithubInstallation.id, rowId),
			}),
		).toBeDefined();
	});

	// The webhook's half: uninstalled on GitHub rather than here. Every
	// workspace's row goes, because the installation they all name is gone.
	test("forgetInstallation drops the row in every workspace", async () => {
		await connect(ORG_ID, 206);
		await connect(SECOND_ORG_ID, 206);
		await connect(ORG_ID, 207);

		expect(await githubService.forgetInstallation(206)).toBe(2);
		const left = await db.query.orgGithubInstallation.findMany({});
		expect(left.map((r) => r.installationId)).toEqual([207]);
	});

	test("forgetInstallation on an installation nobody connected is a no-op", async () => {
		expect(await githubService.forgetInstallation(999)).toBe(0);
	});
});

// An installation's id does not survive a reinstall, and
// `projectGithubRepo.installationId` is frozen at link time. Forgetting the
// installation used to drop only the `orgGithubInstallation` row, which left
// every repo naming an id GitHub no longer knows: a 404 on each token mint,
// reported to the caller as "no commits" and unfixable by reconnecting,
// because connecting writes a new row rather than repairing old ones.
describe("a repo left naming a dead installation", () => {
	const DEAD = 160881810;
	const LIVE = 160881740;

	const connect = async (installationId: number, accountLogin: string) => {
		await db.insert(orgGithubInstallation).values({
			organizationId: ORG_ID,
			installationId,
			accountLogin,
			accountType: "Organization",
		});
	};

	const boundTo = async () =>
		present(
			await db.query.projectGithubRepo.findFirst({
				where: eq(projectGithubRepo.id, ownRepoId),
			}),
			"the caller's repo",
		).installationId;

	/** Any read that goes through `reposForUser`. */
	const readSomething = () =>
		githubService.attachCommits(memberCtx(), {
			timeEntryId: entryId,
			commits: [{ projectGithubRepoId: ownRepoId, sha: SHA }],
		});

	beforeEach(async () => {
		await db.delete(orgGithubInstallation);
		await db.delete(timeEntryGithubCommit);
		await db
			.update(projectGithubRepo)
			.set({ installationId: DEAD })
			.where(eq(projectGithubRepo.organizationId, ORG_ID));
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getCommit: async (_token, _owner, _repo, sha) => fakeCommit(sha),
			listInstallationRepos: async () => [],
		});
	});

	afterAll(async () => {
		await db.delete(orgGithubInstallation);
		await db
			.update(projectGithubRepo)
			.set({ installationId: 100 })
			.where(eq(projectGithubRepo.organizationId, ORG_ID));
		setGithubClientForTests(null);
	});

	// The webhook's half: the admin removed the App and installed it again, so
	// the org holds both ids for the moment `installation.deleted` arrives.
	test("forgetInstallation moves them to the installation that replaced it", async () => {
		await connect(DEAD, "profico");
		await connect(LIVE, "profico");

		expect(await githubService.forgetInstallation(DEAD)).toBe(1);
		expect(await boundTo()).toBe(LIVE);
	});

	// The deployment this was found on: the dead row was already gone, so there
	// was no webhook left to repair anything. A read has to be enough.
	test("a read repairs rows the webhook never covered", async () => {
		await connect(LIVE, "profico");

		await readSomething();
		expect(await boundTo()).toBe(LIVE);
	});

	// The id is the only record of which install a repo was linked under, and an
	// org holding no row for it is not proof that GitHub lost the installation.
	test("a repo whose owner has no installation keeps the id it was linked under", async () => {
		await connect(LIVE, "some-other-account");

		await readSomething();
		expect(await boundTo()).toBe(DEAD);
	});

	// A webhook can be missed. GitHub answering 404 to the token mint says the
	// same thing, and is the only proof that arrives on its own.
	test("a 404 on the token mint stands in for the webhook that never arrived", async () => {
		await connect(DEAD, "profico");
		await connect(LIVE, "profico");
		setGithubClientForTests({
			getAuthenticatedUser: async () => ({ id: 1, login: "a-member" }),
			getInstallationToken: async (installationId: number) => {
				if (installationId === DEAD) {
					throw new GithubInstallationGoneError(DEAD);
				}
				return "installation-token";
			},
			listCommits: async () => [],
		});

		await githubService.listUserCommitsByDay(memberCtx(), {
			from: "2026-09-01",
			to: "2026-09-02",
		});

		expect(
			await db.query.orgGithubInstallation.findFirst({
				where: eq(orgGithubInstallation.installationId, DEAD),
			}),
		).toBeUndefined();
		expect(await boundTo()).toBe(LIVE);
	});
});

// The project's linked repos name private repositories, so reading them is the
// same line as tracking on the project: Admin, an assignment, or an open project.
describe("listLinkedRepos", () => {
	const projectNamed = async (name: string) =>
		present(
			await db.query.project.findFirst({
				where: eq(project.name, name),
				columns: { id: true },
			}),
			`project ${name}`,
		).id;

	test("an assigned member reads their project's repos", async () => {
		const repos = await githubService.listLinkedRepos(
			memberCtx(),
			await projectNamed("Mine"),
		);
		expect(repos.map((repo) => repo.fullName)).toEqual(["profico/mine"]);
	});

	test("an unassigned member is refused", async () => {
		await expect(
			githubService.listLinkedRepos(
				memberCtx(),
				await projectNamed("Not mine"),
			),
		).rejects.toBeInstanceOf(AccessError);
	});

	// `suggestCommits` needs an assignment, so a repo listed here would open a
	// commit picker that can never fill.
	test("a member on an open project they are not assigned to reads none", async () => {
		const projectId = await projectNamed("Not mine");
		await db
			.update(project)
			.set({ openToOrg: true })
			.where(eq(project.id, projectId));
		try {
			expect(
				await githubService.listLinkedRepos(memberCtx(), projectId),
			).toEqual([]);
		} finally {
			await db
				.update(project)
				.set({ openToOrg: false })
				.where(eq(project.id, projectId));
		}
	});

	test("an admin reads any project's repos", async () => {
		const repos = await githubService.listLinkedRepos(
			adminCtx(),
			await projectNamed("Not mine"),
		);
		expect(repos.map((repo) => repo.fullName)).toEqual(["profico/secret"]);
	});
});

// The commit picker scans with the installation token, so it holds the same
// assignment line as `suggestPullRequests` and `attachCommits`.
describe("suggestCommits", () => {
	/** Every repo `listCommits` was asked about — a refused scan asks none. */
	let scanned: string[] = [];

	const projectNamed = async (name: string) =>
		present(
			await db.query.project.findFirst({
				where: eq(project.name, name),
				columns: { id: true },
			}),
			`project ${name}`,
		).id;

	beforeAll(async () => {
		for (const userId of [MEMBER_ID, ADMIN_ID]) {
			await db
				.insert(account)
				.values({
					id: `account-github-${userId}`,
					accountId: `gh-${userId}`,
					providerId: "github",
					userId,
					accessToken: "user-token",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onConflictDoNothing();
		}
	});

	beforeEach(() => {
		scanned = [];
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getAuthenticatedUser: async () => ({ id: 1, login: "tester" }),
			listCommits: async (_token, owner, repo) => {
				scanned.push(`${owner}/${repo}`);
				return [fakeCommit(SHA)];
			},
			listInstallationRepos: async () => [],
		});
	});

	test("an assigned member gets the commits on their project", async () => {
		const commits = await githubService.suggestCommits(memberCtx(), {
			projectId: await projectNamed("Mine"),
			date: "2026-09-01",
		});
		expect(commits.map((commit) => commit.repoFullName)).toEqual([
			"profico/mine",
		]);
	});

	test("an unassigned member gets nothing, and no repo is read", async () => {
		const commits = await githubService.suggestCommits(memberCtx(), {
			projectId: await projectNamed("Not mine"),
			date: "2026-09-01",
		});
		expect(commits).toEqual([]);
		expect(scanned).toEqual([]);
	});

	// No admin bypass, as with every other commit scan: an admin who is not on
	// the project has no work of theirs to attribute to it.
	test("an unassigned admin gets nothing either", async () => {
		const commits = await githubService.suggestCommits(adminCtx(), {
			projectId: await projectNamed("Not mine"),
			date: "2026-09-01",
		});
		expect(commits).toEqual([]);
		expect(scanned).toEqual([]);
	});
});

// Linking decides which repos a project's members may then read with the
// installation token, so the service holds the admin line itself rather than
// leaving it to the server function's middleware.
describe("linking and unlinking a repo", () => {
	const projectNamed = async (name: string) =>
		present(
			await db.query.project.findFirst({
				where: eq(project.name, name),
				columns: { id: true },
			}),
			`project ${name}`,
		).id;

	test("a member cannot link a repo, even to their own project", async () => {
		await expect(
			githubService.linkRepo(memberCtx(), {
				projectId: await projectNamed("Mine"),
				installationId: 100,
				githubRepoId: 3,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("a member cannot unlink a repo, and the row stays", async () => {
		await expect(
			githubService.unlinkRepo(memberCtx(), ownRepoId),
		).rejects.toBeInstanceOf(AccessError);
		expect(
			await db.query.projectGithubRepo.findFirst({
				where: eq(projectGithubRepo.id, ownRepoId),
			}),
		).toBeDefined();
	});

	test("an admin passes the gate", async () => {
		// Past the admin check, the installation lookup is what answers.
		await expect(
			githubService.linkRepo(adminCtx(), {
				projectId: await projectNamed("Mine"),
				installationId: 999_999,
				githubRepoId: 3,
			}),
		).rejects.toThrow("Installation not connected to this organization");
	});
});

// `GET /user/installations` lists an installation for anybody with read access
// to one repo it covers. That proves the caller can see it, not that they own
// it, and on that check alone an outside collaborator could bind a company's
// installation to a workspace of their own. So the caller must also own the
// account the installation is on.
describe("connecting an installation", () => {
	const INSTALLATION_ID = 300;
	const personal = {
		id: INSTALLATION_ID,
		account: { id: 42, login: "octocat", type: "User" },
	};
	const organizationInstall = {
		id: INSTALLATION_ID,
		account: { id: 99, login: "profico", type: "Organization" },
	};
	/** The caller's own GitHub identity, from `GET /user`. */
	const caller = { id: 42, login: "octocat" };
	/** Every `getOrgMembership` call: the token, the organization and the
	 *  login it was asked about. */
	let membershipsRead: string[] = [];

	const connected = () =>
		db.query.orgGithubInstallation.findMany({
			where: eq(orgGithubInstallation.installationId, INSTALLATION_ID),
		});

	beforeAll(async () => {
		await db
			.insert(account)
			.values({
				id: `account-github-${ADMIN_ID}`,
				accountId: `gh-${ADMIN_ID}`,
				providerId: "github",
				userId: ADMIN_ID,
				accessToken: "user-token",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoNothing();
	});

	beforeEach(async () => {
		await db.delete(orgGithubInstallation);
		membershipsRead = [];
	});

	afterAll(async () => {
		await db.delete(orgGithubInstallation);
	});

	test("the owner of a personal account connects its installation", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [personal],
			getAuthenticatedUser: async () => ({ id: 42, login: "octocat" }),
		});
		await githubService.connectInstallation(adminCtx(), {
			installationId: INSTALLATION_ID,
		});
		const rows = await connected();
		expect(rows.map((r) => [r.organizationId, r.accountLogin])).toEqual([
			[ORG_ID, "octocat"],
		]);
	});

	test("a collaborator on a personal account is refused", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [personal],
			getAuthenticatedUser: async () => ({ id: 7, login: "collaborator" }),
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow(AccessError);
		expect(await connected()).toEqual([]);
	});

	test("an owner of the organization connects its installation", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [organizationInstall],
			getAuthenticatedUser: async () => caller,
			getInstallationToken: async () => "installation-token",
			getOrgMembership: async (token, org, username) => {
				membershipsRead.push(`${token} ${org} ${username}`);
				return { state: "active", role: "admin", user: caller };
			},
		});
		await githubService.connectInstallation(adminCtx(), {
			installationId: INSTALLATION_ID,
		});
		expect(membershipsRead).toEqual(["installation-token profico octocat"]);
		const rows = await connected();
		expect(rows.map((r) => [r.organizationId, r.accountLogin])).toEqual([
			[ORG_ID, "profico"],
		]);
	});

	test("a member of the organization who is not an owner is refused", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [organizationInstall],
			getAuthenticatedUser: async () => caller,
			getInstallationToken: async () => "installation-token",
			getOrgMembership: async () => ({
				state: "active",
				role: "member",
				user: caller,
			}),
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow("Ask an owner to connect it");
		expect(await connected()).toEqual([]);
	});

	test("an owner whose invitation is still pending is refused", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [organizationInstall],
			getAuthenticatedUser: async () => caller,
			getInstallationToken: async () => "installation-token",
			getOrgMembership: async () => ({
				state: "pending",
				role: "admin",
				user: caller,
			}),
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow("Accept your invitation");
		expect(await connected()).toEqual([]);
	});

	// A 403 is what GitHub answers when the App does not hold "Members: read",
	// and the client returns it as null. The refusal names the permission.
	test("a membership GitHub will not show is refused, naming the permission", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [organizationInstall],
			getAuthenticatedUser: async () => caller,
			getInstallationToken: async () => "installation-token",
			getOrgMembership: async () => null,
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow('"Members: read"');
		expect(await connected()).toEqual([]);
	});

	// "Could not check" is not "may connect", and it is not "you are not an
	// owner" either: the sentence says to try again, not to find an owner.
	test("a membership read that fails is refused, asking to try again", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [organizationInstall],
			getAuthenticatedUser: async () => caller,
			getInstallationToken: async () => "installation-token",
			getOrgMembership: async () => {
				throw new Error("GitHub API error 503: /orgs/profico/memberships");
			},
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow("Try again in a few minutes");
		expect(await connected()).toEqual([]);
	});

	// Looked up by login, so the answer must be for the caller's own id: a
	// rename between the two calls would otherwise hand over the login.
	test("a membership of somebody else under the caller's login is refused", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [organizationInstall],
			getAuthenticatedUser: async () => caller,
			getInstallationToken: async () => "installation-token",
			getOrgMembership: async () => ({
				state: "active",
				role: "admin",
				user: { id: 7, login: "octocat" },
			}),
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow(AccessError);
		expect(await connected()).toEqual([]);
	});

	test("an installation missing from the caller's own list is refused", async () => {
		setGithubClientForTests({
			listUserInstallations: async () => [],
			getAuthenticatedUser: async () => ({ id: 42, login: "octocat" }),
		});
		await expect(
			githubService.connectInstallation(adminCtx(), {
				installationId: INSTALLATION_ID,
			}),
		).rejects.toThrow(AccessError);
		expect(await connected()).toEqual([]);
	});
});
