import crypto from "node:crypto";

import { externalFetch } from "./http";
import { setting } from "./instance-settings";
import { UserFacingError } from "./user-facing-error";

const GITHUB_API = "https://api.github.com";

const githubHeaders = (token: string) => ({
	Authorization: `Bearer ${token}`,
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
});

// ── GitHub App auth ────────────────────────────────────────────────────────
// Two token types are in play:
//  - the *app JWT* (signed with the app private key) authenticates AS the app
//    to mint installation tokens; short-lived (<=10min).
//  - an *installation token* (minted per installation) authenticates AS the
//    installation to read that install's repos/commits; lives ~1h.
// Never mix these with the user OAuth token — that one is only for identity.

const b64url = (input: Buffer | string) =>
	(Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url");

/**
 * The App's private key as PEM. The setting takes the PEM file as pasted on the
 * Infrastructure page, or its base64 encoding, which is what an environment
 * variable held before the page existed (a PEM has line breaks, and not every
 * deploy tool keeps them in a variable).
 */
export const appPrivateKeyPem = (stored: string): string => {
	const trimmed = stored.trim();
	if (trimmed.startsWith("-----BEGIN")) return trimmed;
	return Buffer.from(trimmed, "base64").toString("utf8");
};

// Keyed by the App ID and the key it was signed with, so a change on the page
// is not answered with a token signed by the App that was configured before.
let cachedAppJwt: {
	credentials: string;
	token: string;
	expiresAt: number;
} | null = null;

const appJwt = (): string => {
	const appId = setting("GITHUB_APP_ID");
	const storedKey = setting("GITHUB_APP_PRIVATE_KEY");
	if (!appId || !storedKey) {
		throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not configured");
	}
	const credentials = `${appId}\n${storedKey}`;
	// Reuse until 1min before expiry to avoid re-signing on every call.
	if (
		cachedAppJwt?.credentials === credentials &&
		cachedAppJwt.expiresAt - 60_000 > Date.now()
	) {
		return cachedAppJwt.token;
	}
	const pem = appPrivateKeyPem(storedKey);
	const now = Math.floor(Date.now() / 1000);
	// iat backdated 60s for clock skew; exp is the 10min max GitHub allows.
	const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
	const signingInput = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
		JSON.stringify(payload),
	)}`;
	const signature = b64url(
		crypto.createSign("RSA-SHA256").update(signingInput).sign(pem),
	);
	const token = `${signingInput}.${signature}`;
	cachedAppJwt = { credentials, token, expiresAt: (now + 9 * 60) * 1000 };
	return token;
};

const appHeaders = () => githubHeaders(appJwt());

export type GithubInstallation = {
	id: number;
	account: { id: number; login: string; type: string } | null;
};

// Installations the *user* can see, per their OAuth token. GitHub lists an
// installation here when the user has explicit read, write or admin access to
// ANY repository it covers, so this proves the user can see the installation,
// not that they control it. It is only the first half of the gate in
// `githubService.connectInstallation`; the second half checks that the user
// owns the account the installation is on (`getAuthenticatedUser` for a
// personal account, and `getOrgMembership` with the installation token for an
// organization).
export const listUserInstallations = async (
	userToken: string,
): Promise<GithubInstallation[]> => {
	const response = await externalFetch(
		`${GITHUB_API}/user/installations?per_page=100`,
		{ headers: githubHeaders(userToken) },
	);
	if (response.status === 401) {
		throw new GithubTokenInvalidError("/user/installations");
	}
	if (!response.ok) {
		throw new Error(`GitHub API error ${response.status}: /user/installations`);
	}
	// SAFETY: the non-2xx branch above has already thrown, so this is GitHub's
	// documented 200 body for GET /user/installations. Only `installations` is
	// read, and each field consumed off it is optional-safe downstream.
	const body = (await response.json()) as {
		total_count: number;
		installations: GithubInstallation[];
	};
	return body.installations;
};

const installationTokenCache = new Map<
	number,
	{ token: string; expiresAt: number }
>();

// Mints (and caches ~55min) an installation access token. Callers pass this
// token to the existing repo/commit helpers below.
export const getInstallationToken = async (
	installationId: number,
): Promise<string> => {
	const cached = installationTokenCache.get(installationId);
	if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) {
		return cached.token;
	}
	const response = await externalFetch(
		`${GITHUB_API}/app/installations/${installationId}/access_tokens`,
		{ method: "POST", headers: appHeaders() },
	);
	// A 404 here is not a transient failure: GitHub answers it when the
	// installation does not exist for this App, which is what an uninstall
	// leaves behind. It is typed so a caller can repair the rows that still
	// name it, rather than retrying a dead id every twenty minutes forever.
	if (response.status === 404) {
		throw new GithubInstallationGoneError(installationId);
	}
	if (!response.ok) {
		throw new Error(
			`GitHub API error ${response.status}: mint installation token`,
		);
	}
	// SAFETY: guarded by the `!response.ok` throw above. This is the documented
	// 201 body of POST /app/installations/:id/access_tokens; a malformed
	// `expires_at` becomes NaN, which the cache treats as already expired.
	const body = (await response.json()) as { token: string; expires_at: string };
	installationTokenCache.set(installationId, {
		token: body.token,
		expiresAt: new Date(body.expires_at).getTime(),
	});
	return body.token;
};

/** Whether this deployment holds the App's credentials. `appJwt` throws
 *  without them, so a caller that has a better answer than a thrown error
 *  asks first. */
export const isGithubAppConfigured = (): boolean =>
	Boolean(setting("GITHUB_APP_ID") && setting("GITHUB_APP_PRIVATE_KEY"));

// Uninstall the App from the account this installation belongs to — the App
// JWT, never an installation token, because this authenticates AS the App and
// an installation cannot remove itself. GitHub needs no extra permission for
// it; an App may always delete its own installations.
//
// This is the whole GitHub account's App, not one org's view of it. The caller
// is responsible for knowing nothing else still depends on the installation;
// `githubService.disconnectInstallation` is the only one today, and it checks.
//
// Answers whether something was actually removed. A 404 is the outcome the
// caller wanted, reached by somebody else first: the App is already gone.
export const deleteInstallation = async (
	installationId: number,
): Promise<boolean> => {
	const response = await externalFetch(
		`${GITHUB_API}/app/installations/${installationId}`,
		{ method: "DELETE", headers: appHeaders() },
	);
	// Either way the cached token is now worthless, and a 401 an hour from now
	// would be a harder thing to read than a fresh mint that fails immediately.
	installationTokenCache.delete(installationId);
	if (response.status === 404) return false;
	if (!response.ok) {
		throw new Error(
			`GitHub API error ${response.status}: uninstall ${installationId}`,
		);
	}
	return true;
};

// ── Webhooks ───────────────────────────────────────────────────────────────

/** Whether this deployment can accept webhooks. Separate from the App's own
 *  credentials: an App may be configured with no webhook secret, and the
 *  endpoint has to say which of the two is missing. */
export const isGithubWebhookConfigured = (): boolean =>
	Boolean(setting("GITHUB_WEBHOOK_SECRET"));

/** Whether a delivery really came from GitHub: HMAC-SHA256 of the RAW body
 *  under the App's webhook secret, as `X-Hub-Signature-256`.
 *
 *  The body must be the bytes GitHub sent, not a re-serialized parse — key
 *  order and whitespace are part of what was signed. Compared in constant
 *  time, because a byte-by-byte compare on a 64-character hex digest leaks
 *  the digest to anyone who can time the endpoint, and this signature is the
 *  only thing standing in front of a public, unauthenticated route. */
export const verifyWebhookSignature = (
	body: string,
	signature: string | null,
): boolean => {
	const secret = setting("GITHUB_WEBHOOK_SECRET");
	if (!secret || !signature) return false;
	const expected = `sha256=${crypto
		.createHmac("sha256", secret)
		.update(body)
		.digest("hex")}`;
	const given = Buffer.from(signature);
	const want = Buffer.from(expected);
	// timingSafeEqual throws on a length mismatch, which is itself a compare.
	if (given.length !== want.length) return false;
	return crypto.timingSafeEqual(given, want);
};

const repoReadTokenCache = new Map<
	string,
	{ token: string; expiresAt: number }
>();

// A token that can read ONE repository's contents (and so its releases), or
// null when the App is not installed on that repository.
//
// It is the App's installation token, narrowed when it is minted: `repositories`
// and `permissions` in the request body limit it to this repository and to
// Contents: read, whatever else the installation reaches.
//
// Not `getInstallationToken`, because that cache is keyed by installation id
// and holds the full token the commit sync needs. A narrowed token stored
// there would starve the sync, and the full one stored here would widen this.
//
// This is a FALLBACK, used only when an anonymous read (`lib/github-public.ts`)
// answers 404: the releases repository is currently private, so the CLI
// download route and the contributors card retry with this once the App is
// configured. Remove it once the repository is public for good.
export const getRepoContentsReadToken = async (
	owner: string,
	repo: string,
): Promise<string | null> => {
	const key = `${owner}/${repo}`;
	const cached = repoReadTokenCache.get(key);
	if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) {
		return cached.token;
	}

	const installation = await externalFetch(
		`${GITHUB_API}/repos/${key}/installation`,
		{ headers: appHeaders() },
	);
	// 404 is GitHub's answer for "the App is not installed here", and also for a
	// repository that does not exist — the same thing, from where this sits.
	if (installation.status === 404) return null;
	if (!installation.ok) {
		throw new Error(
			`GitHub API error ${installation.status}: /repos/${key}/installation`,
		);
	}
	// SAFETY: guarded by the 404 return and the `!ok` throw above. This is the
	// documented 200 body of GET /repos/:owner/:repo/installation; only `id` is
	// read, and a missing one fails the mint below with a GitHub error.
	const { id } = (await installation.json()) as { id: number };

	const response = await externalFetch(
		`${GITHUB_API}/app/installations/${id}/access_tokens`,
		{
			method: "POST",
			headers: appHeaders(),
			body: JSON.stringify({
				repositories: [repo],
				permissions: { contents: "read" },
			}),
		},
	);
	if (!response.ok) {
		throw new Error(
			`GitHub API error ${response.status}: mint a read token for ${key}`,
		);
	}
	// SAFETY: guarded by the `!response.ok` throw above. The same documented 201
	// body `getInstallationToken` reads; a malformed `expires_at` becomes NaN,
	// which the cache treats as already expired.
	const body = (await response.json()) as { token: string; expires_at: string };
	repoReadTokenCache.set(key, {
		token: body.token,
		expiresAt: new Date(body.expires_at).getTime(),
	});
	return body.token;
};

// Lists every repo an installation can access, paging past the 100/page cap.
export const listInstallationRepos = async (
	token: string,
): Promise<GithubRepo[]> => {
	const all: GithubRepo[] = [];
	for (let page = 1; ; page++) {
		const response = await externalFetch(
			`${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
			{ headers: githubHeaders(token) },
		);
		if (!response.ok) {
			throw new Error(
				`GitHub API error ${response.status}: /installation/repositories`,
			);
		}
		// SAFETY: guarded by the `!response.ok` throw above — GitHub's documented
		// 200 body for GET /installation/repositories.
		const body = (await response.json()) as {
			total_count: number;
			repositories: GithubRepo[];
		};
		all.push(...body.repositories);
		if (body.repositories.length < 100 || all.length >= body.total_count) break;
	}
	return all;
};

export type GithubRepo = {
	id: number;
	name: string;
	full_name: string;
	owner: { login: string };
	private: boolean;
};

export type GithubCommit = {
	sha: string;
	html_url: string;
	commit: { message: string; author: { date: string } | null };
	author: { login: string } | null;
};

export type GithubUser = { id: number; login: string };

/** One person's membership of one GitHub organization. `role` "admin" is an
 *  organization owner; `state` "pending" is an invitation not yet accepted.
 *  `user.id` is GitHub's numeric id, which a rename does not change. */
export type GithubOrgMembership = {
	state: "active" | "pending";
	role: "admin" | "member" | "billing_manager";
	user: { id: number; login: string } | null;
};

/** A 403/429 that means "slow down", not "you may not see this".
 *
 *  These two answers arrive on the same status code and used to be collapsed
 *  into the same `null`, so a rate-limited sweep was indistinguishable from a
 *  repository with no commits: the engine wrote nothing, reported success, and
 *  logged nothing. A throw makes the sweep record a failure it can retry. */
export class GithubRateLimitError extends UserFacingError {
	/** The request GitHub throttled. Kept off `message`, which a person reads:
	 *  the URL names repositories and logins. */
	readonly url: string;
	constructor(url: string) {
		super("GitHub is limiting requests right now. Try again in a few minutes.");
		this.name = "GithubRateLimitError";
		this.url = url;
	}
}

/** GitHub refused the credential itself: 401. Unlike a rate limit this never
 *  recovers on its own — an OAuth token stays refused until the person
 *  authorizes the app again — so a caller that can degrade should answer as it
 *  answers "no account linked" rather than retry the same dead token every
 *  twenty minutes forever. `githubService.connectionStatus` is what turns it
 *  into something the person can act on. */
export class GithubTokenInvalidError extends UserFacingError {
	/** The request GitHub refused, kept off `message` for the same reason as
	 *  `GithubRateLimitError.url`. */
	readonly url: string;
	constructor(url: string) {
		super(
			"GitHub refused the connection. Connect GitHub again under Integrations.",
		);
		this.name = "GithubTokenInvalidError";
		this.url = url;
	}
}

/** The installation itself is gone: 404 from the token mint. GitHub answers
 *  this when the App is no longer installed on the account, so every row that
 *  still names the id is stale and no retry will ever succeed.
 *
 *  It is the same fact `installation.deleted` carries, reached the other way
 *  round — by a read, rather than by a webhook that may never have arrived.
 *  `githubService` treats the two identically: forget the installation, rebind
 *  the repos that named it, and read again. */
export class GithubInstallationGoneError extends UserFacingError {
	readonly installationId: number;
	constructor(installationId: number) {
		super(`GitHub installation ${installationId} no longer exists`);
		this.name = "GithubInstallationGoneError";
		this.installationId = installationId;
	}
}

/** GitHub signals both flavours of throttling on 403 as well as 429: the
 *  primary limit zeroes `x-ratelimit-remaining`, the secondary/abuse limit sends
 *  `retry-after` and says so in the body. A plain forbidden has neither. */
const isThrottled = (response: Response, body: string): boolean => {
	if (response.status === 429) return true;
	if (response.headers.get("x-ratelimit-remaining") === "0") return true;
	if (response.headers.get("retry-after") !== null) return true;
	return /rate limit|abuse detection/i.test(body);
};

const githubGet = async <T>(url: string, token: string): Promise<T | null> => {
	const response = await externalFetch(url, { headers: githubHeaders(token) });
	if (response.status === 403 || response.status === 429) {
		const body = await response.text().catch(() => "");
		if (isThrottled(response, body)) throw new GithubRateLimitError(url);
		// A real forbidden: the App was uninstalled from this repo, or the token
		// no longer covers it. Nothing to retry.
		return null;
	}
	if (response.status === 401) throw new GithubTokenInvalidError(url);
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`GitHub API error ${response.status}: ${url}`);
	}
	// SAFETY: every non-2xx status is handled above — 404 as null, the rest as a
	// throw — so this is a 200 body. `T` is supplied by each caller from the
	// endpoint it named, and no field is read here.
	return (await response.json()) as T;
};

export const getRepoById = (token: string, id: number) =>
	githubGet<GithubRepo>(`${GITHUB_API}/repositories/${id}`, token);

// A day's commits fit in one page; a multi-week catch-up after downtime does
// not. The single unpaginated request silently truncated at 100 and the engine
// treated the truncated set as the whole window, so the days it did not see were
// filled as if nobody had worked them. Capped, because a runaway loop against a
// paid API is worse than a short answer.
const COMMIT_PAGE_SIZE = 100;
const MAX_COMMIT_PAGES = 10;

export const listCommits = async (
	token: string,
	owner: string,
	repo: string,
	options: { author: string; since: Date; until: Date },
): Promise<GithubCommit[]> => {
	const commits: GithubCommit[] = [];
	for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
		const params = new URLSearchParams({
			author: options.author,
			since: options.since.toISOString(),
			until: options.until.toISOString(),
			per_page: String(COMMIT_PAGE_SIZE),
			page: String(page),
		});
		const batch = await githubGet<GithubCommit[]>(
			`${GITHUB_API}/repos/${owner}/${repo}/commits?${params}`,
			token,
		);
		// null is "forbidden or missing" — for this repo there is nothing to read,
		// which for a first page means no commits and for a later one means the
		// pages already collected are all there is.
		if (!batch) break;
		commits.push(...batch);
		// A short page is the last page. GitHub's commits endpoint has no total
		// count, so this is the only stop signal short of an empty page.
		if (batch.length < COMMIT_PAGE_SIZE) break;
		if (page === MAX_COMMIT_PAGES) {
			console.warn("[github] commit list truncated at the page cap", {
				repo: `${owner}/${repo}`,
				pages: MAX_COMMIT_PAGES,
				collected: commits.length,
			});
		}
	}
	return commits;
};

export const getCommit = (
	token: string,
	owner: string,
	repo: string,
	sha: string,
) =>
	githubGet<GithubCommit>(
		`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`,
		token,
	);

export const getAuthenticatedUser = (token: string) =>
	githubGet<GithubUser>(`${GITHUB_API}/user`, token);

// `username`'s membership of `org`, read with the installation token of the
// App installed on that organization. Not the person's own user token: that
// token comes from GITHUB_CLIENT_ID, which may be a separate OAuth app with no
// grant to read organizations. The installation token needs only the App's
// "Members: read" organization permission, which the organization accepts
// when it installs or updates the App. Without it the answer is a 403, and
// for somebody who is not a member a 404; `githubGet` returns both as null.
export const getOrgMembership = (
	installationToken: string,
	org: string,
	username: string,
) =>
	githubGet<GithubOrgMembership>(
		`${GITHUB_API}/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(username)}`,
		installationToken,
	);

// ── Pull requests (GraphQL) ────────────────────────────────────────────────
// GraphQL rather than REST because REST has no way to ask "the PRs this person
// authored or reviewed" per repo: `/pulls` has no author filter and reviews are
// one more call per PR, and the REST search endpoint allows 30 requests a
// minute, which one sweep spends in seconds. GraphQL search costs a point per
// page against the installation's 5,000 an hour, and carries the person's
// reviews in the same page.
//
// The App needs the "Pull requests: Read" permission for this. Without it
// GitHub answers FORBIDDEN, which reads here as "nothing to see", exactly as a
// 403 does on the commit path.

export type GithubPullRequestReview = {
	id: string;
	state:
		| "APPROVED"
		| "CHANGES_REQUESTED"
		| "COMMENTED"
		| "DISMISSED"
		| "PENDING";
	submittedAt: string | null;
	url: string;
	author: { login: string } | null;
};

export type GithubPullRequest = {
	id: string;
	number: number;
	title: string;
	url: string;
	createdAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	merged: boolean;
	state: "OPEN" | "CLOSED" | "MERGED";
	author: { login: string } | null;
	reviews: { nodes: (GithubPullRequestReview | null)[] | null } | null;
};

type GraphqlError = { type?: string; message: string };

const githubGraphql = async <T>(
	token: string,
	query: string,
	variables: { [name: string]: string | number | null },
): Promise<T | null> => {
	const url = `${GITHUB_API}/graphql`;
	const response = await externalFetch(url, {
		method: "POST",
		headers: { ...githubHeaders(token), "Content-Type": "application/json" },
		body: JSON.stringify({ query, variables }),
	});
	if (response.status === 403 || response.status === 429) {
		const body = await response.text().catch(() => "");
		if (isThrottled(response, body)) throw new GithubRateLimitError(url);
		return null;
	}
	if (!response.ok) {
		throw new Error(`GitHub API error ${response.status}: ${url}`);
	}
	// SAFETY: a 2xx from the GraphQL endpoint is always this envelope; `T` is the
	// shape of the query the caller wrote, and `data` is read only after the
	// error list is checked below.
	const body = (await response.json()) as {
		data?: T | null;
		errors?: GraphqlError[];
	};
	const errors = body.errors ?? [];
	// GraphQL reports its primary limit inside a 200, not as a status code.
	if (errors.some((e) => e.type === "RATE_LIMITED")) {
		throw new GithubRateLimitError(url);
	}
	if (errors.length > 0) {
		// The repo is gone, or the App cannot read its pull requests: the same
		// answer the REST path gives a 403 or a 404.
		if (errors.every((e) => e.type === "NOT_FOUND" || e.type === "FORBIDDEN")) {
			return null;
		}
		throw new Error(
			`GitHub GraphQL error: ${errors.map((e) => e.message).join("; ")}`,
		);
	}
	return body.data ?? null;
};

// `$login` filters the reviews to the person's own, so a PR with forty reviews
// from other people costs nothing extra.
const PULL_REQUEST_FIELDS = `
	id
	number
	title
	url
	createdAt
	closedAt
	mergedAt
	merged
	state
	author { login }
	reviews(first: 100, author: $login) {
		nodes { id state submittedAt url author { login } }
	}
`;

const SEARCH_PULL_REQUESTS = `
	query SearchPullRequests($q: String!, $login: String!, $first: Int!, $after: String) {
		search(type: ISSUE, query: $q, first: $first, after: $after) {
			pageInfo { hasNextPage endCursor }
			nodes { __typename ... on PullRequest { ${PULL_REQUEST_FIELDS} } }
		}
	}
`;

const GET_PULL_REQUEST = `
	query GetPullRequest($owner: String!, $name: String!, $number: Int!, $login: String!) {
		repository(owner: $owner, name: $name) {
			pullRequest(number: $number) { ${PULL_REQUEST_FIELDS} }
		}
	}
`;

// The search query is one string of qualifiers, so a value with a space in it
// would add a qualifier of its own. GitHub logins and repo names cannot carry
// one; this is the check that they do not.
const SEARCH_TERM = /^[A-Za-z0-9._-]+$/;

const PULL_REQUEST_PAGE_SIZE = 50;
const MAX_PULL_REQUEST_PAGES = 10;

/**
 * The pull requests in one repo that `login` authored, or reviewed, and that
 * changed at or after `since`. Every event on a PR updates it, so a PR with no
 * update since `since` has no event since then either.
 */
export const searchPullRequests = async (
	token: string,
	options: {
		owner: string;
		repo: string;
		login: string;
		role: "author" | "reviewed-by";
		since: Date;
	},
): Promise<GithubPullRequest[]> => {
	const { owner, repo, login, role, since } = options;
	if (![owner, repo, login].every((term) => SEARCH_TERM.test(term))) {
		throw new Error(`Unexpected characters in a search term: ${owner}/${repo}`);
	}
	// Second precision with an explicit offset — the form the search syntax
	// documents. `toISOString`'s milliseconds and `Z` are not in it.
	const updated = `${since.toISOString().slice(0, 19)}+00:00`;
	const q = `repo:${owner}/${repo} is:pr ${role}:${login} updated:>=${updated}`;

	const pullRequests: GithubPullRequest[] = [];
	let after: string | null = null;
	for (let page = 1; page <= MAX_PULL_REQUEST_PAGES; page++) {
		const data: {
			search: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				nodes: ((GithubPullRequest & { __typename: string }) | null)[];
			};
		} | null = await githubGraphql(token, SEARCH_PULL_REQUESTS, {
			q,
			login,
			first: PULL_REQUEST_PAGE_SIZE,
			after,
		});
		if (!data) break;
		for (const node of data.search.nodes) {
			if (node?.__typename === "PullRequest") pullRequests.push(node);
		}
		if (!data.search.pageInfo.hasNextPage) break;
		after = data.search.pageInfo.endCursor;
		if (page === MAX_PULL_REQUEST_PAGES) {
			console.warn("[github] pull request search truncated at the page cap", {
				repo: `${owner}/${repo}`,
				role,
				collected: pullRequests.length,
			});
		}
	}
	return pullRequests;
};

export const getPullRequest = async (
	token: string,
	owner: string,
	repo: string,
	number: number,
	login: string,
): Promise<GithubPullRequest | null> => {
	const data = await githubGraphql<{
		repository: { pullRequest: GithubPullRequest | null } | null;
	}>(token, GET_PULL_REQUEST, { owner, name: repo, number, login });
	return data?.repository?.pullRequest ?? null;
};
