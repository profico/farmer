// The REST API's requests and failures, as PostHog events.
//
// The fourth PostHog adapter, beside `posthog-ai.ts` (the assistant's turns),
// `posthog-mcp.ts` (the MCP server's requests) and the `capture` calls in
// `server/*.ts` (what a person did in the browser). All four read
// `posthog-server.ts` for the client, so a deployment with no token has none of
// them.
//
// This one covers the surface that had nothing at all: the CLI. Every `farmer`
// command reaches the server through `serve` in `server/api-route.ts`, and that
// is the only call site here — one event per request, rather than nineteen
// routes that each have to remember to report. The CLI binary itself stays
// uninstrumented on purpose: a tool installed on somebody's laptop cannot be
// asked to report truthfully, and an old binary would report nothing at all.
//
// Reached with a deferred `import()` and never a static one. `routeTree.gen.ts`
// imports every route module, `api-route.ts` is in that graph, and
// `posthog-node` at the top of this file would therefore ship to the browser.

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
};

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
	posthog.captureException(error, report.userId ?? ANONYMOUS, {
		...propertiesOf(report),
		// Error tracking groups on the exception itself, so the route has to be
		// on the event to tell two failures of one message apart.
		api_failed_route: routeTemplate(report.pathname),
	});
};
