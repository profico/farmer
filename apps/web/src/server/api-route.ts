import {
	type ApiError,
	type ApiIssue,
	CLI_VERSION_HEADER,
	isCliVersionSupported,
} from "@farmer/core/api";
import type { JsonValue } from "@farmer/core/lib/json";
import type { Ctx } from "@farmer/core/services";
import { z } from "zod";

// Type-only, so it is erased and `posthog-node` never reaches the client graph
// through this module. The values come from the deferred import in `serve`.
import type { ApiRequestReport } from "#/lib/posthog-api.ts";
import { resolveCliOrgContext, resolveCliUser } from "#/server/api-auth.ts";
import {
	type Admission,
	admitCaller,
	admitRequest,
	admitWrite,
	callerAddress,
	recordAuthFailure,
} from "#/server/api-rate-limit.ts";

/**
 * The one pipeline every CLI route runs — `/api/v1/me`, `/api/v1/session` and
 * everything under `/api/v1/orgs/$orgSlug`.
 *
 * A helper around server ROUTES, which ADR 0001 does not forbid: that decision
 * is about generating `createServerFn` declarations, and these are ordinary
 * runtime functions. The steps run in a fixed order, and the order is the
 * point of having one helper rather than seventeen handlers that each remember
 * it:
 *
 *  1. `CLI_ENABLED` — 404 before anything else, so a switched-off surface has
 *     no endpoint rather than one that authenticates and then refuses.
 *  2. The per-address limit, before any database read. Resolving a credential
 *     is a session read and a membership read; a flood of bad tokens must not
 *     cost those.
 *  3. The CLI version header — 426 for a binary too old to read the answer,
 *     before it gets an answer to misread. A request without the header is a
 *     browser or a script, and is let through.
 *  4. The credential. See `authenticate` below for why the cookie counts only
 *     on a GET.
 *  5. The per-user limits, and the write limit for anything that is not a GET.
 *  6. The Zod parse, with the schema from `@farmer/core/schema` that the web
 *     app's own server function uses. Never a hand-written check: that is how
 *     `api/v1/time-entries` once lost the 62-day ceiling.
 *  7. The service call, and the error mapping in `failure`.
 *
 * Every error body is an `ApiError`, because an installed CLI branches on its
 * `code`.
 *
 * Not imported by anything the browser loads, and every `@farmer/core` import
 * that reaches the database is deferred into a function body regardless —
 * `routeTree.gen.ts` imports each route module statically, so a top-level
 * import here would land in the client graph.
 */

/** The route params every org-scoped route has. */
export type OrgParams = { orgSlug: string };

/** The route params of an org-scoped route that names one row. */
export type OrgRowParams = { orgSlug: string; id: string };

/** What a route's `raw` step sees: the resolved caller, the path, the query
 *  string and the parsed JSON body (`{}` on a GET or an empty body). */
export type ApiRequest<TParams extends OrgParams> = {
	ctx: Ctx;
	params: TParams;
	query: URLSearchParams;
	body: JsonValue;
};

export type ApiRouteSpec<
	TParams extends OrgParams,
	TSchema extends z.ZodType,
	TResult,
> = {
	/** The input schema. A route that takes no input passes `NO_INPUT`. */
	input: TSchema;
	/**
	 * Builds the value the schema parses. Without it that value is the query
	 * string on a GET and the JSON body otherwise.
	 *
	 * For the routes whose input is not simply the request: a default that
	 * depends on the organization (today, in its timezone), an id that comes
	 * from the path, a patch merged over the stored row. It shapes; it never
	 * validates — the schema after it does that.
	 */
	raw?: (request: ApiRequest<TParams>) => JsonValue | Promise<JsonValue>;
	/** The service call. Returns the projection, never a row. */
	run: (ctx: Ctx, input: z.output<TSchema>) => Promise<TResult>;
};

/** The person behind a request to a route with no organization in its path. */
export type ApiUser = {
	userId: string;
	/** The bearer token, or null when a signed-in browser read the route with
	 *  its session cookie. Always set on a method other than GET. */
	token: string | null;
	user: { id: string; name: string; email: string };
};

export type UserRouteSpec<TResult> = {
	run: (caller: ApiUser) => Promise<TResult>;
	/** 204 answers with no body, whatever `run` returns. */
	status?: 200 | 204;
};

type RouteArgs<TParams> = { request: Request; params: TParams };

/** The input schema of a route that takes none. Not strict: a GET's query
 *  string may carry a cache-buster, and refusing it would be noise. */
export const NO_INPUT = z.object({});

const respond = <TBody>(
	body: TBody,
	status: number,
	headers: Record<string, string> = {},
) =>
	Response.json(body, {
		status,
		// Every answer here is one person's data, read with their credential.
		headers: { "Cache-Control": "no-store", ...headers },
	});

const refuse = (
	status: number,
	error: ApiError,
	headers: Record<string, string> = {},
) => respond(error, status, headers);

const rateLimited = (admission: Admission) =>
	admission.ok
		? null
		: refuse(
				429,
				{
					error: `Too many requests. Try again in ${admission.retryAfterSeconds} seconds.`,
					code: "rate_limited",
				},
				{ "Retry-After": String(admission.retryAfterSeconds) },
			);

const issuesOf = (error: z.core.$ZodError): ApiIssue[] =>
	error.issues.map((issue) => ({
		path: issue.path.map(String).join("."),
		message: issue.message,
	}));

/**
 * The session cookie's user, for a GET without an `Authorization` header, or
 * null.
 *
 * **Only a GET.** A cookie rides along on a cross-site request, and a form can
 * POST `text/plain` to any origin without a CORS preflight. A write that
 * accepted the cookie would therefore be a CSRF hole: any page a signed-in
 * person opens could log time as them. A bearer token is never sent by a
 * browser on its own, so writes take nothing else. A GET is safe to answer
 * from the cookie — another origin cannot read the response — and it lets a
 * signed-in browser open the same URL the CLI calls, which is how the answers
 * get looked at during development.
 *
 * **Not when a bearer header was sent.** A caller that presented a token asked
 * to be that token's owner. A dead token must get the 401 that sends the CLI to
 * `farmer login`, not a quiet answer as whoever else holds a cookie.
 */
const cookieUser = async (
	request: Request,
): Promise<ApiUser["user"] | null> => {
	if (request.method !== "GET" || request.headers.has("authorization")) {
		return null;
	}
	const { auth } = await import("@farmer/core/auth");
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return null;
	return {
		id: session.user.id,
		name: session.user.name,
		email: session.user.email,
	};
};

/**
 * Map an error a route's service call threw to an answer.
 *
 *  - A validation failure (`ZodError`) and a full day (`DayCapacityError`) are
 *    422: the request was understood and its values were refused.
 *  - An `AccessError` is 403. Its message is written for the person ("You are
 *    not assigned to this project"), the same reason `userFacingAssistantError`
 *    passes it through.
 *  - An error whose constructor is exactly `Error` is a sentence a service threw
 *    ON PURPOSE — `throw new Error("Time entry not found")`, `"Only absence
 *    tasks can be logged this way"`. The services use the bare class for this
 *    everywhere, and the runtime, the database driver and the ORM all throw
 *    subclasses. So its message is passed through, as 404 when it says "not
 *    found" and 422 otherwise.
 *  - Anything else — a `TypeError`, a `DrizzleQueryError`, a `PostgresError` —
 *    can carry SQL, a hostname or a file path. It is logged and answered with a
 *    generic 500.
 *
 * The bare-`Error` rule is a convention rather than a type, and it is the one to
 * watch. The integration clients in `packages/core/src/lib` break it today —
 * `github-client.ts` throws `GitHub API error 404: <url>` — and none of the
 * routes here can reach them: the sync route's engines report a failure in
 * `failed` rather than throwing it. A route that starts calling one directly, or
 * a service that starts throwing a bare `Error` with a raw database message in
 * it, would put that text in somebody's terminal. Throw a subclass for anything
 * that is not a sentence for the person.
 */
const failure = async (error: Error): Promise<Response> => {
	const { AccessError, DayCapacityError } =
		await import("@farmer/core/services");
	if (error instanceof z.core.$ZodError) {
		return refuse(422, {
			error: "The input is not valid.",
			code: "invalid_input",
			issues: issuesOf(error),
		});
	}
	if (error instanceof DayCapacityError) {
		return refuse(422, { error: error.message, code: "invalid_input" });
	}
	if (error instanceof AccessError) {
		return refuse(403, { error: error.message, code: "forbidden" });
	}
	if (error.constructor === Error) {
		return /not found/i.test(error.message)
			? refuse(404, { error: error.message, code: "not_found" })
			: refuse(422, { error: error.message, code: "invalid_input" });
	}
	console.error("[api] request failed", error);
	return refuse(500, {
		error: "The server failed. Try again in a moment.",
		code: "server_error",
	});
};

/**
 * Steps 1 to 5 and 7's error mapping, for any principal.
 *
 * Also the one place this surface is reported from. Every exit runs through
 * `finish`, so a request that was refused by the flag, the rate limiter, the
 * version check or the credential is counted exactly like one that was served —
 * a CLI that is being turned away is the thing you most want to see, and it is
 * the thing a per-route capture would miss. The principal is read for its
 * `organizationId` where it has one, which is how `/api/v1/me` and
 * `/api/v1/session` report none rather than a wrong one.
 */
const serve = async <
	TPrincipal extends { userId: string; organizationId?: string },
>(
	request: Request,
	authenticate: () => Promise<TPrincipal | null>,
	handle: (principal: TPrincipal) => Promise<Response>,
): Promise<Response> => {
	const startedAt = performance.now();
	const { captureApiFailure, captureApiRequest } =
		await import("#/lib/posthog-api.ts");
	// Filled in as the pipeline learns who is calling, and reported once by
	// whichever step answers.
	const report: ApiRequestReport = {
		userId: null,
		organizationId: null,
		method: request.method,
		pathname: new URL(request.url).pathname,
		status: 0,
		durationMs: 0,
		cliVersion: request.headers.get(CLI_VERSION_HEADER),
	};

	const finish = (response: Response, error?: Error): Response => {
		report.status = response.status;
		report.durationMs = Math.round(performance.now() - startedAt);
		// A 403, a 404 and a 422 are answers this pipeline gives on purpose, and
		// they are already counted by `api_request`. Only the generic 500 — an
		// error `failure` could not map — is a fault worth an `$exception`.
		if (error && response.status >= 500) captureApiFailure(error, report);
		captureApiRequest(report);
		return response;
	};

	const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");
	if (!isCliEnabled()) {
		return finish(refuse(404, { error: "Not found", code: "not_found" }));
	}

	const address = callerAddress(request);
	const byAddress = rateLimited(admitCaller("cli", address));
	if (byAddress) return finish(byAddress);

	const version = request.headers.get(CLI_VERSION_HEADER);
	if (version !== null && !isCliVersionSupported(version)) {
		return finish(
			refuse(426, {
				error:
					"This version of the Farmer CLI is too old for this server. Update it.",
				code: "cli_outdated",
			}),
		);
	}

	const principal = await authenticate();
	// No credential, a bad or expired token, an unknown slug and an ex-member
	// are one answer on purpose — see `orgContextService.resolveBySlug`.
	if (!principal) {
		recordAuthFailure("cli", address);
		return finish(
			refuse(401, {
				error: "Not signed in. Run `farmer login`.",
				code: "unauthorized",
			}),
		);
	}
	report.userId = principal.userId;
	report.organizationId = principal.organizationId ?? null;

	const byUser = rateLimited(admitRequest("cli", principal.userId));
	if (byUser) return finish(byUser);
	if (request.method !== "GET") {
		const byWrites = rateLimited(admitWrite("cli", principal.userId));
		if (byWrites) return finish(byWrites);
	}

	try {
		return finish(await handle(principal));
	} catch (error) {
		if (error instanceof Error) return finish(await failure(error), error);
		console.error("[api] request failed", error);
		return finish(
			refuse(500, {
				error: "The server failed. Try again in a moment.",
				code: "server_error",
			}),
		);
	}
};

/** The JSON body of a request that is not a GET, `{}` when it is empty, or
 *  null when it does not parse. */
const readBody = async (request: Request): Promise<JsonValue | null> => {
	if (request.method === "GET") return {};
	const text = await request.text();
	if (!text.trim()) return {};
	try {
		const body: JsonValue = JSON.parse(text);
		return body;
	} catch {
		return null;
	}
};

/**
 * A handler for an org-scoped route: `/api/v1/orgs/$orgSlug/…`.
 *
 * Returns the handler itself, so a route reads
 * `GET: apiRoute({ input, run })`. The params type is inferred from `raw`'s
 * annotation when a route needs its `$id`.
 */
export const apiRoute =
	<TSchema extends z.ZodType, TResult, TParams extends OrgParams = OrgParams>(
		spec: ApiRouteSpec<TParams, TSchema, TResult>,
	) =>
	({ request, params }: RouteArgs<TParams>): Promise<Response> =>
		serve(
			request,
			async () => {
				const byToken = await resolveCliOrgContext(request, params.orgSlug);
				if (byToken) return byToken;
				const user = await cookieUser(request);
				if (!user) return null;
				const { orgContextService } = await import("@farmer/core/services");
				return orgContextService.resolveBySlug(user.id, params.orgSlug);
			},
			async (ctx) => {
				const body = await readBody(request);
				if (body === null) {
					return refuse(422, {
						error: "The request body is not JSON.",
						code: "invalid_input",
					});
				}
				const query = new URL(request.url).searchParams;
				const raw = spec.raw
					? await spec.raw({ ctx, params, query, body })
					: request.method === "GET"
						? Object.fromEntries(query)
						: body;
				const parsed = spec.input.safeParse(raw);
				if (!parsed.success) {
					return refuse(422, {
						error: "The input is not valid.",
						code: "invalid_input",
						issues: issuesOf(parsed.error),
					});
				}
				return respond(await spec.run(ctx, parsed.data), 200);
			},
		);

/**
 * A handler for a route with no organization in its path: `/api/v1/me` and
 * `/api/v1/session`. The same pipeline, with the person as the principal
 * rather than a Ctx.
 */
export const userApiRoute =
	<TResult>(spec: UserRouteSpec<TResult>) =>
	({ request }: { request: Request }): Promise<Response> =>
		serve(
			request,
			async (): Promise<ApiUser | null> => {
				const byToken = await resolveCliUser(request);
				if (byToken) return byToken;
				const user = await cookieUser(request);
				return user ? { userId: user.id, token: null, user } : null;
			},
			async (caller) => {
				const result = await spec.run(caller);
				return spec.status === 204
					? new Response(null, {
							status: 204,
							headers: { "Cache-Control": "no-store" },
						})
					: respond(result ?? null, 200);
			},
		);

/**
 * `from` and `to` from the query string, each defaulting to today in the
 * ORGANIZATION's timezone — for the two range reads.
 *
 * The default is filled in before the schema runs rather than after, so that
 * "neither supplied" means today instead of failing validation. Today is the
 * org's, not the server's, because a day on a timesheet is the org's day: at
 * 01:00 in Sarajevo the server in UTC is still on yesterday.
 */
export const rangeFromQuery = async ({
	ctx,
	query,
}: ApiRequest<OrgParams>): Promise<JsonValue> => {
	const { ctxTimezone } = await import("@farmer/core/services");
	const { dayKeyInTz } = await import("@farmer/core/lib/time");
	const today = dayKeyInTz(new Date(), await ctxTimezone(ctx));
	return { from: query.get("from") ?? today, to: query.get("to") ?? today };
};
