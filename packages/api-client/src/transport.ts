import { ApiClientError } from "./errors";

/** What the client puts in a request: a subset of `RequestInit` that both
 *  the global `fetch` and `expo/fetch` take. */
export type FetchInit = {
	method: string;
	headers: Headers;
	body?: string;
	signal: AbortSignal;
};

/** The part of a `Response` the client reads. `expo/fetch` answers its own
 *  class, which has these members but not every one of the DOM type. */
export type FetchResponse = Pick<
	Response,
	"ok" | "status" | "headers" | "json" | "text" | "body"
>;

export type FetchLike = (
	url: string,
	init: FetchInit,
) => Promise<FetchResponse>;

/** Everything a request needs besides a token. `fetch` and `sleep` are here
 *  so the tests can run the client against a fake server. */
export type Transport = {
	/** The Server address, as `normalizeOrigin` returns it. */
	origin: string;
	fetch: FetchLike;
	/**
	 * The fetch for a streamed answer (the assistant). It must give a
	 * `Response` whose `body` is a `ReadableStream` that fills as the bytes
	 * arrive. React Native's own `fetch` does not, so the app passes
	 * `expo/fetch` here. Without it, `fetch` is used, and the events arrive
	 * together when the answer is complete.
	 */
	streamFetch?: FetchLike;
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
	init: Omit<FetchInit, "signal">,
	timeoutMs: number,
): Promise<FetchResponse> => {
	// `AbortSignal.timeout` is not in React Native, so the timer is our own.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await transport.fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
};

const headersFor = (
	transport: Transport,
	options: SendOptions,
	accept: string,
): Headers => {
	const headers = new Headers({
		accept,
		"user-agent": transport.userAgent,
	});
	if (options.token) headers.set("authorization", `Bearer ${options.token}`);
	if (options.body !== undefined) {
		headers.set("content-type", "application/json");
	}
	return headers;
};

const unreachable = (transport: Transport, error: Error | string) =>
	new ApiClientError(
		"unreachable",
		`Cannot reach ${transport.origin}. Check the address and your connection. (${error instanceof Error ? error.message : error})`,
	);

/**
 * One request with the headers every call carries. A 429 with a short
 * `Retry-After` is waited out here; every other status is the caller's.
 */
export const send = async (
	transport: Transport,
	options: SendOptions,
): Promise<FetchResponse> => {
	const headers = headersFor(transport, options, "application/json");

	for (let attempt = 0; ; attempt++) {
		let response: FetchResponse;
		try {
			response = await fetchWithTimeout(
				transport,
				`${transport.origin}${options.path}`,
				{ method: options.method, headers, body: options.body },
				options.timeoutMs ?? REQUEST_TIMEOUT_MS,
			);
		} catch (error) {
			throw unreachable(
				transport,
				error instanceof Error ? error : String(error),
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

/**
 * A request for a streamed answer (`text/event-stream`). The timeout covers
 * only the wait for the headers: after them, the stream can stay open as long
 * as the server writes, and `signal` is the way to stop it. A 429 is not
 * waited out, because the server's sentence already says when to try again.
 */
export const openStream = async (
	transport: Transport,
	options: SendOptions & { signal?: AbortSignal },
): Promise<FetchResponse> => {
	const controller = new AbortController();
	const stop = () => controller.abort();
	if (options.signal?.aborted) stop();
	options.signal?.addEventListener("abort", stop, { once: true });
	const timer = setTimeout(stop, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
	const fetcher = transport.streamFetch ?? transport.fetch;
	try {
		return await fetcher(`${transport.origin}${options.path}`, {
			method: options.method,
			headers: headersFor(transport, options, "text/event-stream"),
			body: options.body,
			signal: controller.signal,
		});
	} catch (error) {
		// The caller stopped the request: that is its own result, not a
		// network failure to report.
		if (options.signal?.aborted) throw error;
		throw unreachable(
			transport,
			error instanceof Error ? error : String(error),
		);
	} finally {
		clearTimeout(timer);
	}
};

/** The JSON body, or null when there is none or it does not parse. */
export const readJson = async (
	response: FetchResponse,
): Promise<ReturnType<typeof JSON.parse> | null> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};
