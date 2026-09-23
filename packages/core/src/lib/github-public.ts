import { externalFetch } from "./http";

/**
 * Unauthenticated reads of a PUBLIC GitHub repository: its releases and its
 * contributors.
 *
 * No token, on purpose. The repository is public, so anyone can read both, and
 * holding a credential for it would only widen what a leak could reach. The
 * price is GitHub's anonymous budget: 60 requests an hour per IP address,
 * shared by every process behind that address. So every reader goes through
 * `cachedRead` below, which keeps an answer for a fixed time, shares one
 * request between concurrent callers, keeps serving the last good answer when
 * GitHub refuses, and stops asking until GitHub's own reset time when it says
 * the budget is spent.
 */

const GITHUB_API = "https://api.github.com";

/** GitHub said the anonymous budget is spent. `retryAt` is when it resets. */
export class GithubPublicRateLimitError extends Error {
	readonly retryAt: number;
	constructor(retryAt: number) {
		super(
			`GitHub's anonymous rate limit is spent until ${new Date(retryAt).toISOString()}`,
		);
		this.name = "GithubPublicRateLimitError";
		this.retryAt = retryAt;
	}
}

/** When a failure that is NOT a rate limit may be retried. Short, because a
 *  fixed setting should work soon; long enough that a broken one cannot spend
 *  the hourly budget in a burst of installs. */
export const FAILURE_BACKOFF_MS = 60 * 1000;

/** The fallback when GitHub refuses with neither reset header. */
const RATE_LIMIT_FALLBACK_MS = 15 * 60 * 1000;

/**
 * When a refused response may be tried again, or null when it was not a rate
 * limit. GitHub answers a spent primary budget with 403 or 429 and
 * `x-ratelimit-remaining: 0` plus `x-ratelimit-reset` (epoch seconds), and a
 * secondary limit with `retry-after` (seconds).
 */
export const rateLimitRetryAt = (
	response: Response,
	now: number = Date.now(),
): number | null => {
	if (response.status !== 403 && response.status !== 429) return null;
	const retryAfter = Number(response.headers.get("retry-after"));
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return now + retryAfter * 1000;
	}
	if (response.headers.get("x-ratelimit-remaining") === "0") {
		const reset = Number(response.headers.get("x-ratelimit-reset"));
		return Number.isFinite(reset) && reset > 0
			? reset * 1000
			: now + RATE_LIMIT_FALLBACK_MS;
	}
	// A 429 is a rate limit whatever its headers say; a bare 403 is a refusal.
	return response.status === 429 ? now + RATE_LIMIT_FALLBACK_MS : null;
};

/**
 * One anonymous GET against the GitHub API. `path` starts with `/`. A spent
 * budget throws `GithubPublicRateLimitError`; any other answer, a 404 included, is
 * returned for the caller to read.
 */
export const githubPublicGet = async (
	path: string,
	userAgent: string,
): Promise<Response> => {
	const response = await externalFetch(`${GITHUB_API}${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": userAgent,
		},
	});
	const retryAt = rateLimitRetryAt(response);
	if (retryAt !== null) {
		await response.body?.cancel();
		throw new GithubPublicRateLimitError(retryAt);
	}
	return response;
};

type CacheEntry<T> = {
	value: { data: T; at: number } | null;
	pending: Promise<T> | null;
	/** No new request before this time. */
	retryAt: number;
	lastError: Error | null;
};

/**
 * A per-key cache in front of a GitHub read.
 *
 *  - A value younger than `ttlMs` is returned as is.
 *  - Concurrent callers of an expired key share one request, so a burst of
 *    installs (two downloads each, a team at a time) costs one.
 *  - A failed refresh keeps the last good value and returns it. A page that
 *    worked an hour ago keeps working while GitHub refuses.
 *  - After a failure nothing is requested until the rate limit resets, or for
 *    `FAILURE_BACKOFF_MS` after any other error. With no good value to fall
 *    back on, the caller gets the failure again, without a request.
 *
 * The keys are repositories named by the operator, so the map stays small.
 */
export const cachedRead = <T>(ttlMs: number) => {
	const entries = new Map<string, CacheEntry<T>>();

	const read = (key: string, load: () => Promise<T>): Promise<T> => {
		let entry = entries.get(key);
		if (!entry) {
			entry = { value: null, pending: null, retryAt: 0, lastError: null };
			entries.set(key, entry);
		}
		const now = Date.now();
		if (entry.value && now - entry.value.at < ttlMs) {
			return Promise.resolve(entry.value.data);
		}
		if (entry.pending) return entry.pending;
		if (now < entry.retryAt) {
			if (entry.value) return Promise.resolve(entry.value.data);
			if (entry.lastError) return Promise.reject(entry.lastError);
		}

		const current = entry;
		const pending = load().then(
			(data) => {
				current.value = { data, at: Date.now() };
				current.retryAt = 0;
				current.lastError = null;
				return data;
			},
			(error: unknown) => {
				const failure =
					error instanceof Error ? error : new Error(String(error));
				current.lastError = failure;
				current.retryAt =
					failure instanceof GithubPublicRateLimitError
						? failure.retryAt
						: Date.now() + FAILURE_BACKOFF_MS;
				if (current.value) {
					console.warn(
						`[github] kept the last answer for ${key}: ${failure.message}`,
					);
					return current.value.data;
				}
				throw failure;
			},
		);
		current.pending = pending;
		// Cleared whichever way it settles, on a separate chain with both
		// handlers, so a rejection here is not a second, unhandled one.
		pending.then(
			() => {
				current.pending = null;
			},
			() => {
				current.pending = null;
			},
		);
		return pending;
	};

	/** Forget everything. Tests only. */
	const clear = () => entries.clear();

	return { read, clear };
};
