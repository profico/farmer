import { ApiClientError } from "./errors";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Everything a request needs besides a token. `fetch` and `sleep` are here
 *  so the tests can run the client against a fake server. */
export type Transport = {
	/** The Server address, as `normalizeOrigin` returns it. */
	origin: string;
	fetch: FetchLike;
	sleep: (ms: number) => Promise<void>;
	/** `farmer-mobile/0.1.0 (android 15)`. */
	userAgent: string;
};

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type SendOptions = {
	method: HttpMethod;
	path: string;
	token: string | null;
	body?: string;
	timeoutMs?: number;
};

const REQUEST_TIMEOUT_MS = 20_000;
/** A wait up to this long is sat out; a longer one is reported. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 15;
const MAX_RATE_LIMIT_RETRIES = 2;

/** Seconds from a `Retry-After` header: a number of seconds or an HTTP date. */
export const retryAfterSeconds = (
	header: string | null,
	nowMs: number,
): number | null => {
	if (!header) return null;
	const trimmed = header.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const at = Date.parse(trimmed);
	return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - nowMs) / 1000));
};

const fetchWithTimeout = async (
	transport: Transport,
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> => {
	// `AbortSignal.timeout` is not in React Native, so the timer is our own.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await transport.fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
};

/**
 * One request with the headers every call carries. A 429 with a short
 * `Retry-After` is waited out here; every other status is the caller's.
 */
export const send = async (
	transport: Transport,
	options: SendOptions,
): Promise<Response> => {
	const headers = new Headers({
		accept: "application/json",
		"user-agent": transport.userAgent,
	});
	if (options.token) headers.set("authorization", `Bearer ${options.token}`);
	if (options.body !== undefined) {
		headers.set("content-type", "application/json");
	}

	for (let attempt = 0; ; attempt++) {
		let response: Response;
		try {
			response = await fetchWithTimeout(
				transport,
				`${transport.origin}${options.path}`,
				{ method: options.method, headers, body: options.body },
				options.timeoutMs ?? REQUEST_TIMEOUT_MS,
			);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new ApiClientError(
				"unreachable",
				`Cannot reach ${transport.origin}. Check the address and your connection. (${reason})`,
			);
		}
		if (response.status !== 429) return response;

		const wait = retryAfterSeconds(
			response.headers.get("retry-after"),
			Date.now(),
		);
		if (
			wait === null ||
			wait > MAX_RATE_LIMIT_WAIT_SECONDS ||
			attempt >= MAX_RATE_LIMIT_RETRIES
		) {
			throw new ApiClientError(
				"http",
				wait === null
					? "The server is limiting requests. Try again in a minute."
					: `The server is limiting requests. Try again in ${wait} seconds.`,
				{ status: 429, code: "rate_limited" },
			);
		}
		await transport.sleep(wait * 1000);
	}
};

/** The JSON body, or null when there is none or it does not parse. */
export const readJson = async (
	response: Response,
): Promise<ReturnType<typeof JSON.parse> | null> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};
