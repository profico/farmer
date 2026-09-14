import {
	type ApiMeta,
	CLI_USER_AGENT_PREFIX,
	CLI_VERSION_HEADER,
	isCliVersionSupported,
} from "@farmer/core/api";
import { z } from "zod";

import { CliError, UsageError } from "./errors";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Everything a request needs besides a token. `fetch` and `sleep` are here
 *  so the tests can run the whole client against a fake server. */
export type Transport = {
	origin: string;
	fetch: FetchLike;
	sleep: (ms: number) => Promise<void>;
	version: string;
	platform: NodeJS.Platform;
	arch: string;
};

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type SendOptions = {
	method: HttpMethod;
	path: string;
	token: string | null;
	body?: string;
	timeoutMs?: number;
};

const REQUEST_TIMEOUT_MS = 30_000;
/** A wait up to this long is sat out; a longer one is reported, because a
 *  person at a prompt would rather be told than stare at a frozen terminal. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * `farmer-cli/0.1.0 (linux; x64)`. Load-bearing: the device-token request
 * creates the session, the session records this header, and Preferences →
 * Signed-in devices names the row "Farmer CLI" from it.
 */
export const userAgent = (transport: Transport) =>
	`${CLI_USER_AGENT_PREFIX}${transport.version} (${transport.platform}; ${transport.arch})`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const isLocalOrigin = (origin: string) =>
	LOCAL_HOSTS.has(new URL(origin).hostname);

/**
 * The origin of a server address as a person types it: `farmer.example.com`,
 * `https://farmer.example.com/acme/time`, `localhost:3000`. A bare host gets
 * `https://`, except a local one, which is almost always a dev server on http.
 */
export const normalizeOrigin = (input: string): string => {
	const trimmed = input.trim();
	if (!trimmed) throw new UsageError("Enter the address of the Farmer server.");
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
	const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed);
	const withScheme = hasScheme
		? trimmed
		: `${local ? "http" : "https"}://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new UsageError(`"${input}" is not a server address.`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new UsageError(`"${input}" is not an http or https address.`);
	}
	return url.origin;
};

export const updateCommand = (origin: string, platform: NodeJS.Platform) =>
	platform === "win32"
		? `irm ${origin}/cli | iex`
		: `curl -fsSL ${origin}/cli | sh`;

export const outdatedMessage = (origin: string, platform: NodeJS.Platform) =>
	`This version of farmer is too old for ${origin}. Update it with:\n  ${updateCommand(origin, platform)}`;

/** Seconds from a `Retry-After` header, which is either a number of seconds
 *  or an HTTP date. */
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

/**
 * One request with the headers every call carries. A 429 with a short
 * `Retry-After` is waited out and retried here, so no command has to know about
 * rate limits; every other status is the caller's to read.
 */
export const send = async (
	transport: Transport,
	options: SendOptions,
): Promise<Response> => {
	const headers = new Headers({
		accept: "application/json",
		"user-agent": userAgent(transport),
		[CLI_VERSION_HEADER]: transport.version,
	});
	if (options.token) headers.set("authorization", `Bearer ${options.token}`);
	if (options.body !== undefined) {
		headers.set("content-type", "application/json");
	}

	for (let attempt = 0; ; attempt++) {
		let response: Response;
		try {
			response = await transport.fetch(`${transport.origin}${options.path}`, {
				method: options.method,
				headers,
				body: options.body,
				signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new CliError(`Cannot reach ${transport.origin}: ${reason}`);
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
			throw new CliError(
				wait === null
					? `${transport.origin} is limiting requests. Try again in a minute.`
					: `${transport.origin} is limiting requests. Try again in ${wait} seconds.`,
			);
		}
		await transport.sleep(wait * 1000);
	}
};

const apiErrorBody = z.object({
	error: z.string(),
	code: z.string(),
	issues: z
		.array(z.object({ path: z.string(), message: z.string() }))
		.optional(),
});

/** The sentence an `ApiError` carries, with its issues, or the status when
 *  the body is not one (a proxy's HTML error page). */
const failureMessage = async (response: Response, origin: string) => {
	let parsed: ReturnType<typeof apiErrorBody.safeParse> | null = null;
	try {
		parsed = apiErrorBody.safeParse(await response.json());
	} catch {
		parsed = null;
	}
	if (!parsed?.success) {
		return `${origin} answered ${response.status} ${response.statusText}`.trim();
	}
	const issues = (parsed.data.issues ?? []).map(
		(issue) => `  ${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
	);
	return [parsed.data.error, ...issues].join("\n");
};

export type ApiClientOptions = {
	transport: Transport;
	token: string;
	/** Deletes the stored token. Called when the server says it is dead. */
	forgetToken: () => Promise<void>;
};

const ORG_ROUTE_PREFIX = "/api/v1/orgs/";

export class ApiClient {
	readonly #options: ApiClientOptions;

	constructor(options: ApiClientOptions) {
		this.#options = options;
	}

	get origin(): string {
		return this.#options.transport.origin;
	}

	get<T>(path: string): Promise<T> {
		return this.#json<T>("GET", path, undefined, undefined);
	}

	post<T, B = undefined>(path: string, body?: B, timeoutMs?: number) {
		return this.#json<T>(
			"POST",
			path,
			body === undefined ? undefined : JSON.stringify(body),
			timeoutMs,
		);
	}

	patch<T, B>(path: string, body: B): Promise<T> {
		return this.#json<T>("PATCH", path, JSON.stringify(body), undefined);
	}

	delete<T>(path: string): Promise<T> {
		return this.#json<T>("DELETE", path, undefined, undefined);
	}

	async #json<T>(
		method: HttpMethod,
		path: string,
		body: string | undefined,
		timeoutMs: number | undefined,
	): Promise<T> {
		const { transport, token } = this.#options;
		const response = await send(transport, {
			method,
			path,
			token,
			body,
			timeoutMs,
		});
		if (response.ok) {
			// SAFETY: every `/api/v1` route answers the projection declared for it
			// in `@farmer/core/api`, and a 2xx status says this is that answer
			// rather than an `ApiError`. A server whose projections this binary
			// cannot read answers 426 first, through `minCliVersion`.
			return (await response.json()) as T;
		}
		throw await this.#failure(response, path);
	}

	async #failure(response: Response, path: string): Promise<CliError> {
		const { transport } = this.#options;
		if (response.status === 401) {
			// An org route answers 401 for a slug the caller is not in as well as
			// for a dead token — one answer on purpose, so a token cannot probe
			// for workspaces. `/me` tells the two apart without that leak, and it
			// keeps somebody who left one workspace signed in to the others.
			if (
				path.startsWith(ORG_ROUTE_PREFIX) &&
				(await this.#tokenStillValid())
			) {
				const slug = decodeURIComponent(
					path.slice(ORG_ROUTE_PREFIX.length).split("/")[0] ?? "",
				);
				return new CliError(
					`You have no access to the organization "${slug}" on ${transport.origin}. Run \`farmer org list\` to see yours.`,
				);
			}
			await this.#options.forgetToken();
			return new CliError(
				`Your session on ${transport.origin} has ended. Run \`farmer login\` to sign in again.`,
			);
		}
		if (response.status === 426) {
			return new CliError(
				outdatedMessage(transport.origin, transport.platform),
			);
		}
		return new CliError(await failureMessage(response, transport.origin));
	}

	async #tokenStillValid(): Promise<boolean> {
		const response = await send(this.#options.transport, {
			method: "GET",
			path: "/api/v1/me",
			token: this.#options.token,
		});
		return response.ok;
	}
}

const metaBody = z.object({
	app: z.literal("farmer"),
	cliEnabled: z.boolean(),
	minCliVersion: z.string(),
});

/** `GET /api/v1/meta`, parsed: the answer is also the proof that the address
 *  the person typed is a Farmer server at all. */
export const fetchMeta = async (transport: Transport): Promise<ApiMeta> => {
	const notFarmer = new CliError(
		`${transport.origin} does not look like a Farmer server. Check the address.`,
	);
	const response = await send(transport, {
		method: "GET",
		path: "/api/v1/meta",
		token: null,
	});
	if (!response.ok) throw notFarmer;
	let parsed: ReturnType<typeof metaBody.safeParse>;
	try {
		parsed = metaBody.safeParse(await response.json());
	} catch {
		throw notFarmer;
	}
	if (!parsed.success) throw notFarmer;
	return parsed.data;
};

export const assertCliSupported = (meta: ApiMeta, transport: Transport) => {
	if (!meta.cliEnabled) {
		throw new CliError(
			`The command-line tool is switched off on ${transport.origin}. Ask the administrator of that server.`,
		);
	}
	if (!isCliVersionSupported(transport.version, meta.minCliVersion)) {
		throw new CliError(outdatedMessage(transport.origin, transport.platform));
	}
};
