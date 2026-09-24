// What happens to a GitHub user token when two callers refresh it at once.
//
// `GITHUB_CLIENT_ID` is a GitHub App client id, so the user token is a
// user-to-server token: it dies after 8 hours, and its refresh token is single
// use — GitHub invalidates the old one the moment a new pair is issued.
//
// GitHub answers a spent refresh token with HTTP **200** and an `error` body,
// which better-auth's refresh helper does not read as a failure. It then
// stores the tokens it "got" — every field undefined — and writes the refresh
// token it had READ back over the fresh one the other caller just stored. The
// account is dead from that second on, and only the person reconnecting ends
// it. `githubService.connectionStatus` renders that as the reconnect banner.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
} from "bun:test";

import { symmetricDecrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { account, user } from "../db/schema/auth";
import {
	setGithubClientForTests,
	githubService,
} from "../services/github.service";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";

const USER = "u-github-refresh";
const ORG = "org-github-refresh";
const ACCOUNT = "account-github-refresh";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

const OLD_ACCESS = "ghu_theExpiredAccessToken";
const OLD_REFRESH = "ghr_theRefreshTokenBothCallersRead";
const NEW_ACCESS = "ghu_theTokenTheWinnerStored";
const NEW_REFRESH = "ghr_theTokenTheWinnerStored";

/** Six months, as GitHub issues a user-to-server refresh token. */
const REFRESH_TOKEN_TTL_SECONDS = 15_897_600;
/** Eight hours, as GitHub issues a user-to-server access token. */
const ACCESS_TOKEN_TTL_SECONDS = 28_800;

let harness: TestDb;
const realFetch = globalThis.fetch;

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
	let resolve = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

/** Every token-endpoint request this test served. */
let tokenRequests = 0;
let arrived: Deferred[] = [];
let held: Deferred[] = [];

const stored = async () =>
	present(
		await db.query.account.findFirst({
			where: eq(account.id, ACCOUNT),
			columns: {
				accessToken: true,
				refreshToken: true,
				accessTokenExpiresAt: true,
				refreshTokenExpiresAt: true,
			},
		}),
		"the account row",
	);

/** better-auth's own test for "this is ciphertext" — a stored token is only
 *  encrypted once something has written it through `setTokenUtil`. */
const looksEncrypted = (token: string) =>
	token.startsWith("$ba$") ||
	(token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));

const open = async (value: string | null) => {
	const stored = present(value, "a stored token");
	if (!looksEncrypted(stored)) return stored;
	return symmetricDecrypt({
		key: (await auth.$context).secretConfig,
		data: stored,
	});
};

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(user).values({
		id: USER,
		name: "Refresh",
		email: "refresh@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
});

afterAll(async () => {
	globalThis.fetch = realFetch;
	setGithubClientForTests(null);
	await harness.close();
});

beforeEach(async () => {
	tokenRequests = 0;
	arrived = [deferred(), deferred(), deferred()];
	held = [deferred(), deferred(), deferred()];

	await db.delete(account).where(eq(account.id, ACCOUNT));
	await db.insert(account).values({
		id: ACCOUNT,
		accountId: "999",
		providerId: "github",
		userId: USER,
		accessToken: OLD_ACCESS,
		refreshToken: OLD_REFRESH,
		// Expired an hour ago, so every caller refreshes.
		accessTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	// GitHub's own answers: the first request spends the refresh token and gets
	// a new pair; every later one holding the same token is refused. Both are
	// HTTP 200, which is the whole problem.
	// SAFETY: the parameters and the return value are `fetch`'s own, and every
	// request this does not serve is handed to the real one unchanged. The
	// assertion only restores the overloads TypeScript drops from an async
	// arrow.
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (!url.startsWith(TOKEN_ENDPOINT)) return realFetch(input, init);
		const index = tokenRequests++;
		present(arrived[index], "an arrival slot").resolve();
		await present(held[index], "a hold slot").promise;
		const body =
			index === 0
				? {
						access_token: NEW_ACCESS,
						refresh_token: NEW_REFRESH,
						token_type: "bearer",
						scope: "",
						expires_in: ACCESS_TOKEN_TTL_SECONDS,
						refresh_token_expires_in: REFRESH_TOKEN_TTL_SECONDS,
					}
				: {
						error: "bad_refresh_token",
						error_description:
							"The refresh token passed is incorrect or expired.",
					};
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	setGithubClientForTests(null);
});

const askForToken = () =>
	auth.api.getAccessToken({ body: { providerId: "github", userId: USER } });

test("a refused refresh never overwrites the token another caller just stored", async () => {
	const winner = askForToken().catch((error: unknown) => error);
	const loser = askForToken().catch((error: unknown) => error);

	// Both callers have read the account row: each is inside its own token
	// request, which only happens after the read.
	await present(arrived[0], "the first arrival").promise;
	await present(arrived[1], "the second arrival").promise;

	// The winner spends the refresh token and stores the new pair.
	present(held[0], "the first hold").resolve();
	await winner;
	expect(await open((await stored()).refreshToken)).toBe(NEW_REFRESH);

	// The loser is refused, and must leave the row alone.
	present(held[1], "the second hold").resolve();
	await loser;

	const row = await stored();
	expect(await open(row.refreshToken)).toBe(NEW_REFRESH);
	expect(await open(row.accessToken)).toBe(NEW_ACCESS);
	// The fingerprint of the clobber in production: a refresh-token expiry
	// OLDER than the access-token expiry, because the loser put back the one it
	// had read.
	expect(
		present(row.refreshTokenExpiresAt, "the refresh token expiry").getTime(),
	).toBeGreaterThan(
		present(row.accessTokenExpiresAt, "the access token expiry").getTime(),
	);
});

test("two concurrent readers refresh once, and neither is told to reconnect", async () => {
	setGithubClientForTests({
		getAuthenticatedUser: async (token: string) => {
			if (token !== NEW_ACCESS) throw new Error(`refused token: ${token}`);
			return { login: "octocat" };
		},
	});

	const ctx = { organizationId: ORG, userId: USER };
	const both = Promise.all([
		githubService.connectionStatus(ctx),
		githubService.connectionStatus(ctx),
	]);

	await present(arrived[0], "the first arrival").promise;
	present(held[0], "the first hold").resolve();
	present(held[1], "the second hold").resolve();
	present(held[2], "the third hold").resolve();

	const [first, second] = await both;
	expect(first).toEqual({
		connected: true,
		login: "octocat",
		unreachable: false,
		needsReconnect: false,
	});
	expect(second).toEqual(first);
	// One expiry, one refresh: the second caller waited for the first rather
	// than spending the refresh token a second time.
	expect(tokenRequests).toBe(1);
});
