// The anonymous GitHub reads behind the CLI download and the contributors card.
// The budget is 60 requests an hour per IP address, so what matters is how
// rarely the cache asks, and that a refusal never costs a working answer.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	cachedRead,
	FAILURE_BACKOFF_MS,
	GithubPublicRateLimitError,
	githubPublicGet,
	rateLimitRetryAt,
} from "./github-public";

const realFetch = globalThis.fetch;
const realNow = Date.now;

let now = 1_000_000;

beforeEach(() => {
	now = 1_000_000;
	Date.now = () => now;
});

afterEach(() => {
	Date.now = realNow;
	globalThis.fetch = realFetch;
});

describe("rateLimitRetryAt", () => {
	const reply = (status: number, headers: Record<string, string> = {}) =>
		new Response(null, { status, headers });

	test("a spent primary budget waits for GitHub's reset time", () => {
		const response = reply(403, {
			"x-ratelimit-remaining": "0",
			"x-ratelimit-reset": "2000",
		});
		expect(rateLimitRetryAt(response, 0)).toBe(2_000_000);
	});

	test("a secondary limit waits for retry-after", () => {
		expect(rateLimitRetryAt(reply(429, { "retry-after": "30" }), 5)).toBe(
			30_005,
		);
	});

	test("a plain 403 or any other status is not a rate limit", () => {
		expect(rateLimitRetryAt(reply(403))).toBeNull();
		expect(rateLimitRetryAt(reply(404))).toBeNull();
		expect(rateLimitRetryAt(reply(200))).toBeNull();
	});
});

describe("githubPublicGet", () => {
	test("sends no credential, and throws on a spent budget", async () => {
		let sent: Headers | null = null;
		// SAFETY: a stub for the one call shape `externalFetch` makes, a URL and
		// an init object; nothing else calls fetch in this test.
		globalThis.fetch = (async (_input: string, init?: RequestInit) => {
			sent = new Headers(init?.headers);
			return new Response("{}", {
				status: 403,
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9" },
			});
		}) as typeof fetch;

		const error = await githubPublicGet("/repos/a/b/releases", "test").catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(GithubPublicRateLimitError);
		expect(sent).not.toBeNull();
		expect(new Headers(sent ?? undefined).get("authorization")).toBeNull();
	});
});

describe("cachedRead", () => {
	test("a fresh value is served without asking again", async () => {
		const cache = cachedRead<number>(1000);
		let calls = 0;
		const load = async () => ++calls;

		expect(await cache.read("r", load)).toBe(1);
		now += 999;
		expect(await cache.read("r", load)).toBe(1);
		now += 1;
		expect(await cache.read("r", load)).toBe(2);
		expect(calls).toBe(2);
	});

	test("concurrent callers share one request", async () => {
		const cache = cachedRead<string>(1000);
		let calls = 0;
		let release: (value: string) => void = () => {};
		const load = () => {
			calls++;
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		};

		const first = cache.read("r", load);
		const second = cache.read("r", load);
		release("answer");
		expect(await first).toBe("answer");
		expect(await second).toBe("answer");
		expect(calls).toBe(1);
	});

	test("a failed refresh keeps serving the last good answer", async () => {
		const cache = cachedRead<string>(1000);
		expect(await cache.read("r", async () => "good")).toBe("good");
		now += 2000;
		expect(
			await cache.read("r", async () => {
				throw new Error("GitHub is down");
			}),
		).toBe("good");
	});

	test("a spent budget stops every request until the reset", async () => {
		const cache = cachedRead<string>(1000);
		let calls = 0;
		const limited = async (): Promise<string> => {
			calls++;
			throw new GithubPublicRateLimitError(now + 60_000);
		};

		await expect(cache.read("r", limited)).rejects.toBeInstanceOf(
			GithubPublicRateLimitError,
		);
		now += 59_999;
		await expect(cache.read("r", limited)).rejects.toBeInstanceOf(
			GithubPublicRateLimitError,
		);
		expect(calls).toBe(1);

		now += 1;
		expect(await cache.read("r", async () => "back")).toBe("back");
	});

	test("any other failure waits the short backoff before a retry", async () => {
		const cache = cachedRead<string>(1000);
		let calls = 0;
		const broken = async (): Promise<string> => {
			calls++;
			throw new Error("GitHub answered 500");
		};

		await expect(cache.read("r", broken)).rejects.toThrow(
			"GitHub answered 500",
		);
		now += FAILURE_BACKOFF_MS - 1;
		await expect(cache.read("r", broken)).rejects.toThrow(
			"GitHub answered 500",
		);
		expect(calls).toBe(1);

		now += 1;
		await expect(cache.read("r", broken)).rejects.toThrow(
			"GitHub answered 500",
		);
		expect(calls).toBe(2);
	});

	test("keys are cached apart", async () => {
		const cache = cachedRead<string>(1000);
		expect(await cache.read("a", async () => "a")).toBe("a");
		expect(await cache.read("b", async () => "b")).toBe("b");
	});
});
