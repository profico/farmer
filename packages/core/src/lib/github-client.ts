import crypto from "node:crypto";
import { externalFetch } from "./http";

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
	(typeof input === "string" ? Buffer.from(input) : input).toString(
		"base64url",
	);

let cachedAppJwt: { token: string; expiresAt: number } | null = null;

const appJwt = (): string => {
	// Reuse until 1min before expiry to avoid re-signing on every call.
	if (cachedAppJwt && cachedAppJwt.expiresAt - 60_000 > Date.now()) {
		return cachedAppJwt.token;
	}
	const appId = process.env.GITHUB_APP_ID;
	const pemB64 = process.env.GITHUB_APP_PRIVATE_KEY;
	if (!appId || !pemB64) {
		throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not configured");
	}
	const pem = Buffer.from(pemB64, "base64").toString("utf8");
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
	cachedAppJwt = { token, expiresAt: (now + 9 * 60) * 1000 };
	return token;
};

const appHeaders = () => githubHeaders(appJwt());

export type GithubInstallation = {
	id: number;
	account: { login: string; type: string } | null;
};

// Installations the *user* can administer, per their OAuth token. This is the
// authorization gate for connecting an installation to an org: a user may only
// attach an installation that shows up here, so they can't hijack a stranger's
// installation_id to read repos they don't control.
export const listUserInstallations = async (
	userToken: string,
): Promise<GithubInstallation[]> => {
	const response = await externalFetch(
		`${GITHUB_API}/user/installations?per_page=100`,
		{ headers: githubHeaders(userToken) },
	);
	if (!response.ok) {
		throw new Error(`GitHub API error ${response.status}: /user/installations`);
	}
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
	if (!response.ok) {
		throw new Error(
			`GitHub API error ${response.status}: mint installation token`,
		);
	}
	const body = (await response.json()) as { token: string; expires_at: string };
	installationTokenCache.set(installationId, {
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

export type GithubUser = { login: string };

/** A 403/429 that means "slow down", not "you may not see this".
 *
 *  These two answers arrive on the same status code and used to be collapsed
 *  into the same `null`, so a rate-limited sweep was indistinguishable from a
 *  repository with no commits: the engine wrote nothing, reported success, and
 *  logged nothing. A throw makes the sweep record a failure it can retry. */
export class GithubRateLimitError extends Error {
	constructor(url: string) {
		super(`GitHub rate limit reached: ${url}`);
		this.name = "GithubRateLimitError";
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
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`GitHub API error ${response.status}: ${url}`);
	}
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
