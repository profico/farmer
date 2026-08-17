import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";
import { account } from "../db/schema/auth";
import { project, timeEntry } from "../db/schema/domain";
import {
	orgGithubInstallation,
	projectGithubRepo,
	timeEntryGithubCommit,
} from "../db/schema/github";
import {
	getAuthenticatedUser,
	getCommit,
	getInstallationToken,
	getRepoById,
	listCommits,
	listInstallationRepos,
	listUserInstallations,
} from "../lib/github-client";
import { dayBoundsInTz, dayKeyInTz } from "../lib/time";
import type {
	AttachCommitsInput,
	ConnectInstallationInput,
	LinkProjectRepoInput,
	SuggestCommitsInput,
} from "../schema/github";
import { ctxTimezone } from "./context";
import type { Ctx } from "./types";

// A commit as it comes back from a repo scan, already carrying every field
// `timeEntryGithubCommit` stores — so a caller can attach it without a second
// round trip to GitHub.
export type ScannedCommit = {
	projectGithubRepoId: string;
	projectId: string;
	sha: string;
	message: string;
	authorLogin: string | null;
	committedAt: Date;
	url: string;
};

// The user's OAuth token is used ONLY for identity — resolving their GitHub
// login (to filter commits by author) and enumerating installations they may
// connect. All repo/commit reads go through installation tokens instead.
const getAccessToken = async (ctx: Ctx): Promise<string | null> => {
	try {
		const result = await auth.api.getAccessToken({
			body: { providerId: "github", userId: ctx.userId },
		});
		return result.accessToken ?? null;
	} catch (error) {
		console.error("[github] getAccessToken failed", {
			userId: ctx.userId,
			error,
		});
		return null;
	}
};

const assertProjectInOrg = async (ctx: Ctx, projectId: string) => {
	const row = await db.query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
		),
	});
	if (!row) throw new Error("Project not found");
};

const assertTimeEntryOwnedByUser = async (ctx: Ctx, timeEntryId: string) => {
	const row = await db.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.id, timeEntryId),
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.userId, ctx.userId),
		),
	});
	if (!row) throw new Error("Time entry not found");
	return row;
};

export const githubService = {
	// ── User identity (per user) ─────────────────────────────────────────────
	connectionStatus: async (
		ctx: Ctx,
	): Promise<{
		connected: boolean;
		login: string | null;
		/** GitHub answered neither yes nor no — an outage, not a disconnection.
		 *  `connected` stays true, because whether the account is linked is not
		 *  GitHub's to tell us. */
		unreachable: boolean;
	}> => {
		// auth.api.accountInfo requires either an explicit accountId or a
		// stored account cookie (account.storeAccountCookie, unset here) —
		// without either it always throws ACCOUNT_NOT_FOUND, even for a
		// genuinely linked account. Check the account table directly instead.
		const linkedAccount = await db.query.account.findFirst({
			where: and(
				eq(account.userId, ctx.userId),
				eq(account.providerId, "github"),
			),
		});
		if (!linkedAccount) {
			return { connected: false, login: null, unreachable: false };
		}

		const token = await getAccessToken(ctx);
		if (!token) return { connected: true, login: null, unreachable: false };

		// Whether the account is linked is a LOCAL fact, already answered above.
		// The login name is a nicety fetched from GitHub, so a GitHub outage has to
		// degrade the name and not the answer.
		//
		// It didn't. `githubGet` maps 403/404 to null but throws on anything else —
		// including the 503s GitHub serves during an incident — and the Integrations
		// route prefetches this status into a `useSuspenseQuery`. So a GitHub
		// incident error-boundaried the WHOLE page, taking Google Calendar and Slack
		// down with it, neither of which had anything wrong. An integration being
		// unreachable is a state to render, not an exception to propagate.
		try {
			const githubUser = await getAuthenticatedUser(token);
			return {
				connected: true,
				login: githubUser?.login ?? null,
				unreachable: false,
			};
		} catch (error) {
			console.error("[github] could not resolve the user's login", {
				userId: ctx.userId,
				error,
			});
			return { connected: true, login: null, unreachable: true };
		}
	},

	// ── Org installations (per org, one-or-many) ─────────────────────────────
	listInstallations: async (ctx: Ctx) => {
		return db.query.orgGithubInstallation.findMany({
			where: eq(orgGithubInstallation.organizationId, ctx.organizationId),
			orderBy: desc(orgGithubInstallation.createdAt),
		});
	},

	// Attach a freshly-installed installation to this org. Authorization: the
	// installation must appear in the connecting user's own installation list,
	// so nobody can bind a stranger's installation_id to their org.
	connectInstallation: async (ctx: Ctx, input: ConnectInstallationInput) => {
		const token = await getAccessToken(ctx);
		if (!token) throw new Error("Connect your GitHub account first");

		const installs = await listUserInstallations(token);
		const match = installs.find((i) => i.id === input.installationId);
		if (!match) {
			throw new Error("You don't have access to that GitHub installation");
		}

		const [row] = await db
			.insert(orgGithubInstallation)
			.values({
				organizationId: ctx.organizationId,
				installationId: input.installationId,
				accountLogin: match.account?.login ?? "unknown",
				accountType: match.account?.type ?? "unknown",
				connectedByUserId: ctx.userId,
			})
			.onConflictDoUpdate({
				target: [
					orgGithubInstallation.organizationId,
					orgGithubInstallation.installationId,
				],
				set: {
					accountLogin: match.account?.login ?? "unknown",
					accountType: match.account?.type ?? "unknown",
					connectedByUserId: ctx.userId,
					updatedAt: new Date(),
				},
			})
			.returning();
		return row;
	},

	disconnectInstallation: async (ctx: Ctx, installationRowId: string) => {
		await db
			.delete(orgGithubInstallation)
			.where(
				and(
					eq(orgGithubInstallation.id, installationRowId),
					eq(orgGithubInstallation.organizationId, ctx.organizationId),
				),
			);
	},

	// ── Repos (read via installation tokens) ─────────────────────────────────
	listAvailableRepos: async (ctx: Ctx) => {
		const installations = await db.query.orgGithubInstallation.findMany({
			where: eq(orgGithubInstallation.organizationId, ctx.organizationId),
		});
		if (installations.length === 0) return [];

		const perInstall = await Promise.all(
			installations.map(async (inst) => {
				try {
					const token = await getInstallationToken(inst.installationId);
					const repos = await listInstallationRepos(token);
					return repos.map((r) => ({
						githubRepoId: r.id,
						installationId: inst.installationId,
						owner: r.owner.login,
						name: r.name,
						fullName: r.full_name,
						private: r.private,
					}));
				} catch (error) {
					console.error("[github] listInstallationRepos failed", {
						installationId: inst.installationId,
						error,
					});
					return [];
				}
			}),
		);

		// A repo could be reachable through more than one installation; keep the
		// first and de-dup on the immutable repo id.
		const seen = new Set<number>();
		return perInstall
			.flat()
			.filter((r) => {
				if (seen.has(r.githubRepoId)) return false;
				seen.add(r.githubRepoId);
				return true;
			})
			.sort((a, b) => a.fullName.localeCompare(b.fullName));
	},

	linkRepo: async (ctx: Ctx, input: LinkProjectRepoInput) => {
		await assertProjectInOrg(ctx, input.projectId);

		const inst = await db.query.orgGithubInstallation.findFirst({
			where: and(
				eq(orgGithubInstallation.installationId, input.installationId),
				eq(orgGithubInstallation.organizationId, ctx.organizationId),
			),
		});
		if (!inst)
			throw new Error("Installation not connected to this organization");

		const token = await getInstallationToken(inst.installationId);
		const repo = await getRepoById(token, input.githubRepoId);
		if (!repo) throw new Error("Repository not found or inaccessible");

		const [created] = await db
			.insert(projectGithubRepo)
			.values({
				organizationId: ctx.organizationId,
				projectId: input.projectId,
				githubRepoId: repo.id,
				installationId: inst.installationId,
				owner: repo.owner.login,
				name: repo.name,
				fullName: repo.full_name,
				private: repo.private,
				linkedByUserId: ctx.userId,
			})
			.returning();
		if (!created) throw new Error("Failed to link repository");
		return created;
	},

	unlinkRepo: async (ctx: Ctx, projectGithubRepoId: string) => {
		await db
			.delete(projectGithubRepo)
			.where(
				and(
					eq(projectGithubRepo.id, projectGithubRepoId),
					eq(projectGithubRepo.organizationId, ctx.organizationId),
				),
			);
	},

	listLinkedRepos: async (ctx: Ctx, projectId: string) => {
		return db.query.projectGithubRepo.findMany({
			where: and(
				eq(projectGithubRepo.projectId, projectId),
				eq(projectGithubRepo.organizationId, ctx.organizationId),
			),
			orderBy: desc(projectGithubRepo.createdAt),
		});
	},

	// ── Commits (installation token for access, user login for authorship) ───
	suggestCommits: async (ctx: Ctx, input: SuggestCommitsInput) => {
		await assertProjectInOrg(ctx, input.projectId);

		const token = await getAccessToken(ctx);
		if (!token) throw new Error("GitHub not connected");

		const githubUser = await getAuthenticatedUser(token);
		if (!githubUser) throw new Error("Failed to resolve GitHub user");

		const repos = await db.query.projectGithubRepo.findMany({
			where: and(
				eq(projectGithubRepo.projectId, input.projectId),
				eq(projectGithubRepo.organizationId, ctx.organizationId),
			),
		});
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const { start, end } = dayBoundsInTz(input.date, tz);

		const perRepo = await Promise.all(
			repos.map(async (repo) => {
				if (!repo.installationId) return [];
				try {
					const instToken = await getInstallationToken(repo.installationId);
					const commits = await listCommits(instToken, repo.owner, repo.name, {
						author: githubUser.login,
						since: start,
						until: end,
					});
					return commits.map((commit) => ({
						projectGithubRepoId: repo.id,
						repoFullName: repo.fullName,
						sha: commit.sha,
						message: commit.commit.message,
						authorLogin: commit.author?.login ?? null,
						committedAt: new Date(commit.commit.author?.date ?? new Date()),
						url: commit.html_url,
					}));
				} catch (error) {
					console.error("[github] suggestCommits repo failed", {
						repoId: repo.id,
						installationId: repo.installationId,
						error,
					});
					return [];
				}
			}),
		);

		return perRepo
			.flat()
			.sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());
	},

	// Cross-repo commit scan for the "sync commits as work time" engine
	// (timeEntriesService.listRange). Unlike suggestCommits (one project), this
	// sweeps every repo linked anywhere in the org, authored by the current user,
	// and buckets what it finds by org-tz day key. Returns [] when GitHub isn't
	// connected so the time page never breaks.
	//
	// It returns whole commits rather than just the day keys it used to, because
	// the engine attaches them to the block it creates as evidence — and the
	// listing response already carries every field `timeEntryGithubCommit` needs,
	// so that costs no extra API call (attachCommits re-fetches per commit only
	// because it starts from a caller-supplied sha).
	listUserCommitsByDay: async (
		ctx: Ctx,
		input: { from: string; to: string },
	): Promise<{ dayKey: string; commits: ScannedCommit[] }[]> => {
		const token = await getAccessToken(ctx);
		if (!token) return [];
		const githubUser = await getAuthenticatedUser(token);
		if (!githubUser) return [];

		const repos = await db.query.projectGithubRepo.findMany({
			where: eq(projectGithubRepo.organizationId, ctx.organizationId),
		});
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const start = dayBoundsInTz(input.from, tz).start;
		const end = dayBoundsInTz(input.to, tz).end;

		const perRepo = await Promise.all(
			repos.map(async (repo) => {
				if (!repo.installationId) return [] as ScannedCommit[];
				try {
					const instToken = await getInstallationToken(repo.installationId);
					const commits = await listCommits(instToken, repo.owner, repo.name, {
						author: githubUser.login,
						since: start,
						until: end,
					});
					return commits.map((commit) => ({
						projectGithubRepoId: repo.id,
						projectId: repo.projectId,
						sha: commit.sha,
						message: commit.commit.message,
						authorLogin: commit.author?.login ?? null,
						committedAt: new Date(commit.commit.author?.date ?? new Date()),
						url: commit.html_url,
					}));
				} catch (error) {
					console.error("[github] listUserCommitsByDay repo failed", {
						repoId: repo.id,
						installationId: repo.installationId,
						error,
					});
					return [] as ScannedCommit[];
				}
			}),
		);

		const byDay = new Map<string, ScannedCommit[]>();
		for (const commit of perRepo.flat()) {
			const dayKey = dayKeyInTz(commit.committedAt, tz);
			const bucket = byDay.get(dayKey);
			if (bucket) bucket.push(commit);
			else byDay.set(dayKey, [commit]);
		}
		return [...byDay].map(([dayKey, commits]) => ({
			dayKey,
			// Oldest first, so a description built from the first few subjects reads
			// as the day unfolded.
			commits: commits.sort(
				(a, b) => a.committedAt.getTime() - b.committedAt.getTime(),
			),
		}));
	},

	// Day-assembly variant of the commit scan: every repo linked anywhere in the
	// org, authored by the current user, on one day — but unlike
	// listUserCommitDays it keeps the full commit info and the owning projectId,
	// so suggestions can attribute work to specific projects. Returns [] when
	// GitHub isn't connected so assembly degrades instead of breaking.
	listUserCommitsForDay: async (ctx: Ctx, date: string) => {
		const token = await getAccessToken(ctx);
		if (!token) return [];
		const githubUser = await getAuthenticatedUser(token);
		if (!githubUser) return [];

		const repos = await db.query.projectGithubRepo.findMany({
			where: eq(projectGithubRepo.organizationId, ctx.organizationId),
		});
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const { start, end } = dayBoundsInTz(date, tz);

		const perRepo = await Promise.all(
			repos.map(async (repo) => {
				if (!repo.installationId) return [];
				try {
					const instToken = await getInstallationToken(repo.installationId);
					const commits = await listCommits(instToken, repo.owner, repo.name, {
						author: githubUser.login,
						since: start,
						until: end,
					});
					return commits.map((commit) => ({
						projectId: repo.projectId,
						projectGithubRepoId: repo.id,
						repoFullName: repo.fullName,
						sha: commit.sha,
						message: commit.commit.message,
						committedAt: new Date(commit.commit.author?.date ?? new Date()),
					}));
				} catch (error) {
					console.error("[github] listUserCommitsForDay repo failed", {
						repoId: repo.id,
						installationId: repo.installationId,
						error,
					});
					return [];
				}
			}),
		);

		return perRepo
			.flat()
			.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime());
	},

	attachCommits: async (ctx: Ctx, input: AttachCommitsInput) => {
		await assertTimeEntryOwnedByUser(ctx, input.timeEntryId);

		const repoIds = [
			...new Set(input.commits.map((c) => c.projectGithubRepoId)),
		];
		const repos = await db.query.projectGithubRepo.findMany({
			where: and(
				inArray(projectGithubRepo.id, repoIds),
				eq(projectGithubRepo.organizationId, ctx.organizationId),
			),
		});
		const repoById = new Map(repos.map((r) => [r.id, r]));

		// Mint one installation token per distinct installation instead of once
		// per commit, and reuse it for every commit fetched from that installation.
		const installationIds = [
			...new Set(repos.map((r) => r.installationId).filter((id) => id != null)),
		];
		const tokenByInstallation = new Map(
			await Promise.all(
				installationIds.map(
					async (id) => [id, await getInstallationToken(id)] as const,
				),
			),
		);

		const fetched = await Promise.all(
			input.commits.map(async (commit) => {
				const repo = repoById.get(commit.projectGithubRepoId);
				if (!repo || !repo.installationId) return null;
				const instToken = tokenByInstallation.get(repo.installationId);
				if (!instToken) return null;
				const fresh = await getCommit(
					instToken,
					repo.owner,
					repo.name,
					commit.sha,
				);
				if (!fresh) return null;
				return { repo, fresh };
			}),
		);

		const rows = fetched
			.filter((r): r is NonNullable<typeof r> => r !== null)
			.map(({ repo, fresh }) => ({
				timeEntryId: input.timeEntryId,
				projectGithubRepoId: repo.id,
				sha: fresh.sha,
				message: fresh.commit.message,
				authorLogin: fresh.author?.login ?? null,
				committedAt: new Date(fresh.commit.author?.date ?? new Date()),
				url: fresh.html_url,
			}));

		if (rows.length > 0) {
			await db.insert(timeEntryGithubCommit).values(rows).onConflictDoNothing();
		}

		return githubService.listAttachedCommits(ctx, input.timeEntryId);
	},

	listAttachedCommits: async (ctx: Ctx, timeEntryId: string) => {
		await assertTimeEntryOwnedByUser(ctx, timeEntryId);

		return db.query.timeEntryGithubCommit.findMany({
			where: eq(timeEntryGithubCommit.timeEntryId, timeEntryId),
			with: { repo: true },
			orderBy: desc(timeEntryGithubCommit.committedAt),
		});
	},

	detachCommit: async (ctx: Ctx, timeEntryGithubCommitId: string) => {
		const [row] = await db
			.select({ id: timeEntryGithubCommit.id })
			.from(timeEntryGithubCommit)
			.innerJoin(timeEntry, eq(timeEntryGithubCommit.timeEntryId, timeEntry.id))
			.where(
				and(
					eq(timeEntryGithubCommit.id, timeEntryGithubCommitId),
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
				),
			)
			.limit(1);
		if (!row) {
			throw new Error("Commit attachment not found");
		}

		await db
			.delete(timeEntryGithubCommit)
			.where(eq(timeEntryGithubCommit.id, timeEntryGithubCommitId));
	},
};
