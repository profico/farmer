// Reading commits out of GitHub, with the two failure modes that used to be
// invisible.
//
//   - `listCommits` made ONE request at per_page=100 and returned whatever came
//     back. A day's commits fit; a multi-week catch-up after downtime does not.
//     The engine treated the truncated set as the whole window and filled the
//     days it never saw as if nobody had worked them.
//   - `githubGet` mapped every 403 to null, so a rate-limit response was
//     indistinguishable from "this repo has no commits". The sweep wrote
//     nothing, reported success, and logged nothing.
//
// These go through `globalThis.fetch` rather than a seam because the client is
// the layer under the seam — `ports.ts` substitutes the service above it.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import crypto from "node:crypto";

import {
	type GithubCommit,
	GithubRateLimitError,
	getRepoContentsReadToken,
	listCommits,
} from "./github-client";

const realFetch = globalThis.fetch;

/** Every URL the code under test asked for, in order. */
let requested: string[] = [];

type Reply = {
	status?: number;
	headers?: Record<string, string>;
	body?: unknown;
};

/** Answers each request from `replies` in order; the last one repeats. */
const respondWith = (replies: Reply[]) => {
	requested = [];
	// SAFETY: a test stub for `fetch`. It accepts the argument shapes the code
	// under test actually passes rather than restating the full overload set; a
	// call outside that shape fails the test loudly instead of silently passing.
	globalThis.fetch = (async (input: string | URL | Request) => {
		requested.push(String(input instanceof Request ? input.url : input));
		const reply =
			replies[Math.min(requested.length - 1, replies.length - 1)] ?? {};
		return new Response(JSON.stringify(reply.body ?? []), {
			status: reply.status ?? 200,
			headers: { "content-type": "application/json", ...reply.headers },
		});
	}) as typeof fetch;
};

const commit = (sha: string): GithubCommit => ({
	sha,
	html_url: `https://github.com/acme/repo/commit/${sha}`,
	commit: { message: `fix: ${sha}`, author: { date: "2026-08-10T12:00:00Z" } },
	author: { login: "tester" },
});

const page = (n: number, count: number) =>
	Array.from({ length: count }, (_, i) => commit(`p${n}-c${i}`));

const OPTS = {
	author: "tester",
	since: new Date("2026-08-01T00:00:00Z"),
	until: new Date("2026-08-31T23:59:59Z"),
};

const fetchCommits = () => listCommits("tok", "acme", "repo", OPTS);

beforeEach(() => {
	requested = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("listCommits pagination", () => {
	test("a short first page is the whole answer, in one request", async () => {
		respondWith([{ body: page(1, 12) }]);

		const commits = await fetchCommits();

		expect(commits).toHaveLength(12);
		expect(requested).toHaveLength(1);
		expect(requested[0]).toContain("page=1");
		expect(requested[0]).toContain("per_page=100");
	});

	test("a full page is followed by the next one", async () => {
		respondWith([{ body: page(1, 100) }, { body: page(2, 30) }]);

		const commits = await fetchCommits();

		// The regression: this used to be 100, silently.
		expect(commits).toHaveLength(130);
		expect(requested).toHaveLength(2);
		expect(requested[1]).toContain("page=2");
	});

	test("an exactly-full last page stops on the following empty one", async () => {
		respondWith([{ body: page(1, 100) }, { body: page(2, 100) }, { body: [] }]);

		expect(await fetchCommits()).toHaveLength(200);
		expect(requested).toHaveLength(3);
	});

	test("pagination is capped rather than unbounded", async () => {
		// Every page full, forever — a repo big enough (or an API confused enough)
		// to loop on.
		respondWith([{ body: page(1, 100) }]);

		const commits = await fetchCommits();

		expect(requested).toHaveLength(10);
		expect(commits).toHaveLength(1000);
	});

	test("an empty repo returns nothing after one request", async () => {
		respondWith([{ body: [] }]);

		expect(await fetchCommits()).toEqual([]);
		expect(requested).toHaveLength(1);
	});

	test("the author and window are passed on every page", async () => {
		respondWith([{ body: page(1, 100) }, { body: page(2, 1) }]);

		await fetchCommits();

		for (const url of requested) {
			expect(url).toContain("author=tester");
			expect(url).toContain("since=2026-08-01");
			expect(url).toContain("until=2026-08-31");
		}
	});
});

describe("403 is two different answers", () => {
	test("a rate-limited 403 throws instead of reading as 'no commits'", async () => {
		respondWith([
			{
				status: 403,
				headers: { "x-ratelimit-remaining": "0" },
				body: { message: "API rate limit exceeded" },
			},
		]);

		await expect(fetchCommits()).rejects.toThrow(GithubRateLimitError);
	});

	test("a secondary rate limit (retry-after) also throws", async () => {
		respondWith([
			{
				status: 403,
				headers: { "retry-after": "60" },
				body: { message: "You have exceeded a secondary rate limit" },
			},
		]);

		await expect(fetchCommits()).rejects.toThrow(GithubRateLimitError);
	});

	test("a 429 throws", async () => {
		respondWith([{ status: 429, body: { message: "Too many requests" } }]);

		await expect(fetchCommits()).rejects.toThrow(GithubRateLimitError);
	});

	test("a genuine forbidden still degrades to no commits", async () => {
		// The App was uninstalled from this repo, or the token no longer covers it.
		// Nothing to retry, and one inaccessible repo must not fail the sweep.
		respondWith([
			{
				status: 403,
				headers: { "x-ratelimit-remaining": "4999" },
				body: { message: "Resource not accessible by integration" },
			},
		]);

		expect(await fetchCommits()).toEqual([]);
	});

	test("a 404 still degrades to no commits", async () => {
		respondWith([{ status: 404, body: { message: "Not Found" } }]);

		expect(await fetchCommits()).toEqual([]);
	});

	test("a rate limit hit on page two throws rather than truncating", async () => {
		respondWith([
			{ body: page(1, 100) },
			{
				status: 403,
				headers: { "x-ratelimit-remaining": "0" },
				body: { message: "API rate limit exceeded" },
			},
		]);

		await expect(fetchCommits()).rejects.toThrow(GithubRateLimitError);
	});

	test("a 500 still throws as a plain API error", async () => {
		respondWith([{ status: 500, body: { message: "boom" } }]);

		await expect(fetchCommits()).rejects.toThrow("GitHub API error 500");
	});
});

// The CLI download route's token. What matters is what it cannot do: it must
// be narrowed to one repository and Contents: read when it is minted, because
// the installation behind it also reads pull requests on every repository.
describe("getRepoContentsReadToken", () => {
	const savedAppId = process.env.GITHUB_APP_ID;
	const savedKey = process.env.GITHUB_APP_PRIVATE_KEY;

	/** The body of every POST, in order. */
	let posted: string[] = [];

	const stubGithub = (replies: Reply[]) => {
		respondWith(replies);
		const answer = globalThis.fetch;
		// SAFETY: wraps the stub `respondWith` just installed, with the same
		// accepted argument shapes; it only records the request body first.
		globalThis.fetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			if (init?.method === "POST") posted.push(String(init.body));
			return answer(input, init);
		}) as typeof fetch;
	};

	beforeAll(() => {
		const { privateKey } = crypto.generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		process.env.GITHUB_APP_ID = "12345";
		process.env.GITHUB_APP_PRIVATE_KEY =
			Buffer.from(privateKey).toString("base64");
	});

	afterAll(() => {
		// Assigning `undefined` would store the string "undefined".
		if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
		else process.env.GITHUB_APP_ID = savedAppId;
		if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
		else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
	});

	beforeEach(() => {
		posted = [];
	});

	test("an App not installed on the repository is null, not an error", async () => {
		stubGithub([{ status: 404, body: { message: "Not Found" } }]);

		expect(await getRepoContentsReadToken("acme", "absent")).toBeNull();
		expect(requested).toEqual([
			"https://api.github.com/repos/acme/absent/installation",
		]);
	});

	test("the token is minted for that repository and Contents: read only", async () => {
		const expires = new Date(Date.now() + 60 * 60_000).toISOString();
		stubGithub([
			{ body: { id: 77 } },
			{ status: 201, body: { token: "narrow", expires_at: expires } },
		]);

		expect(await getRepoContentsReadToken("acme", "cli")).toBe("narrow");
		expect(requested[1]).toBe(
			"https://api.github.com/app/installations/77/access_tokens",
		);
		expect(posted.map((body) => JSON.parse(body))).toEqual([
			{ repositories: ["cli"], permissions: { contents: "read" } },
		]);

		// Cached until near expiry: a burst of installs mints once.
		requested = [];
		expect(await getRepoContentsReadToken("acme", "cli")).toBe("narrow");
		expect(requested).toEqual([]);
	});

	test("a refused mint throws, so the route reports an upstream error", async () => {
		stubGithub([
			{ body: { id: 78 } },
			{ status: 422, body: { message: "no access to repository" } },
		]);

		await expect(getRepoContentsReadToken("acme", "denied")).rejects.toThrow(
			"GitHub API error 422",
		);
	});
});
