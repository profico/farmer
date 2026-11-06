// The REST API's requests and failures, and the faults of server functions,
// as PostHog events.
//
// The fourth PostHog adapter, beside `posthog-ai.ts` (the assistant's turns),
// `posthog-mcp.ts` (the MCP server's requests) and the `capture` calls in
// `server/*.ts` (what a person did in the browser). All four read
// `posthog-server.ts` for the client, so a deployment with no token has none of
// them.
//
// This one covers the surface that had nothing at all: the CLI. Every `farmer`
// command reaches the server through `serve` in `server/api-route.ts`, and that
// is the only call site for those — one event per request, rather than nineteen
// routes that each have to remember to report. The function middleware in
// `start.ts` is the call site for server functions. The CLI binary itself stays
// uninstrumented on purpose: a tool installed on somebody's laptop cannot be
// asked to report truthfully, and an old binary would report nothing at all.
//
// Reached with a deferred `import()` and never a static one. `routeTree.gen.ts`
// imports every route module, `api-route.ts` is in that graph, and
// `posthog-node` at the top of this file would therefore ship to the browser.

import { withoutQueryValues } from "@farmer/core/lib/loggable-error";

import { getPostHogClient } from "./posthog-server";

/** A uuid, as the two `$id` routes carry it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The distinct id for a request that never resolved a person. It rides with
 *  `$process_person_profile: false`, so a refused flood is still countable
 *  without inventing a "person" nobody can act on. */
const ANONYMOUS = "cli-anonymous";

/**
 * A request path with its values taken out:
 * `/api/v1/orgs/:orgSlug/time-entries/:id`.
 *
 * The raw pathname cannot be the property. Every org-scoped route carries the
 * organization's slug, and two of them carry a row id, so a breakdown by path
 * would be one row per REQUEST rather than one per route — unreadable, and a
 * customer's ids copied to a vendor for no gain. The organization still travels
 * as `organization_id`, spelled as every other surface spells it.
 *
 * Deliberately dumb: the segment after `orgs` is the slug, and anything shaped
 * like a uuid is an id. A future route whose id is not a uuid appears with its
 * value still in it, which reads as a strange route name rather than as quietly
 * wrong data.
 */
export const routeTemplate = (pathname: string): string =>
	pathname
		.split("/")
		.map((segment, index, segments) => {
			if (segments[index - 1] === "orgs") return ":orgSlug";
			return UUID.test(segment) ? ":id" : segment;
		})
		.join("/");

/** One request through `serve`, as the pipeline saw it end. */
export type ApiRequestReport = {
	/** The person, or null when the request never got past the credential. */
	userId: string | null;
	/** Null on `/api/v1/me` and `/api/v1/session`, which name no organization,
	 *  and on anything refused before the slug was resolved. */
	organizationId: string | null;
	method: string;
	pathname: string;
	status: number;
	durationMs: number;
	/** The `x-farmer-cli-version` header. Null means a browser or a script read
	 *  the route with a session cookie, which is a real and different caller. */
	cliVersion: string | null;
	/** How the caller signed in: a device-flow token, a personal API token or
	 *  the browser's cookie. Null when no credential was accepted. */
	credential: ApiCredentialKind | null;
};

export type ApiCredentialKind = "session" | "api_token" | "cookie";

const propertiesOf = (report: ApiRequestReport) => {
	const properties = {
		organization_id: report.organizationId,
		api_route: routeTemplate(report.pathname),
		api_method: report.method,
		api_status: report.status,
		api_duration_ms: report.durationMs,
		// `cli` or `browser`, so the two callers of one URL never have to be told
		// apart by guessing from the user agent.
		api_caller: report.cliVersion === null ? "browser" : "cli",
		cli_version: report.cliVersion,
		api_credential: report.credential,
	};
	// A refused request must not mint a person. `cli-anonymous` is a bucket
	// rather than somebody, and a person profile per unauthenticated caller
	// would be a directory of noise nobody can act on. A real user is left to
	// get their profile as usual.
	if (report.userId) return properties;
	return { ...properties, $process_person_profile: false };
};

/**
 * Report one finished request.
 *
 * Never awaited and never allowed to throw: a person waiting on `farmer log`
 * does not wait on a metric, and a PostHog outage does not become a failed
 * command. `posthog-server.ts` builds the client with `flushAt: 1` and
 * `flushInterval: 0`, so the event leaves immediately without an explicit
 * flush — unlike the `server/*.ts` captures, which await one because a server
 * function may be the last thing a request does.
 */
export const captureApiRequest = (report: ApiRequestReport): void => {
	const posthog = getPostHogClient();
	if (!posthog) return;
	posthog.capture({
		distinctId: report.userId ?? ANONYMOUS,
		event: "api_request",
		properties: propertiesOf(report),
	});
};

/**
 * Report a request that failed with a 500.
 *
 * This is the blind spot that made the whole file worth writing. `failure()`
 * catches every error the services throw, writes one `console.error` line and
 * answers a generic 500 — so the caller learns nothing, and the only record was
 * a log line in a container nobody reads until somebody complains. The error
 * goes to PostHog error tracking as an `$exception`, beside the browser's own,
 * with the route that raised it.
 *
 * Only the unmapped errors come here. A 403, a 404 and a 422 are answers the
 * pipeline gives on purpose — they are already counted by `api_request` and are
 * not faults.
 */
export const captureApiFailure = (
	error: Error,
	report: ApiRequestReport,
): void => {
	const posthog = getPostHogClient();
	if (!posthog) return;
	// A database error holds the values of its query in its message, its
	// stack and its `cause`: a token, a token hash or an email address. Only a
	// copy without them goes to PostHog. See `withoutQueryValues`.
	posthog.captureException(
		withoutQueryValues(error),
		report.userId ?? ANONYMOUS,
		{
			...propertiesOf(report),
			// Error tracking groups on the exception itself, so the route has to be
			// on the event to tell two failures of one message apart.
			api_failed_route: routeTemplate(report.pathname),
		},
	);
};

/**
 * Whether a server function's error is a fault worth an `$exception`.
 *
 * Only the `unsafe` verdict of `classifyServiceError` is: a validation error,
 * a refusal and an access error are answers the app gives on purpose. The
 * caller passes only an `Error`, which keeps out the redirect and the
 * not-found that TanStack throws as control flow (neither is an `Error`).
 */
export const isServerFnFault = async (error: Error): Promise<boolean> => {
	// A better-auth 4xx (a refused role change, for example) is an expected
	// answer. A 5xx is a fault, so it goes on to the check below.
	const { isAPIError } = await import("better-auth/api");
	if (isAPIError(error) && error.statusCode < 500) return false;
	const { classifyServiceError } = await import("@farmer/core/services");
	return classifyServiceError(error).kind === "unsafe";
};

const capturedErrors = new WeakSet<Error>();

/**
 * Claim an error for capture. Returns true only the first time.
 *
 * Server code calls server functions in-process, so the same error object
 * can pass through the middleware of an inner and an outer function. Only
 * the first one reports it.
 */
export const claimServerFnError = (error: Error): boolean => {
	if (capturedErrors.has(error)) return false;
	capturedErrors.add(error);
	return true;
};

/**
 * Report the error of a server function, if it is a fault.
 *
 * The caller does not await this: a metric must not delay the answer, and
 * the session lookup is one more query on a pool that may be the fault. The
 * claim comes first and runs before any `await`, so the inner and the outer
 * middleware of a nested call cannot both pass it. `headers` are read by the
 * caller, while the request context is still current.
 */
export const reportServerFnError = async (
	error: Error,
	headers: Headers,
	fn: { name: string; filename: string },
): Promise<void> => {
	if (!claimServerFnError(error)) return;
	if (!(await isServerFnFault(error))) return;
	const { auth } = await import("@farmer/core/auth");
	const session = await auth.api.getSession({ headers }).catch(() => null);
	captureServerFnFailure(error, {
		userId: session?.user.id ?? null,
		organizationId: session?.session.activeOrganizationId ?? null,
		fn: fn.name,
		file: fn.filename,
	});
};

/** A server function that failed with an error not worded for the person.
 *  The properties name the function, never its input. Scrubbed as
 *  `captureApiFailure` is. */
export const captureServerFnFailure = (
	error: Error,
	ctx: {
		userId: string | null;
		organizationId: string | null;
		fn: string;
		file: string;
	},
): void => {
	const properties = {
		organization_id: ctx.organizationId,
		server_fn: ctx.fn,
		// Two functions can share a name in different files.
		server_fn_file: ctx.file,
	};
	getPostHogClient()?.captureException(
		withoutQueryValues(error),
		ctx.userId ?? "server-fn-anonymous",
		// No person to attach to: do not mint a profile for the bucket id.
		ctx.userId ? properties : { ...properties, $process_person_profile: false },
	);
};

/** An assistant turn that failed with an error not worded for the person.
 *  The stream route answers it with a generic line, so without this the
 *  only record is the log line. Scrubbed as `captureApiFailure` is. */
export const captureAssistantFailure = (
	error: Error,
	ctx: { userId: string; organizationId: string },
): void => {
	getPostHogClient()?.captureException(withoutQueryValues(error), ctx.userId, {
		organization_id: ctx.organizationId,
		assistant_turn_failed: true,
	});
};
