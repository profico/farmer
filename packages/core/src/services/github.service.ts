import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { auth } from "../auth";
import { sealLegacyOAuthTokens } from "../auth/legacy-tokens";
import { db } from "../db";
import { account } from "../db/schema/auth";
import { project, projectMember, timeEntry } from "../db/schema/domain";
import {
	orgGithubInstallation,
	projectGithubRepo,
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { mapBounded } from "../lib/concurrency";
import {
	type PullRequestActivity,
	pullRequestActivity,
} from "../lib/github-activity";
import * as githubClient from "../lib/github-client";
import {
	GithubInstallationGoneError,
	GithubRateLimitError,
	GithubTokenInvalidError,
} from "../lib/github-client";
import { loggableError } from "../lib/loggable-error";
import { dayBoundsInTz, dayKeyInTz } from "../lib/time";
import { UserFacingError } from "../lib/user-facing-error";
import {
	type AttachCommitsInput,
	type AttachPullRequestsInput,
	type ConnectInstallationInput,
	type DisconnectInstallationInput,
	commitSha,
	type LinkProjectRepoInput,
	type SuggestCommitsInput,
	type SuggestPullRequestsInput,
} from "../schema/github";
import { AccessError } from "./access.service";
import { recordAudit } from "./audit";
import {
	ctxAccess,
	ctxDb,
	ctxTimezone,
	requireAdmin,
	withCtxTx,
} from "./context";
import { PROJECT_NOT_FOUND_MESSAGE } from "./guards";
import { refuseReviewBlocks, reviewsHeldBy } from "./pr-reviews";
import { projectsService } from "./projects.service";
import type { Ctx } from "./types";

/** The GitHub HTTP calls this service makes. */
export type GithubClient = Pick<
	typeof githubClient,
	| "getAuthenticatedUser"
	| "getCommit"
	| "getInstallationToken"
	| "getOrgMembership"
	| "getPullRequest"
	| "getRepoById"
	| "listCommits"
	| "searchPullRequests"
	| "listInstallationRepos"
	| "listUserInstallations"
	| "deleteInstallation"
>;

let clientOverride: Partial<GithubClient> | null = null;

// Every call to GitHub goes through here, so a test can answer it in memory.
// The engines already have a seam one level up (`ports.ts`), but that replaces
// this service wholesale — it cannot test the service's OWN checks, which sit
// between the caller and the HTTP call and are the part that matters.
const gh = (): GithubClient =>
	clientOverride ? { ...githubClient, ...clientOverride } : githubClient;

/** Test-only: answer some GitHub calls in memory. Pass null to restore. */
export const setGithubClientForTests = (
	client: Partial<GithubClient> | null,
): void => {
	clientOverride = client;
	// A list cached from the previous client is an answer nobody gave this one.
	repoLists.clear();
	repoListFetches.clear();
};

// ── The repo list cache ────────────────────────────────────────────────────
// Listing an installation's repos pages through all of them — seconds of calls
// for an installation that reaches hundreds, spent from the rate limit the
// commit engine reads through too. The list changes rarely, and a stale one is
// harmless: `linkRepo` re-reads the repo from GitHub before it writes. So each
// installation's list is stale-while-revalidate — fresh for five minutes, then
// served as it is while one refresh runs behind it, and waited on again only
// past a day. Keyed on the installation, not the caller, since every admin gets
// the same list; in process, like the token cache, because this deployment is
// one instance.

type InstallationRepo = {
	githubRepoId: number;
	installationId: number;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
};
type RepoList = { repos: InstallationRepo[]; fetchedAt: number };

const REPO_LIST_FRESH_MS = 5 * 60_000;
const REPO_LIST_MAX_STALE_MS = 24 * 60 * 60_000;
// A forced refresh of a list younger than this is answered from the cache, so a
// Refresh button clicked five times is one read of GitHub, not five.
const REPO_LIST_REFRESH_FLOOR_MS = 10_000;

const repoLists = new Map<number, RepoList>();
const repoListFetches = new Map<number, Promise<RepoList>>();

/** One read of GitHub per installation at a time, however many callers ask. */
const fetchRepoList = (
	installationId: number,
	nowMs: number,
): Promise<RepoList> => {
	const inflight = repoListFetches.get(installationId);
	if (inflight) return inflight;
	const fetching = (async () => {
		const token = await gh().getInstallationToken(installationId);
		const repos = await gh().listInstallationRepos(token);
		const list: RepoList = {
			repos: repos.map((r) => ({
				githubRepoId: r.id,
				installationId,
				owner: r.owner.login,
				name: r.name,
				fullName: r.full_name,
				private: r.private,
			})),
			fetchedAt: nowMs,
		};
		repoLists.set(installationId, list);
		return list;
	})().finally(() => repoListFetches.delete(installationId));
	repoListFetches.set(installationId, fetching);
	return fetching;
};

const readRepoList = async (
	installationId: number,
	nowMs: number,
	refresh: boolean,
): Promise<RepoList | null> => {
	const cached = repoLists.get(installationId);
	const age = cached ? nowMs - cached.fetchedAt : Number.POSITIVE_INFINITY;
	const freshFor = refresh ? REPO_LIST_REFRESH_FLOOR_MS : REPO_LIST_FRESH_MS;
	if (cached && age < freshFor) return cached;
	if (cached && !refresh && age < REPO_LIST_MAX_STALE_MS) {
		fetchRepoList(installationId, nowMs).catch((error: unknown) =>
			console.error("[github] background repo list refresh failed", {
				installationId,
				error,
			}),
		);
		return cached;
	}
	try {
		return await fetchRepoList(installationId, nowMs);
	} catch (error) {
		console.error("[github] listInstallationRepos failed", {
			installationId,
			error,
		});
		// The last good list, however old, rather than this installation's repos
		// silently missing. `fetchedAt` still says how old it is.
		return cached ?? null;
	}
};

/** Test-only: wait for every refresh the cache started in the background. */
export const settleRepoListRefreshesForTests = async (): Promise<void> => {
	await Promise.allSettled(repoListFetches.values());
};

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

/** A token read already running for a user, keyed by user id — the account is
 *  per person, not per organization.
 *
 *  A GitHub user token dies after 8 hours, and the refresh that replaces it
 *  SPENDS a single-use refresh token (see `refreshGithubToken` in
 *  `auth/index.ts`). So two callers arriving together just after the expiry
 *  send the same refresh token twice, and GitHub refuses the second: the
 *  automation sweep beside a dashboard load, or simply two browser tabs.
 *
 *  The loser no longer damages the row, but it still read nothing and
 *  `connectionStatus` still has to call that `needsReconnect` — the reconnect
 *  banner, in front of somebody whose connection is fine. Sharing the flight
 *  makes the second caller wait for the first token rather than race it. */
const tokenReads = new Map<string, Promise<string | null>>();

// The user's OAuth token is used ONLY for identity — resolving their GitHub
// login (to filter commits by author) and enumerating installations they may
// connect. All repo/commit reads go through installation tokens instead.
const getAccessToken = (ctx: Ctx): Promise<string | null> => {
	const running = tokenReads.get(ctx.userId);
	if (running) return running;
	const work = readAccessToken(ctx).finally(() => {
		if (tokenReads.get(ctx.userId) === work) tokenReads.delete(ctx.userId);
	});
	tokenReads.set(ctx.userId, work);
	return work;
};

const readAccessToken = async (ctx: Ctx): Promise<string | null> => {
	// No linked account is the ordinary answer for most people, and better-auth
	// throws "Account not found" for it — which logged a full stack trace as an
	// error on every such call. Ask the table first; a throw below is then a real
	// failure, such as a refresh that GitHub refused.
	const linked = await db.query.account.findFirst({
		where: and(
			eq(account.userId, ctx.userId),
			eq(account.providerId, "github"),
		),
		columns: { id: true, accessToken: true, refreshToken: true },
	});
	if (!linked) return null;
	await sealLegacyOAuthTokens(linked);
	try {
		const result = await auth.api.getAccessToken({
			body: { providerId: "github", userId: ctx.userId },
		});
		return result.accessToken ?? null;
	} catch (error) {
		console.error("[github] getAccessToken failed", {
			userId: ctx.userId,
			error: loggableError(error),
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
	if (!row) throw new Error(PROJECT_NOT_FOUND_MESSAGE);
};

/**
 * The linked repos a commit scan for this person should read.
 *
 * Scoped to the projects they hold an ACTIVE assignment on, not to every repo
 * in the organization — which is what the two cross-repo scans below used to do,
 * and it is what made the automation sweep cost (org repos x people) GitHub
 * calls every twenty minutes. Thirty repos and forty people is 1,200 calls a
 * sweep, 3,600 an hour, against an installation rate limit that starts at 5,000
 * — and the sweep runs four people at a time, so each of those was also thirty
 * sockets opened at once.
 *
 * The scope is also the more correct answer, not merely the cheaper one. A
 * commit on a project you are not assigned to cannot be attributed to it: the
 * engine attaches per project by finding YOUR work entry on that project, and
 * `assertCanTrackOn` means you have none. Such commits only ever fell through to
 * the day's project-less fill block, so the effect of scoping is that work you
 * are not on stops seeding a block about work you are not on. If somebody's
 * commits ought to count, the fix is to assign them to the project — which is
 * the same thing that lets them log the time.
 *
 * `suggestCommits` and `suggestPullRequests` read through here too, narrowed to
 * the one project the caller named. `assertProjectInOrg` alone used to gate
 * `suggestCommits`, which let a member scan any project's repos, private ones
 * included, with the installation token; and a commit it offered there was
 * one `attachCommits` would then refuse.
 *
 * There is no admin bypass, here or in `attachCommits`, which reads through
 * this too: the argument above is about attribution, and being an admin does
 * not make a commit on a project you are not on your work on it.
 *
 * `ids` narrows it to those repos, for a caller that was handed repo ids.
 */
const reposForUser = async (ctx: Ctx, ids?: string[]) => {
	// A deployment that lost a webhook carries its orphans until something
	// looks. This is that something: the repair is a no-op on a healthy org,
	// and the alternative is an admin running UPDATE statements by hand.
	await rebindOrphanedRepos(ctx.organizationId);
	return db
		.select({
			id: projectGithubRepo.id,
			projectId: projectGithubRepo.projectId,
			owner: projectGithubRepo.owner,
			name: projectGithubRepo.name,
			fullName: projectGithubRepo.fullName,
			installationId: projectGithubRepo.installationId,
		})
		.from(projectGithubRepo)
		.innerJoin(
			projectMember,
			and(
				eq(projectMember.projectId, projectGithubRepo.projectId),
				eq(projectMember.organizationId, projectGithubRepo.organizationId),
				eq(projectMember.userId, ctx.userId),
				eq(projectMember.active, true),
			),
		)
		.where(
			and(
				eq(projectGithubRepo.organizationId, ctx.organizationId),
				ids ? inArray(projectGithubRepo.id, ids) : undefined,
			),
		);
};

/** Repoint repo rows whose installation the org no longer holds.
 *
 *  `projectGithubRepo.installationId` is frozen at link time, and an
 *  installation's id is not: removing the App on GitHub and adding it back
 *  mints a new one. `forgetInstallation` used to drop only the
 *  `orgGithubInstallation` row, so every repo linked under the old id kept
 *  naming it — and every commit and pull request read 404ed on a token mint,
 *  forever. Reconnecting could not fix it, because connecting writes a new row
 *  rather than repairing old ones, which read as "no commits" with a log full
 *  of 404s.
 *
 *  The repair needs no call to GitHub: an orphan is a row naming an
 *  installation that is not in the org's own set. A repo is rebound to the
 *  installation on the account that OWNS it — `accountLogin` against `owner` —
 *  never merely to whichever installation the org has, because an installation
 *  on one account cannot read another account's repos, and a wrong id trades a
 *  loud 404 for a silent empty answer.
 *
 *  An orphan with no installation on its owner is set to NULL: the App really
 *  is gone from that account, and NULL is the state the column already
 *  documents for a repo nothing can read. It is logged, because from here on
 *  the repo answers "no activity" rather than failing.
 *
 *  Takes no `Ctx`: which orgs named the installation is what this looks up
 *  rather than what it is told, the same reasoning as `forgetInstallation`.
 *  Scoped to one org when a read is what triggered it. */
const rebindOrphanedRepos = async (
	organizationId?: string,
): Promise<number> => {
	const orgFilter = organizationId
		? eq(projectGithubRepo.organizationId, organizationId)
		: undefined;

	const repos = await db
		.select({
			id: projectGithubRepo.id,
			organizationId: projectGithubRepo.organizationId,
			owner: projectGithubRepo.owner,
			fullName: projectGithubRepo.fullName,
			installationId: projectGithubRepo.installationId,
		})
		.from(projectGithubRepo)
		.where(orgFilter);
	// Narrowed by construction rather than asserted: a row with no installation
	// is not an orphan, it is the documented "linked before installations
	// existed" state, and nothing here should overwrite it.
	const named = repos.flatMap((r) =>
		r.installationId === null
			? []
			: [{ ...r, installationId: r.installationId }],
	);
	if (named.length === 0) return 0;

	const installs = await db
		.select({
			organizationId: orgGithubInstallation.organizationId,
			installationId: orgGithubInstallation.installationId,
			accountLogin: orgGithubInstallation.accountLogin,
		})
		.from(orgGithubInstallation)
		.where(
			organizationId
				? eq(orgGithubInstallation.organizationId, organizationId)
				: undefined,
		);

	// Per org: the ids it still holds, and the id to use for a given account.
	const held = new Map<string, Set<number>>();
	const byAccount = new Map<string, number>();
	for (const i of installs) {
		let ids = held.get(i.organizationId);
		if (!ids) {
			ids = new Set<number>();
			held.set(i.organizationId, ids);
		}
		ids.add(i.installationId);
		byAccount.set(
			`${i.organizationId}\u0000${i.accountLogin.toLowerCase()}`,
			i.installationId,
		);
	}

	let repaired = 0;
	for (const repo of named) {
		if (held.get(repo.organizationId)?.has(repo.installationId)) continue;
		const replacement = byAccount.get(
			`${repo.organizationId}\u0000${repo.owner.toLowerCase()}`,
		);
		if (replacement === undefined) continue;
		// Compare-and-set on the id we read, not a blind write. The sweep scans
		// several people at once and they share an org's repos, so two of them
		// reach the same orphan holding the same stale id. Without the second
		// predicate both "repair" it and both log, which is how one uninstall
		// produced two identical rebind lines per repo. The loser matches no
		// row, changes nothing and stays quiet.
		const rebound = await db
			.update(projectGithubRepo)
			.set({ installationId: replacement, updatedAt: new Date() })
			.where(
				and(
					eq(projectGithubRepo.id, repo.id),
					eq(projectGithubRepo.installationId, repo.installationId),
				),
			)
			.returning({ id: projectGithubRepo.id });
		if (rebound.length === 0) continue;
		repaired += 1;
		console.info("[github] rebound repo to a live installation", {
			repoId: repo.id,
			repo: repo.fullName,
			from: repo.installationId,
			to: replacement,
		});
	}
	return repaired;
};

/** A read that 404s on the token mint has learned, the hard way, exactly what
 *  `installation.deleted` would have told us: the installation is gone. A
 *  webhook can be missed — no secret set, a delivery that failed, an App
 *  installed before the endpoint existed — and until something acts on the
 *  404 the rows stay broken and every later read repeats it.
 *
 *  So treat the two as one fact. Forgetting rebinds the repos, which makes the
 *  NEXT read succeed; this read still degrades to "no activity" for that repo,
 *  as it does for any other per-repo failure. */
const forgetGoneInstallation = async (
	error: GithubInstallationGoneError,
): Promise<void> => {
	console.warn("[github] installation is gone, repairing the repos naming it", {
		installationId: error.installationId,
	});
	await githubService.forgetInstallation(error.installationId);
};

/** How many repos one person's scan may have in flight at once.
 *
 *  The per-repo work is a GitHub round trip, so the ceiling that matters is
 *  somebody else's rate limiter, not this machine — same reasoning as
 *  AUTOMATION_SYNC_CONCURRENCY, and these multiply: the sweep runs four people
 *  concurrently, each of which lands here. */
const REPO_SCAN_CONCURRENCY = Number(
	process.env.GITHUB_REPO_SCAN_CONCURRENCY ?? 4,
);

// ── Pull request activity ──────────────────────────────────────────────────
// The PR half of the evidence. Same scope as the commit scans (`reposForUser`,
// for the same attribution argument), same failure rule (a rate limit ends the
// scan, anything else costs that repo), and the same "no linked account is an
// empty answer" — but read through GraphQL search, one page per role per repo,
// rather than a REST list per repo. See `lib/github-client` for why.

/** A PR event as a scan returns it, already carrying where it was found. */
export type ScannedPullRequestActivity = PullRequestActivity & {
	projectGithubRepoId: string;
	projectId: string;
	repoFullName: string;
};

/** The row `timeEntryGithubPrActivity` stores for one event. Shared with the
 *  commit engine, which writes these without going through `attach`. */
export const pullRequestActivityRow = (
	timeEntryId: string,
	projectGithubRepoId: string | null,
	activity: PullRequestActivity,
): typeof timeEntryGithubPrActivity.$inferInsert => ({
	timeEntryId,
	projectGithubRepoId,
	eventId: activity.eventId,
	kind: activity.kind,
	reviewState: activity.reviewState,
	number: activity.number,
	title: activity.title,
	pullRequestUrl: activity.pullRequestUrl,
	url: activity.url,
	occurredAt: activity.occurredAt,
});

/** Said to a person, so it names both reasons a linked account can be unusable:
 *  never connected, and connected with a grant they have since revoked. */
const NOT_CONNECTED =
	"GitHub is not connected, or the connection has expired — connect it again under Settings → Integrations.";

/** The caller's GitHub login, or null when no account is linked — or when the
 *  linked one no longer works.
 *
 *  A revoked, expired or re-issued OAuth token is answered 401 forever, and
 *  every read here begins by resolving the login, so that throw came back out
 *  of the automation sweep as a failed engine on every tick: the same stack
 *  trace every twenty minutes, for a person whose sync could not have worked
 *  either way. A refused token is not a failure to retry, it is an account that
 *  cannot be used — which is what "not linked" already means to every caller
 *  here. `connectionStatus` is where it becomes something the person can act
 *  on. */
const githubLoginFor = async (ctx: Ctx): Promise<string | null> => {
	const token = await getAccessToken(ctx);
	if (!token) return null;
	try {
		const githubUser = await gh().getAuthenticatedUser(token);
		return githubUser?.login ?? null;
	} catch (error) {
		if (error instanceof GithubTokenInvalidError) {
			console.warn("[github] the user's OAuth token was refused", {
				userId: ctx.userId,
			});
			return null;
		}
		throw error;
	}
};

const scanPullRequestActivity = async (
	repos: Awaited<ReturnType<typeof reposForUser>>,
	login: string,
	window: { start: Date; end: Date },
	caller: string,
): Promise<ScannedPullRequestActivity[]> => {
	const perRepo = await mapBounded(
		repos,
		REPO_SCAN_CONCURRENCY,
		async (repo): Promise<ScannedPullRequestActivity[]> => {
			if (!repo.installationId) return [];
			try {
				const token = await gh().getInstallationToken(repo.installationId);
				// Two searches because search has no OR between `author:` and
				// `reviewed-by:`. A PR can come back from both (reviewed, then taken
				// over), so they are joined on the PR's node id.
				const found = await Promise.all(
					(["author", "reviewed-by"] as const).map((role) =>
						gh().searchPullRequests(token, {
							owner: repo.owner,
							repo: repo.name,
							login,
							role,
							since: window.start,
						}),
					),
				);
				const byId = new Map(found.flat().map((pr) => [pr.id, pr]));
				return [...byId.values()].flatMap((pr) =>
					pullRequestActivity(pr, login, window).map((activity) => ({
						...activity,
						projectGithubRepoId: repo.id,
						projectId: repo.projectId,
						repoFullName: repo.fullName,
					})),
				);
			} catch (error) {
				// A rate limit is not an answer — the same rule as the commit scans,
				// for the same reason: "no activity" would let the engine file a day
				// it never managed to read.
				if (error instanceof GithubRateLimitError) throw error;
				if (error instanceof GithubInstallationGoneError) {
					await forgetGoneInstallation(error);
					return [];
				}
				console.error(`[github] ${caller} repo failed`, {
					repoId: repo.id,
					installationId: repo.installationId,
					error,
				});
				return [];
			}
		},
	);
	return perRepo
		.flat()
		.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
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

/** The caller's own GitHub identity, read with their user token. */
const callerOnGithub = (token: string) =>
	gh()
		.getAuthenticatedUser(token)
		.catch((error: unknown) => {
			if (error instanceof GithubTokenInvalidError) {
				throw new Error(NOT_CONNECTED);
			}
			throw error;
		});

/** The second half of the gate in `connectInstallation`: the caller must own
 *  the account the installation is on, not merely see one of its repos.
 *
 *  A personal account must BE the caller, compared by GitHub's numeric id,
 *  which a rename does not change. An organization must answer the caller's
 *  membership as an active admin, which is GitHub's word for an owner. The
 *  user token only says who the caller is (`GET /user`, which every token
 *  may read); the membership is read with the installation's own token, so
 *  the check needs "Members: read" on the installed App and nothing from
 *  GITHUB_CLIENT_ID, which may be a separate OAuth app. Any other account
 *  type is refused: an App on an enterprise account reads no repos, and there
 *  is no owner check to make for it. */
const assertControlsAccount = async (
	token: string,
	installation: githubClient.GithubInstallation,
): Promise<void> => {
	const owner = installation.account;
	if (owner?.type === "User") {
		const caller = await callerOnGithub(token);
		if (caller?.id !== owner.id) {
			throw new AccessError(
				`Only the owner of the GitHub account ${owner.login} can connect its installation.`,
			);
		}
		return;
	}
	if (owner?.type === "Organization") {
		const caller = await callerOnGithub(token);
		if (!caller) throw new Error(NOT_CONNECTED);
		// Every failure here is a refusal, because "could not check" is not "may
		// connect". But the failures need different next steps, so each gets its
		// own sentence: the admin who is not an owner cannot fix it with a
		// permission, and the owner who hit a rate limit only has to try again.
		const membership = await gh()
			.getInstallationToken(installation.id)
			.then((installationToken) =>
				gh().getOrgMembership(installationToken, owner.login, caller.login),
			)
			.catch((error: unknown) => {
				console.warn("[github] could not read the organization membership", {
					org: owner.login,
					error,
				});
				throw new UserFacingError(
					`Farmer could not check your membership of the GitHub organization ${owner.login}. Try again in a few minutes.`,
				);
			});
		// The id as well as the login: the membership was looked up by login,
		// and a rename between the two calls would hand the login to someone
		// else.
		const isCaller = membership?.user?.id === caller.id;
		if (
			isCaller &&
			membership.state === "active" &&
			membership.role === "admin"
		) {
			return;
		}
		// A 403 or a 404 (null): GitHub gives the first when the App does not
		// hold "Members: read", or the organization has not accepted it yet, and
		// the second when the person is not a member at all. It does not say
		// which, so the sentence names both.
		if (!membership || !isCaller) {
			throw new AccessError(
				`Farmer could not read your membership of the GitHub organization ${owner.login}. Only an owner of it can connect its installation. If you are one, accept the GitHub App's "Members: read" organization permission on GitHub, then try again.`,
			);
		}
		throw new AccessError(
			membership.state === "pending"
				? `Accept your invitation to the GitHub organization ${owner.login} first. Only an owner of it can connect its installation.`
				: `Only an owner of the GitHub organization ${owner.login} can connect its installation. Ask an owner to connect it.`,
		);
	}
	throw new AccessError(
		"Only an installation on a GitHub user or organization account can be connected.",
	);
};

/** What became of the "also uninstall from GitHub" half of a disconnect. Five
 *  answers rather than a boolean, because four of them are things the admin
 *  should read: nothing was asked for, another workspace still uses the
 *  installation, this deployment holds no App credentials, or GitHub refused.
 *  Only `uninstalled` and `already-gone` mean the App is off the account. */
export type UninstallOutcome =
	| "not-requested"
	| "uninstalled"
	| "already-gone"
	| "shared"
	| "not-configured"
	| "failed";

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
		/** The account is linked and GitHub refuses the token behind it: the
		 *  person revoked the grant, an org owner did, or this deployment now
		 *  signs with a different client id. Nothing recovers it except
		 *  authorizing again, so it is a state with one action — not an outage to
		 *  wait out, and not a disconnection the person performed. */
		needsReconnect: boolean;
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
			return {
				connected: false,
				login: null,
				unreachable: false,
				needsReconnect: false,
			};
		}

		// A stored row whose token better-auth cannot produce is the same dead end
		// as one GitHub refuses: the refresh was declined, and nothing but a new
		// authorization brings it back.
		const token = await getAccessToken(ctx);
		if (!token) {
			return {
				connected: true,
				login: null,
				unreachable: false,
				needsReconnect: true,
			};
		}

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
			const githubUser = await gh().getAuthenticatedUser(token);
			return {
				connected: true,
				login: githubUser?.login ?? null,
				unreachable: false,
				needsReconnect: false,
			};
		} catch (error) {
			// Two different answers behind one throw. An outage is waited out; a
			// refused token is waited out forever, because every read this account
			// backs — commit sync, pull request sync, the pickers — resolves the
			// login first and now quietly answers "nothing". Only the person can
			// end that, so it has to reach them.
			if (error instanceof GithubTokenInvalidError) {
				return {
					connected: true,
					login: null,
					unreachable: false,
					needsReconnect: true,
				};
			}
			console.error("[github] could not resolve the user's login", {
				userId: ctx.userId,
				error,
			});
			return {
				connected: true,
				login: null,
				unreachable: true,
				needsReconnect: false,
			};
		}
	},

	// ── Org installations (per org, one-or-many) ─────────────────────────────
	listInstallations: async (ctx: Ctx) => {
		return db.query.orgGithubInstallation.findMany({
			where: eq(orgGithubInstallation.organizationId, ctx.organizationId),
			orderBy: desc(orgGithubInstallation.createdAt),
		});
	},

	// Attach a freshly-installed installation to this org. Authorization is two
	// checks, and the first is not enough alone. The installation must appear
	// in the connecting user's own installation list, and the user must own the
	// account it is installed on (`assertControlsAccount`).
	//
	// GitHub lists an installation for anybody with read access to one of its
	// repos. On that check alone, an outside collaborator could bind a
	// company's installation to a workspace of their own, and the installation
	// token would then list every private repo it covers to them.
	connectInstallation: async (ctx: Ctx, input: ConnectInstallationInput) => {
		const token = await getAccessToken(ctx);
		if (!token) throw new Error("Connect your GitHub account first");

		// A token GitHub refuses means here what it means everywhere else: the
		// grant is gone. Say the sentence that names the fix, rather than passing
		// GitHub's own wording to an admin who cannot act on it.
		const installs = await gh()
			.listUserInstallations(token)
			.catch((error: unknown) => {
				if (error instanceof GithubTokenInvalidError) {
					throw new Error(NOT_CONNECTED);
				}
				throw error;
			});
		const match = installs.find((i) => i.id === input.installationId);
		if (!match) {
			throw new AccessError(
				"You don't have access to that GitHub installation",
			);
		}
		await assertControlsAccount(token, match);

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
		// GitHub sends an admin back through here after they change which repos
		// the App may reach, so this is the moment the cached list went wrong.
		repoLists.delete(input.installationId);
		if (row) {
			await recordAudit(ctx, {
				kind: "github.connected",
				target: {
					type: "github_installation",
					id: row.id,
					label: row.accountLogin,
				},
			});
		}
		return row;
	},

	// Two acts behind one button, and the second is opt-in. Disconnecting stops
	// THIS workspace reading the installation. `uninstall` additionally removes
	// the App from the GitHub account — which is not this org's to spend on its
	// own, so it is asked for explicitly and refused when anyone else is using
	// the installation.
	//
	// The row goes first, and the outcome of the GitHub call is REPORTED rather
	// than thrown. A refused, rate-limited or slow uninstall must not leave the
	// workspace still connected to an installation the admin just disconnected;
	// the local half is the part they can act on, and GitHub's own settings
	// page is always there for the other half.
	disconnectInstallation: async (
		ctx: Ctx,
		input: DisconnectInstallationInput,
	): Promise<{ uninstall: UninstallOutcome }> => {
		await requireAdmin(ctx);
		const removed = await db
			.delete(orgGithubInstallation)
			.where(
				and(
					eq(orgGithubInstallation.id, input.installationRowId),
					eq(orgGithubInstallation.organizationId, ctx.organizationId),
				),
			)
			.returning({
				id: orgGithubInstallation.id,
				installationId: orgGithubInstallation.installationId,
				accountLogin: orgGithubInstallation.accountLogin,
			});
		for (const row of removed) {
			repoLists.delete(row.installationId);
			await recordAudit(ctx, {
				kind: "github.disconnected",
				target: {
					type: "github_installation",
					id: row.id,
					label: row.accountLogin,
				},
				details: { uninstallRequested: input.uninstall === true },
			});
		}

		const row = removed[0];
		if (!input.uninstall || !row) return { uninstall: "not-requested" };

		// Read AFTER the delete, so this org's own row is not what it finds. One
		// GitHub account can be connected to several workspaces on a deployment
		// (`ogi_org_installation_unq` is per org), and uninstalling would take
		// the App away from all of them for a decision one of them made.
		const sharedWith = await db.query.orgGithubInstallation.findFirst({
			where: eq(orgGithubInstallation.installationId, row.installationId),
			columns: { id: true },
		});
		if (sharedWith) return { uninstall: "shared" };

		if (!githubClient.isGithubAppConfigured()) {
			return { uninstall: "not-configured" };
		}
		try {
			const gone = await gh().deleteInstallation(row.installationId);
			return { uninstall: gone ? "uninstalled" : "already-gone" };
		} catch (error) {
			console.error("[github] uninstall failed", error);
			return { uninstall: "failed" };
		}
	},

	// ── What the webhook tells us ────────────────────────────────────────────
	// No Ctx, because a webhook has no caller: the delivery is GitHub saying
	// something about an installation, and which orgs connected it is what this
	// looks up rather than what it is told. The route verifies the signature —
	// that is the whole authorization, and it is why nothing here takes an id
	// from a person.

	/** GitHub says the App was uninstalled (or this installation revoked).
	 *  Drops every workspace's row for it and answers how many there were.
	 *
	 *  Without this the row outlives the installation, and every commit and
	 *  pull request read fails against a dead installation id — a sync that is
	 *  broken and still looks connected. */
	forgetInstallation: async (installationId: number): Promise<number> => {
		const removed = await db
			.delete(orgGithubInstallation)
			.where(eq(orgGithubInstallation.installationId, installationId))
			.returning({
				id: orgGithubInstallation.id,
				organizationId: orgGithubInstallation.organizationId,
			});
		repoLists.delete(installationId);
		repoListFetches.delete(installationId);
		// Dropping the row is only half of forgetting. Every repo linked under
		// this installation still names it, and a repo that names a dead id 404s
		// on every read until something repoints it — so the two go together.
		for (const row of removed) await rebindOrphanedRepos(row.organizationId);
		return removed.length;
	},

	/** GitHub says the installation's repository selection changed. The list is
	 *  cached for five minutes to a day (see the cache above), so the admin who
	 *  just changed it on GitHub would otherwise come back to the old one. */
	forgetRepoList: (installationId: number): void => {
		repoLists.delete(installationId);
		repoListFetches.delete(installationId);
	},

	// ── Repos (read via installation tokens) ─────────────────────────────────
	// Admin-only. This is every repo every connected installation can reach —
	// private names included, far beyond the repos linked to projects — and its
	// only purpose is choosing one to link, which is itself admin-only. Asserted
	// here rather than only in the server function so the assistant and MCP
	// paths, which call services directly, are held to it too.
	//
	// Served from the repo list cache above. `refresh` skips a fresh entry, for
	// the repo somebody created a minute ago; `fetchedAt` is the oldest list the
	// answer was built from, or null when there was none.
	listAvailableRepos: async (
		ctx: Ctx,
		{
			refresh = false,
			now = new Date(),
		}: { refresh?: boolean; now?: Date } = {},
	) => {
		await requireAdmin(ctx);
		const installations = await db.query.orgGithubInstallation.findMany({
			where: eq(orgGithubInstallation.organizationId, ctx.organizationId),
		});
		if (installations.length === 0) return { repos: [], fetchedAt: null };

		const lists = await Promise.all(
			installations.map((inst) =>
				readRepoList(inst.installationId, now.getTime(), refresh),
			),
		);
		const perInstall = lists.map((list) => list?.repos ?? []);
		const fetchedAts = lists.flatMap((list) => (list ? [list.fetchedAt] : []));
		const fetchedAt =
			fetchedAts.length > 0 ? new Date(Math.min(...fetchedAts)) : null;

		// Which project already holds each repo. A repo belongs to exactly one
		// project org-wide, so the picker has to be able to say "linked to Farmer"
		// rather than offering a Link button whose only outcome is the error from
		// `linkRepo`. Answering it here is one query for the whole list; asking per
		// row would be one per repo, and an installation can expose hundreds.
		const linked = await db.query.projectGithubRepo.findMany({
			where: eq(projectGithubRepo.organizationId, ctx.organizationId),
			columns: { githubRepoId: true, projectId: true },
			with: { project: { columns: { name: true } } },
		});
		const heldBy = new Map(
			linked.map((row) => [
				row.githubRepoId,
				{ projectId: row.projectId, projectName: row.project?.name ?? null },
			]),
		);

		// A repo could be reachable through more than one installation; keep the
		// first and de-dup on the immutable repo id.
		const seen = new Set<number>();
		const repos = perInstall
			.flat()
			.filter((r) => {
				if (seen.has(r.githubRepoId)) return false;
				seen.add(r.githubRepoId);
				return true;
			})
			.map((r) => ({ ...r, linkedTo: heldBy.get(r.githubRepoId) ?? null }))
			.sort((a, b) => a.fullName.localeCompare(b.fullName));
		return { repos, fetchedAt };
	},

	// Linking and unlinking are admin-only, like `listAvailableRepos`: the
	// server functions sat behind `orgAdminMiddleware`, but the service checked
	// only the organization, so any other caller of it was one missing
	// middleware away from letting a member repoint a project's repos.
	linkRepo: async (ctx: Ctx, input: LinkProjectRepoInput) => {
		await requireAdmin(ctx);
		await assertProjectInOrg(ctx, input.projectId);

		const inst = await db.query.orgGithubInstallation.findFirst({
			where: and(
				eq(orgGithubInstallation.installationId, input.installationId),
				eq(orgGithubInstallation.organizationId, ctx.organizationId),
			),
		});
		if (!inst)
			throw new Error("Installation not connected to this organization");

		const token = await gh().getInstallationToken(inst.installationId);
		const repo = await gh().getRepoById(token, input.githubRepoId);
		if (!repo) throw new Error("Repository not found or inaccessible");

		// A repo is linked to exactly one project org-wide (pgr_org_repo_unq), so
		// this is a real answer rather than a pre-flight check racing the insert:
		// the constraint still settles a concurrent double-link, and this only
		// decides what the person reads. Naming the holding project matters —
		// "already linked" leaves them hunting through every project for it.
		const held = await db.query.projectGithubRepo.findFirst({
			where: and(
				eq(projectGithubRepo.organizationId, ctx.organizationId),
				eq(projectGithubRepo.githubRepoId, repo.id),
			),
			with: { project: { columns: { id: true, name: true } } },
		});
		if (held) {
			if (held.projectId === input.projectId) return held;
			throw new Error(
				`${repo.full_name} is already linked to ${held.project?.name ?? "another project"}. Unlink it there first — a repo belongs to one project.`,
			);
		}

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
		const linkedProject = await db.query.project.findFirst({
			where: eq(project.id, input.projectId),
			columns: { name: true },
		});
		await recordAudit(ctx, {
			kind: "github.repo_linked",
			target: {
				type: "github_repo",
				id: created.id,
				label: created.fullName,
			},
			details: {
				projectId: input.projectId,
				projectName: linkedProject?.name ?? null,
			},
		});
		return created;
	},

	unlinkRepo: async (ctx: Ctx, projectGithubRepoId: string) => {
		await requireAdmin(ctx);
		const removed = await db
			.delete(projectGithubRepo)
			.where(
				and(
					eq(projectGithubRepo.id, projectGithubRepoId),
					eq(projectGithubRepo.organizationId, ctx.organizationId),
				),
			)
			.returning({
				id: projectGithubRepo.id,
				fullName: projectGithubRepo.fullName,
				projectId: projectGithubRepo.projectId,
			});
		for (const row of removed) {
			await recordAudit(ctx, {
				kind: "github.repo_unlinked",
				target: { type: "github_repo", id: row.id, label: row.fullName },
				details: { projectId: row.projectId },
			});
		}
	},

	/**
	 * The repos linked to one project: the project panel's GitHub tab (admin)
	 * and the entry dialog's commit picker (whoever logs time there).
	 *
	 * Gated on `canTrackOn`, the same line that decides whether the project is
	 * in the caller's picker at all: Admin, any assignment, or a project open to
	 * the organization. It used to check only the organization, so a plain
	 * member could name any project and read the owner/name of its repos,
	 * private ones included, which is exactly what `reposForUser` keeps the
	 * commit scans from reaching.
	 *
	 * A member who reaches the project only because it is open to the
	 * organization gets an empty list. `suggestCommits` and `attachCommits`
	 * read through `reposForUser`, which needs an active assignment, so a repo
	 * shown here would open a commit picker that always answers empty. An
	 * admin keeps the whole list: the project panel's GitHub tab is theirs.
	 */
	listLinkedRepos: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		access.assertCanTrackOn(projectId);
		if (!access.isAdmin && access.roleOn(projectId) === null) return [];
		return db.query.projectGithubRepo.findMany({
			where: and(
				eq(projectGithubRepo.projectId, projectId),
				eq(projectGithubRepo.organizationId, ctx.organizationId),
			),
			orderBy: desc(projectGithubRepo.createdAt),
		});
	},

	/**
	 * The projects the caller may log time on that have a Linked repository
	 * named `repository` (case-insensitive `owner/name`) — `farmer init`'s
	 * suggestion from a git remote.
	 *
	 * Filtered through `projectsService.listMine`, not just the organization:
	 * the lookup runs across every project in the org by repository name, so
	 * the caller's own picker is what bounds the answer — a suggestion for
	 * THIS person to log time against. `fullName`
	 * is cached at link time, so a renamed repository simply stops matching —
	 * acceptable, since this only ever feeds a suggestion.
	 */
	projectsForRepository: async (ctx: Ctx, repository: string) => {
		const mine = await projectsService.listMine(ctx);
		if (mine.length === 0) return [];

		const linked = await db
			.select({ projectId: projectGithubRepo.projectId })
			.from(projectGithubRepo)
			.where(
				and(
					eq(projectGithubRepo.organizationId, ctx.organizationId),
					sql`lower(${projectGithubRepo.fullName}) = lower(${repository})`,
				),
			);
		const linkedProjectIds = new Set(linked.map((row) => row.projectId));
		return mine.filter((project) => linkedProjectIds.has(project.id));
	},

	// ── Commits (installation token for access, user login for authorship) ───
	suggestCommits: async (ctx: Ctx, input: SuggestCommitsInput) => {
		await assertProjectInOrg(ctx, input.projectId);

		const login = await githubLoginFor(ctx);
		if (!login) throw new Error(NOT_CONNECTED);

		// The caller's assignments, like `suggestPullRequests`: the installation
		// token reads every repo it covers, so the scope is whatever this lets
		// the caller name.
		const repos = (await reposForUser(ctx)).filter(
			(repo) => repo.projectId === input.projectId,
		);
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const { start, end } = dayBoundsInTz(input.date, tz);

		const perRepo = await mapBounded(
			repos,
			REPO_SCAN_CONCURRENCY,
			async (repo) => {
				if (!repo.installationId) return [];
				try {
					const instToken = await gh().getInstallationToken(
						repo.installationId,
					);
					const commits = await gh().listCommits(
						instToken,
						repo.owner,
						repo.name,
						{
							author: login,
							since: start,
							until: end,
						},
					);
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
					// A rate limit is not an answer. Degrading it to "no commits" is
					// what let the commit engine file a full rest-of-day block on a day
					// it never actually managed to read — so it ends the whole scan and
					// the sweep records a failure it can retry.
					if (error instanceof GithubRateLimitError) throw error;
					if (error instanceof GithubInstallationGoneError) {
						await forgetGoneInstallation(error);
						return [];
					}
					console.error("[github] suggestCommits repo failed", {
						repoId: repo.id,
						installationId: repo.installationId,
						error,
					});
					return [];
				}
			},
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
		const login = await githubLoginFor(ctx);
		if (!login) return [];

		const repos = await reposForUser(ctx);
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const start = dayBoundsInTz(input.from, tz).start;
		const end = dayBoundsInTz(input.to, tz).end;

		const perRepo = await mapBounded(
			repos,
			REPO_SCAN_CONCURRENCY,
			async (repo): Promise<ScannedCommit[]> => {
				if (!repo.installationId) return [];
				try {
					const instToken = await gh().getInstallationToken(
						repo.installationId,
					);
					const commits = await gh().listCommits(
						instToken,
						repo.owner,
						repo.name,
						{
							author: login,
							since: start,
							until: end,
						},
					);
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
					// A rate limit is not an answer. Degrading it to "no commits" is
					// what let the commit engine file a full rest-of-day block on a day
					// it never actually managed to read — so it ends the whole scan and
					// the sweep records a failure it can retry.
					if (error instanceof GithubRateLimitError) throw error;
					if (error instanceof GithubInstallationGoneError) {
						await forgetGoneInstallation(error);
						return [];
					}
					console.error("[github] listUserCommitsByDay repo failed", {
						repoId: repo.id,
						installationId: repo.installationId,
						error,
					});
					return [];
				}
			},
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
		const login = await githubLoginFor(ctx);
		if (!login) return [];

		const repos = await reposForUser(ctx);
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const { start, end } = dayBoundsInTz(date, tz);

		const perRepo = await mapBounded(
			repos,
			REPO_SCAN_CONCURRENCY,
			async (repo) => {
				if (!repo.installationId) return [];
				try {
					const instToken = await gh().getInstallationToken(
						repo.installationId,
					);
					const commits = await gh().listCommits(
						instToken,
						repo.owner,
						repo.name,
						{
							author: login,
							since: start,
							until: end,
						},
					);
					return commits.map((commit) => ({
						projectId: repo.projectId,
						projectGithubRepoId: repo.id,
						repoFullName: repo.fullName,
						sha: commit.sha,
						message: commit.commit.message,
						committedAt: new Date(commit.commit.author?.date ?? new Date()),
					}));
				} catch (error) {
					// A rate limit is not an answer. Degrading it to "no commits" is
					// what let the commit engine file a full rest-of-day block on a day
					// it never actually managed to read — so it ends the whole scan and
					// the sweep records a failure it can retry.
					if (error instanceof GithubRateLimitError) throw error;
					if (error instanceof GithubInstallationGoneError) {
						await forgetGoneInstallation(error);
						return [];
					}
					console.error("[github] listUserCommitsForDay repo failed", {
						repoId: repo.id,
						installationId: repo.installationId,
						error,
					});
					return [];
				}
			},
		);

		return perRepo
			.flat()
			.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime());
	},

	attachCommits: async (ctx: Ctx, input: AttachCommitsInput) => {
		await assertTimeEntryOwnedByUser(ctx, input.timeEntryId);

		// Re-checked here, not only in `attachCommitsInput`: day assembly hands
		// its accepted suggestions' commits straight in, through a schema of its
		// own. The sha goes into a GitHub API path, where a branch name resolves
		// just as well as a commit id does.
		if (input.commits.some((c) => !commitSha.safeParse(c.sha).success)) {
			throw new Error("Expected a commit SHA");
		}

		// Owning the ENTRY is not enough — the repo is the other half. Loaded with
		// an org-only predicate, any repo in the organization would do, and
		// `getCommit` runs with the installation token, so a Member could read
		// commits (message, author) from a private repo on a project they were
		// never on, just by naming it. Same scope as every commit scan here.
		const repoIds = [
			...new Set(input.commits.map((c) => c.projectGithubRepoId)),
		];
		const repos = await reposForUser(ctx, repoIds);
		if (repos.length !== repoIds.length) {
			// One answer for "no such repo" and "not yours", so a refusal is not
			// a way to learn which repo ids exist.
			throw new AccessError(
				"You are not assigned to the project that repository belongs to",
			);
		}
		const repoById = new Map(repos.map((r) => [r.id, r]));

		// Mint one installation token per distinct installation instead of once
		// per commit, and reuse it for every commit fetched from that installation.
		const installationIds = [
			...new Set(repos.map((r) => r.installationId).filter((id) => id != null)),
		];
		const tokenByInstallation = new Map(
			await Promise.all(
				installationIds.map(
					async (id) => [id, await gh().getInstallationToken(id)] as const,
				),
			),
		);

		const fetched = await Promise.all(
			input.commits.map(async (commit) => {
				const repo = repoById.get(commit.projectGithubRepoId);
				if (!repo || !repo.installationId) return null;
				const instToken = tokenByInstallation.get(repo.installationId);
				if (!instToken) return null;
				const fresh = await gh().getCommit(
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

	// ── Pull requests (installation token for access, user login for who) ────

	/** The caller's PR events between two days, bucketed by org-tz day — the
	 *  commit engine's and the assistant's read. [] without a linked account. */
	listUserPullRequestActivityByDay: async (
		ctx: Ctx,
		input: { from: string; to: string },
	): Promise<{ dayKey: string; activity: ScannedPullRequestActivity[] }[]> => {
		const login = await githubLoginFor(ctx);
		if (!login) return [];
		const repos = await reposForUser(ctx);
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const window = {
			start: dayBoundsInTz(input.from, tz).start,
			end: dayBoundsInTz(input.to, tz).end,
		};
		const activity = await scanPullRequestActivity(
			repos,
			login,
			window,
			"listUserPullRequestActivityByDay",
		);

		const byDay = new Map<string, ScannedPullRequestActivity[]>();
		for (const event of activity) {
			const dayKey = dayKeyInTz(event.occurredAt, tz);
			const bucket = byDay.get(dayKey);
			if (bucket) bucket.push(event);
			else byDay.set(dayKey, [event]);
		}
		return [...byDay].map(([dayKey, events]) => ({ dayKey, activity: events }));
	},

	/** One day of the same, for day assembly. */
	listUserPullRequestActivityForDay: async (
		ctx: Ctx,
		date: string,
	): Promise<ScannedPullRequestActivity[]> => {
		const days = await githubService.listUserPullRequestActivityByDay(ctx, {
			from: date,
			to: date,
		});
		return days.flatMap((day) => day.activity);
	},

	/**
	 * The caller's PRs with activity on one project on one day, one row per PR,
	 * for the entry dialog's picker.
	 *
	 * Scoped to the caller's assignments, like `suggestCommits`: attaching goes
	 * through `reposForUser`, and offering a PR that attach will then refuse is a
	 * picker full of rows that fail.
	 */
	suggestPullRequests: async (ctx: Ctx, input: SuggestPullRequestsInput) => {
		await assertProjectInOrg(ctx, input.projectId);
		const login = await githubLoginFor(ctx);
		if (!login) throw new Error(NOT_CONNECTED);

		const repos = (await reposForUser(ctx)).filter(
			(repo) => repo.projectId === input.projectId,
		);
		if (repos.length === 0) return [];

		const tz = await ctxTimezone(ctx);
		const activity = await scanPullRequestActivity(
			repos,
			login,
			dayBoundsInTz(input.date, tz),
			"suggestPullRequests",
		);

		const byPullRequest = new Map<
			string,
			{
				projectGithubRepoId: string;
				repoFullName: string;
				number: number;
				title: string;
				url: string;
				activity: Pick<
					ScannedPullRequestActivity,
					"kind" | "reviewState" | "occurredAt"
				>[];
			}
		>();
		for (const event of activity) {
			const key = `${event.projectGithubRepoId}:${event.number}`;
			const row = byPullRequest.get(key) ?? {
				projectGithubRepoId: event.projectGithubRepoId,
				repoFullName: event.repoFullName,
				number: event.number,
				title: event.title,
				url: event.pullRequestUrl,
				activity: [],
			};
			row.activity.push({
				kind: event.kind,
				reviewState: event.reviewState,
				occurredAt: event.occurredAt,
			});
			byPullRequest.set(key, row);
		}
		return [...byPullRequest.values()];
	},

	/**
	 * Attach the caller's own events on these PRs, on the entry's day, to the
	 * entry.
	 *
	 * The caller names a PR and nothing more. What is stored is read back from
	 * GitHub and cut to what this person did on the day the entry is for, so an
	 * entry cannot claim a review somebody else wrote, or a merge from last
	 * month. A PR with nothing of theirs on that day attaches nothing.
	 */
	attachPullRequests: async (ctx: Ctx, input: AttachPullRequestsInput) => {
		const entry = await assertTimeEntryOwnedByUser(ctx, input.timeEntryId);

		// The repo check comes first, before any call to GitHub, for the reason
		// `attachCommits` gives: the leak would be the READ.
		const repoIds = [
			...new Set(input.pullRequests.map((pr) => pr.projectGithubRepoId)),
		];
		const repos = await reposForUser(ctx, repoIds);
		if (repos.length !== repoIds.length) {
			throw new AccessError(
				"You are not assigned to the project that repository belongs to",
			);
		}
		const repoById = new Map(repos.map((r) => [r.id, r]));

		const login = await githubLoginFor(ctx);
		if (!login) throw new Error(NOT_CONNECTED);

		const tz = await ctxTimezone(ctx);
		const window = dayBoundsInTz(entry.date, tz);
		const refs = [
			...new Map(
				input.pullRequests.map((pr) => [
					`${pr.projectGithubRepoId}:${pr.number}`,
					pr,
				]),
			).values(),
		];

		const rows = await mapBounded(refs, REPO_SCAN_CONCURRENCY, async (ref) => {
			const repo = repoById.get(ref.projectGithubRepoId);
			if (!repo || !repo.installationId) return [];
			const token = await gh().getInstallationToken(repo.installationId);
			const pr = await gh().getPullRequest(
				token,
				repo.owner,
				repo.name,
				ref.number,
				login,
			);
			if (!pr) return [];
			return pullRequestActivity(pr, login, window).map((activity) =>
				pullRequestActivityRow(entry.id, repo.id, activity),
			);
		});

		const flat = rows.flat();
		if (flat.length > 0) {
			await db
				.insert(timeEntryGithubPrActivity)
				.values(flat)
				// tegpa_entry_event_unq: attaching the same PR twice adds nothing.
				.onConflictDoNothing();
		}
		return githubService.listAttachedPullRequestActivity(ctx, entry.id);
	},

	listAttachedPullRequestActivity: async (ctx: Ctx, timeEntryId: string) => {
		await assertTimeEntryOwnedByUser(ctx, timeEntryId);
		return db.query.timeEntryGithubPrActivity.findMany({
			where: eq(timeEntryGithubPrActivity.timeEntryId, timeEntryId),
			with: { repo: true },
			orderBy: desc(timeEntryGithubPrActivity.occurredAt),
		});
	},

	detachPullRequestActivity: async (ctx: Ctx, activityId: string) => {
		const [row] = await db
			.select({
				id: timeEntryGithubPrActivity.id,
				timeEntryId: timeEntry.id,
				date: timeEntry.date,
			})
			.from(timeEntryGithubPrActivity)
			.innerJoin(
				timeEntry,
				eq(timeEntryGithubPrActivity.timeEntryId, timeEntry.id),
			)
			.where(
				and(
					eq(timeEntryGithubPrActivity.id, activityId),
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
				),
			)
			.limit(1);
		if (!row) {
			throw new Error("Pull request activity not found");
		}
		await withCtxTx(ctx, async (txCtx) => {
			const heldBefore = await reviewsHeldBy(txCtx, row.timeEntryId);
			await ctxDb(txCtx)
				.delete(timeEntryGithubPrActivity)
				.where(eq(timeEntryGithubPrActivity.id, activityId));
			// Taking a PR's last review off a Code Review entry says no to that PR's
			// block, as deleting the entry does. Deleting it next would find no
			// review left to say so, and the engine would file the block again.
			const heldAfter = new Set(await reviewsHeldBy(txCtx, row.timeEntryId));
			await refuseReviewBlocks(
				txCtx,
				row.date,
				heldBefore.filter((pullRequestUrl) => !heldAfter.has(pullRequestUrl)),
			);
		});
	},
};
