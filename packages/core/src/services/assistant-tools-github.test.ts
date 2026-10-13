// The assistant's GitHub tools: repos, sync settings and suggestions.
//
// Each tool is an adapter onto `githubService` or `integrationSettingsService`,
// and those have their own tests. What is under test here is the adapter: what
// it hands the model, whose data it reads, and what the approval card says
// before a write runs. GitHub itself is answered in memory.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
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
} from "../db/schema/github";
import { integrationSettings } from "../db/schema/settings";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { Access, AccessError } from "./access.service";
import { findTool, toolsFor } from "./assistant-tools";
import { setGithubClientForTests } from "./github.service";
import type { Ctx } from "./types";

const ORG = "org-ast-github";
const OTHER_ORG = "org-ast-github-other";
const ADMIN = "user-ast-github-admin";
const MEMBER = "user-ast-github-member";
const BYSTANDER = "user-ast-github-bystander";
const STRANGER = "user-ast-github-stranger";
const SHA = "0123456789abcdef0123456789abcdef01234567";

const ctxOf = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});

const tool = (name: string) => present(findTool(name), `tool ${name}`);

let harness: TestDb;
let mineProjectId = "";
let otherProjectId = "";
let mineRepoRowId = "";
let otherRepoRowId = "";
let awayProjectId = "";
let awayRepoRowId = "";
let entryAId = "";
let entryBId = "";
let colleagueEntryId = "";

const seedUser = async (id: string, organizationId: string, role: string) => {
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
		organizationId,
		userId: id,
		role,
		createdAt: new Date(),
	});
};

const accessFor = (isAdmin: boolean) =>
	new Access("u-1", "org-1", isAdmin, new Map());

beforeAll(async () => {
	// The user-token paths go through better-auth, which registers GitHub only
	// when the settings hold credentials.
	setInstanceSettingsForTests({
		GITHUB_CLIENT_ID: "test-client-id",
		GITHUB_CLIENT_SECRET: "test-client-secret",
	});
	harness = await createTestDb();

	for (const [id, name] of [
		[ORG, "Github tools"],
		[OTHER_ORG, "Away"],
	] as const) {
		await db
			.insert(organization)
			.values({ id, name, slug: id, createdAt: new Date() });
	}
	await seedUser(ADMIN, ORG, "owner");
	await seedUser(MEMBER, ORG, "member");
	await seedUser(BYSTANDER, ORG, "member");
	await seedUser(STRANGER, OTHER_ORG, "owner");

	const acme = at(
		await db
			.insert(client)
			.values({ organizationId: ORG, name: "Acme" })
			.returning(),
		0,
	);
	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG, clientId: acme.id, name: "Mine" },
			{ organizationId: ORG, clientId: acme.id, name: "Not mine" },
		])
		.returning();
	mineProjectId = at(projects, 0).id;
	otherProjectId = at(projects, 1).id;
	await db.insert(projectMember).values({
		organizationId: ORG,
		projectId: mineProjectId,
		userId: MEMBER,
	});

	const repos = await db
		.insert(projectGithubRepo)
		.values([
			{
				organizationId: ORG,
				projectId: mineProjectId,
				githubRepoId: 1,
				installationId: 100,
				owner: "profico",
				name: "mine",
				fullName: "profico/mine",
			},
			{
				organizationId: ORG,
				projectId: otherProjectId,
				githubRepoId: 2,
				installationId: 100,
				owner: "profico",
				name: "secret",
				fullName: "profico/secret",
				private: true,
			},
		])
		.returning();
	mineRepoRowId = at(repos, 0).id;
	otherRepoRowId = at(repos, 1).id;
	await db.insert(orgGithubInstallation).values({
		organizationId: ORG,
		installationId: 100,
		accountLogin: "profico",
		accountType: "Organization",
	});

	// Another organization, with a repo of its own.
	const awayClient = at(
		await db
			.insert(client)
			.values({ organizationId: OTHER_ORG, name: "Away client" })
			.returning(),
		0,
	);
	awayProjectId = at(
		await db
			.insert(project)
			.values({
				organizationId: OTHER_ORG,
				clientId: awayClient.id,
				name: "Away",
			})
			.returning(),
		0,
	).id;
	awayRepoRowId = at(
		await db
			.insert(projectGithubRepo)
			.values({
				organizationId: OTHER_ORG,
				projectId: awayProjectId,
				githubRepoId: 9,
				installationId: 900,
				owner: "away",
				name: "away",
				fullName: "away/away",
			})
			.returning(),
		0,
	).id;

	// A GitHub account for the two people who read their own commits.
	for (const userId of [MEMBER, BYSTANDER]) {
		await db.insert(account).values({
			id: `account-github-${userId}`,
			accountId: `gh-${userId}`,
			providerId: "github",
			userId,
			accessToken: "user-token",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	const dev = at(
		await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				isAbsence: false,
			})
			.returning(),
		0,
	);
	const entry = async (userId: string) =>
		at(
			await db
				.insert(timeEntry)
				.values({
					organizationId: ORG,
					userId,
					taskId: dev.id,
					projectId: mineProjectId,
					date: "2026-09-01",
					durationSeconds: 3600,
					description: "",
				})
				.returning(),
			0,
		).id;
	entryAId = await entry(MEMBER);
	entryBId = await entry(MEMBER);
	colleagueEntryId = await entry(BYSTANDER);
	for (const [entryId, sha] of [
		[entryAId, "a".repeat(40)],
		[entryBId, "b".repeat(40)],
		[colleagueEntryId, "c".repeat(40)],
	] as const) {
		await db.insert(timeEntryGithubCommit).values({
			timeEntryId: entryId,
			projectGithubRepoId: mineRepoRowId,
			sha,
			message: `Commit ${sha.slice(0, 3)}\n\nA long body.`,
			committedAt: new Date("2026-09-01T10:00:00Z"),
			url: "https://github.com/profico/mine/commit/x",
		});
	}
});

afterAll(async () => {
	setGithubClientForTests(null);
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

const fakeRepo = (id: number, name: string) => ({
	id,
	name,
	full_name: `profico/${name}`,
	private: false,
	owner: { login: "profico" },
});

describe("list_linked_github_repos", () => {
	test("is a read that names the repo row other tools take", async () => {
		expect(tool("list_linked_github_repos").kind).toBe("read");
		const rows = await tool("list_linked_github_repos").run(ctxOf(MEMBER), {
			projectId: mineProjectId,
		});
		expect(rows).toEqual([
			{
				projectGithubRepoId: mineRepoRowId,
				repository: "profico/mine",
				private: false,
			},
		]);
	});

	test("refuses a project the member cannot work on", async () => {
		await expect(
			tool("list_linked_github_repos").run(ctxOf(MEMBER), {
				projectId: otherProjectId,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("shows nothing of another organization's project", async () => {
		const rows = await tool("list_linked_github_repos").run(
			ctxOf(STRANGER, OTHER_ORG),
			{ projectId: mineProjectId },
		);
		expect(rows).toEqual([]);
	});
});

describe("list_available_github_repos", () => {
	const result = z.object({
		total: z.number(),
		truncated: z.boolean(),
		repos: z.array(
			z.object({
				githubRepoId: z.number(),
				installationId: z.number(),
				repository: z.string(),
				linkedTo: z.object({ project: z.string().nullable() }).nullable(),
			}),
		),
	});

	test("is offered to an Admin and to nobody else", () => {
		const names = (isAdmin: boolean) =>
			toolsFor(accessFor(isAdmin)).map((row) => row.name);
		expect(names(true)).toContain("list_available_github_repos");
		expect(names(false)).not.toContain("list_available_github_repos");
	});

	test("is refused to a member who calls it anyway", async () => {
		await expect(
			tool("list_available_github_repos").run(ctxOf(MEMBER), {}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("filters by name and by whether the repo is taken", async () => {
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			listInstallationRepos: async () => [
				fakeRepo(1, "mine"),
				fakeRepo(3, "free-one"),
				fakeRepo(4, "free-two"),
			],
		});
		const all = result.parse(
			await tool("list_available_github_repos").run(ctxOf(ADMIN), {}),
		);
		expect(all.total).toBe(3);
		expect(
			present(
				all.repos.find((repo) => repo.githubRepoId === 1),
				"taken repo",
			).linkedTo?.project,
		).toBe("Mine");

		const free = result.parse(
			await tool("list_available_github_repos").run(ctxOf(ADMIN), {
				onlyUnlinked: true,
				query: "TWO",
			}),
		);
		expect(free.repos.map((repo) => repo.repository)).toEqual([
			"profico/free-two",
		]);
	});

	test("cuts a long list and says so", async () => {
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			listInstallationRepos: async () =>
				Array.from({ length: 130 }, (_, index) =>
					fakeRepo(1000 + index, `bulk-${index}`),
				),
		});
		const cut = result.parse(
			await tool("list_available_github_repos").run(ctxOf(ADMIN), {
				query: "bulk",
			}),
		);
		expect(cut.total).toBe(130);
		expect(cut.repos).toHaveLength(100);
		expect(cut.truncated).toBe(true);
	});
});

describe("link_github_repo", () => {
	test("asks first, and says which repo goes to which project", async () => {
		const linkTool = tool("link_github_repo");
		expect(linkTool.kind).toBe("write");
		expect(linkTool.confirm).toBe(true);
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			listInstallationRepos: async () => [fakeRepo(5, "fresh")],
		});
		expect(
			await linkTool.summarize?.(ctxOf(ADMIN), {
				projectId: mineProjectId,
				githubRepoId: 5,
				installationId: 100,
			}),
		).toBe("Link profico/fresh to Mine");
	});

	test("a member is refused", async () => {
		await expect(
			tool("link_github_repo").run(ctxOf(MEMBER), {
				projectId: mineProjectId,
				githubRepoId: 5,
				installationId: 100,
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("an installation of another organization is refused", async () => {
		await expect(
			tool("link_github_repo").run(ctxOf(ADMIN), {
				projectId: mineProjectId,
				githubRepoId: 9,
				installationId: 900,
			}),
		).rejects.toThrow("Installation not connected to this organization");
	});

	test("a project of another organization is refused", async () => {
		await expect(
			tool("link_github_repo").run(ctxOf(ADMIN), {
				projectId: awayProjectId,
				githubRepoId: 5,
				installationId: 100,
			}),
		).rejects.toThrow("Project not found");
	});

	test("an Admin links a repo, and the audit log says so", async () => {
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getRepoById: async () => fakeRepo(5, "fresh"),
		});
		const linked = z
			.object({ linked: z.boolean(), repository: z.string() })
			.parse(
				await tool("link_github_repo").run(ctxOf(ADMIN), {
					projectId: mineProjectId,
					githubRepoId: 5,
					installationId: 100,
				}),
			);
		expect(linked).toMatchObject({ linked: true, repository: "profico/fresh" });
		const events = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.organizationId, ORG));
		expect(events.map((event) => event.kind)).toContain("github.repo_linked");
	});
});

describe("unlink_github_repo", () => {
	test("is destructive and names the repo and the project", async () => {
		const unlinkTool = tool("unlink_github_repo");
		expect(unlinkTool.kind).toBe("destructive");
		expect(
			await unlinkTool.summarize?.(ctxOf(ADMIN), {
				projectId: mineProjectId,
				projectGithubRepoId: mineRepoRowId,
			}),
		).toBe("Unlink profico/mine from Mine");
	});

	test("a member is refused and the link stays", async () => {
		await expect(
			tool("unlink_github_repo").run(ctxOf(MEMBER), {
				projectId: mineProjectId,
				projectGithubRepoId: mineRepoRowId,
			}),
		).rejects.toBeInstanceOf(AccessError);
		const rows = await db
			.select()
			.from(projectGithubRepo)
			.where(eq(projectGithubRepo.id, mineRepoRowId));
		expect(rows).toHaveLength(1);
	});

	test("a repo of another project or organization is not unlinked", async () => {
		// The row exists, but it is on a different project than the one named.
		await expect(
			tool("unlink_github_repo").run(ctxOf(ADMIN), {
				projectId: mineProjectId,
				projectGithubRepoId: otherRepoRowId,
			}),
		).rejects.toThrow("nothing was unlinked");
		// The row is in another organization.
		await expect(
			tool("unlink_github_repo").run(ctxOf(ADMIN), {
				projectId: mineProjectId,
				projectGithubRepoId: awayRepoRowId,
			}),
		).rejects.toThrow("nothing was unlinked");
		const left = await db.select().from(projectGithubRepo);
		expect(left.map((row) => row.id)).toEqual(
			expect.arrayContaining([otherRepoRowId, awayRepoRowId]),
		);
	});

	test("an Admin unlinks the repo, and the entry keeps its commit", async () => {
		const result = await tool("unlink_github_repo").run(ctxOf(ADMIN), {
			projectId: otherProjectId,
			projectGithubRepoId: otherRepoRowId,
		});
		expect(result).toEqual({ unlinked: true, repository: "profico/secret" });
		const events = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.organizationId, ORG));
		expect(events.map((event) => event.kind)).toContain("github.repo_unlinked");
		// Commits on entries stay: the repo column is set to null, not the row.
		const commits = await db.select().from(timeEntryGithubCommit);
		expect(commits).toHaveLength(3);
	});
});

describe("update_integration_settings", () => {
	test("asks first, and says a switch starts from today", async () => {
		const settingsTool = tool("update_integration_settings");
		expect(settingsTool.kind).toBe("write");
		expect(settingsTool.confirm).toBe(true);
		const summary = await settingsTool.summarize?.(ctxOf(MEMBER), {
			githubSyncCommitsAsWorkTime: true,
			githubAutoLoadCommits: false,
		});
		expect(summary).toBe(
			"Switch off loading commits into suggestions; Switch on syncing commits as work time (from today on)",
		);
	});

	test("changes only the caller's own row", async () => {
		await tool("update_integration_settings").run(ctxOf(MEMBER), {
			githubSyncCommitsAsWorkTime: true,
		});
		const rows = await db.select().from(integrationSettings);
		expect(rows).toHaveLength(1);
		const row = at(rows, 0);
		expect(row.userId).toBe(MEMBER);
		expect(row.organizationId).toBe(ORG);
		expect(row.githubSyncCommitsAsWorkTime).toBe(true);
		expect(row.githubSyncCommitsAsWorkTimeSince).not.toBeNull();
		// The other switches keep their defaults.
		expect(row.googleAutoSyncMeetings).toBe(false);
	});

	test("runs the first sync when a switch that writes goes on", async () => {
		await db.delete(integrationSettings);
		const answer = z.object({ synced: z.boolean() });
		const syncedAfter = async (change: {
			githubSyncCommitsAsWorkTime?: boolean;
			githubAutoLoadCommits?: boolean;
		}) =>
			answer.parse(
				await tool("update_integration_settings").run(ctxOf(MEMBER), change),
			).synced;
		// As the settings page does: a switch that goes on does not wait for the
		// sweep. A switch that goes off, and a switch that writes nothing, do not.
		expect(await syncedAfter({ githubSyncCommitsAsWorkTime: true })).toBe(true);
		expect(await syncedAfter({ githubSyncCommitsAsWorkTime: true })).toBe(
			false,
		);
		expect(await syncedAfter({ githubAutoLoadCommits: true })).toBe(false);
		expect(await syncedAfter({ githubSyncCommitsAsWorkTime: false })).toBe(
			false,
		);
	});

	test("refuses a call that changes nothing", async () => {
		await expect(
			tool("update_integration_settings").run(ctxOf(MEMBER), {}),
		).rejects.toThrow("at least one switch");
	});
});

describe("suggest_commits and suggest_pull_requests", () => {
	const commitResult = z.object({
		truncated: z.boolean(),
		commits: z.array(
			z.object({
				repository: z.string(),
				sha: z.string(),
				message: z.string(),
			}),
		),
	});

	const stubGithub = () =>
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getAuthenticatedUser: async () => ({ id: 1, login: "tester" }),
			listCommits: async () => [
				{
					sha: SHA,
					html_url: `https://github.com/profico/mine/commit/${SHA}`,
					commit: {
						message: "Fix the thing\n\nA long body.",
						author: { date: "2026-09-01T10:00:00Z" },
					},
					author: { login: "tester" },
				},
			],
			searchPullRequests: async () => [],
		});

	test("are reads that do not run beside another read", () => {
		for (const name of ["suggest_commits", "suggest_pull_requests"]) {
			expect(tool(name).kind).toBe("read");
			expect(tool(name).serial).toBe(true);
		}
	});

	test("an assigned member gets the first line of each commit", async () => {
		stubGithub();
		const result = commitResult.parse(
			await tool("suggest_commits").run(ctxOf(MEMBER), {
				projectId: mineProjectId,
				date: "2026-09-01",
			}),
		);
		// The "fresh" repo was linked to this project by the link test.
		const mine = present(
			result.commits.find((row) => row.repository === "profico/mine"),
			"commit in profico/mine",
		);
		expect(mine).toMatchObject({ sha: SHA, message: "Fix the thing" });
		expect(result.truncated).toBe(false);
	});

	test("a person who is not on the project gets nothing", async () => {
		stubGithub();
		const result = commitResult.parse(
			await tool("suggest_commits").run(ctxOf(BYSTANDER), {
				projectId: mineProjectId,
				date: "2026-09-01",
			}),
		);
		// No assignment: the service answers an empty list (see github.test.ts).
		expect(result).toEqual({ truncated: false, commits: [] });
	});

	test("another organization's project is refused", async () => {
		stubGithub();
		await expect(
			tool("suggest_commits").run(ctxOf(STRANGER, OTHER_ORG), {
				projectId: mineProjectId,
				date: "2026-09-01",
			}),
		).rejects.toThrow("Project not found");
	});

	test("a person with no GitHub account gets a clear message", async () => {
		stubGithub();
		await expect(
			tool("suggest_pull_requests").run(ctxOf(ADMIN), {
				projectId: mineProjectId,
				date: "2026-09-01",
			}),
		).rejects.toThrow("GitHub is not connected");
	});

	test("pull requests come grouped, one row each", async () => {
		setGithubClientForTests({
			getInstallationToken: async () => "installation-token",
			getAuthenticatedUser: async () => ({ id: 1, login: "tester" }),
			searchPullRequests: async (_token, query) =>
				query.role === "author"
					? [
							{
								id: "PR_1",
								number: 7,
								title: "Add the thing",
								url: "https://github.com/profico/mine/pull/7",
								state: "OPEN",
								merged: false,
								createdAt: "2026-09-01T09:00:00Z",
								closedAt: null,
								mergedAt: null,
								author: { login: "tester" },
								reviews: null,
							},
						]
					: [],
		});
		const result = z
			.object({
				pullRequests: z.array(
					z.object({
						number: z.number(),
						title: z.string(),
						activity: z.array(z.object({ kind: z.string() })),
					}),
				),
			})
			.parse(
				await tool("suggest_pull_requests").run(ctxOf(MEMBER), {
					projectId: mineProjectId,
					date: "2026-09-01",
				}),
			);
		const first = at(result.pullRequests, 0);
		expect(first.number).toBe(7);
		expect(first.activity.map((event) => event.kind)).toContain("opened");
	});
});

describe("list_attached_commits with a timeEntryId", () => {
	const commits = z.object({
		commits: z.array(z.object({ timeEntryId: z.string() })),
	});
	const range = { from: "2026-09-01", to: "2026-09-01" };

	test("keeps the commits of one entry", async () => {
		const all = commits.parse(
			await tool("list_attached_commits").run(ctxOf(MEMBER), range),
		);
		expect(all.commits).toHaveLength(2);
		const one = commits.parse(
			await tool("list_attached_commits").run(ctxOf(MEMBER), {
				...range,
				timeEntryId: entryAId,
			}),
		);
		expect(one.commits.map((row) => row.timeEntryId)).toEqual([entryAId]);
	});

	test("shows nothing for a colleague's entry", async () => {
		const result = commits.parse(
			await tool("list_attached_commits").run(ctxOf(MEMBER), {
				...range,
				timeEntryId: colleagueEntryId,
			}),
		);
		expect(result.commits).toEqual([]);
	});

	test("the pull request read takes the same filter", async () => {
		const result = z
			.object({ activity: z.array(z.object({ activityId: z.string() })) })
			.parse(
				await tool("list_attached_pull_requests").run(ctxOf(MEMBER), {
					...range,
					timeEntryId: entryAId,
				}),
			);
		expect(result.activity).toEqual([]);
	});
});
