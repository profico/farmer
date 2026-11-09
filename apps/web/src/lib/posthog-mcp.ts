// The MCP server's requests, as PostHog MCP analytics events.
//
// The third of the three PostHog adapters, beside `posthog-ai.ts` (the
// assistant's own turns) and the `capture` calls in `server/*.ts` (what a
// person did in the browser). All three read `posthog-server.ts` for the
// client, so a deployment with no token has none of them.
//
// Unlike the AI half, this one is a vendor SDK rather than a hand-rolled
// mapping: `instrument()` wraps the server's `setRequestHandler`, so the events
// follow every handler the route registers without the route naming any of
// them. `packages/core` still holds no PostHog import and no MCP SDK import —
// this file sits in `apps/web` beside the route that defers it.

import { settingEnabled } from "@farmer/core/lib/instance-settings";
import type { Ctx } from "@farmer/core/services";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	type BeforeSendFn,
	instrument,
	PostHogMCPAnalyticsProperty,
} from "@posthog/mcp";
import { z } from "zod";

import { getPostHogClient } from "./posthog-server";

/** Whether a call's CONTENT leaves this process — the same switch, and the same
 *  default, as the assistant's own telemetry reads (`posthog-ai.ts` says why).
 *  `$mcp_parameters` is a tool's arguments and `$mcp_response` is the rows it
 *  answered with, so on this surface the content is the timesheet itself. */
const captureContent = (): boolean =>
	settingEnabled("POSTHOG_AI_CAPTURE_CONTENT");

/** `$mcp_parameters`, as the SDK builds it: the JSON-RPC envelope, and the
 *  tool's own arguments nested under `request.params.arguments`.
 *
 *  Parsed rather than sniffed, so the redaction below branches on a domain
 *  value rather than on `typeof` — the property arrives as `unknown` off the
 *  vendor's event. Loose at every level, because the envelope carries fields
 *  (`id`, `jsonrpc`, `method`, `params.name`) that are protocol metadata and
 *  are kept exactly as they came. */
const capturedParameters = z.looseObject({
	request: z.looseObject({
		params: z
			.looseObject({ arguments: z.record(z.string(), z.json()).optional() })
			.optional(),
	}),
});

const REDACTED = "[redacted]";

/** A tool answer, as the route builds it in `text()`: the parts, each carrying
 *  the JSON its tool returned. Loose, because `isError` and anything the
 *  protocol adds later travel untouched. */
const capturedResponse = z.looseObject({
	content: z.array(z.looseObject({ text: z.string().optional() })).optional(),
});

/** How many rows a tool answered with, or null when its answer is not a list.
 *
 *  Parsed rather than measured: every tool in `mcp-tools.ts` answers with
 *  `JSON.stringify`, so a list tool's body really is a JSON array and its
 *  length really is the row count. Anything else — an object from `whoami`, a
 *  sentence from a refusal — is not a list and says so, rather than being
 *  reported as zero rows. */
const rowsIn = (text: string): number | null => {
	try {
		const parsed = z.array(z.json()).safeParse(JSON.parse(text));
		return parsed.success ? parsed.data.length : null;
	} catch {
		// Not JSON at all. A refusal's "Error: …" lands here, and so would a tool
		// that answered with prose.
		return null;
	}
};

/**
 * Put "how much did this answer" on the event, as METADATA.
 *
 * The whole reason this is not simply read off `$mcp_response` later: the
 * response is CONTENT, so it disappears behind `[redacted]` the moment a
 * deployment turns content capture off, and a monitor built on it would go
 * quiet at exactly the moment somebody tightened privacy. A row count and a
 * flag name nobody and leak nothing, so "which tools keep answering nothing"
 * stays answerable under either setting.
 *
 * `mcp_result_empty` is the alertable one. An empty answer is not an error —
 * the tool worked, the filter matched nothing — which is precisely why nothing
 * else catches it: `$mcp_is_error` stays false and the call looks healthy. A
 * tool that suddenly answers nothing all day is a broken filter, a lost
 * assignment or an agent calling it wrongly, and all three are invisible
 * without this.
 */
const annotateResult = (event: Parameters<BeforeSendFn>[0]): void => {
	const response = event.properties[PostHogMCPAnalyticsProperty.Response];
	if (response === undefined) return;
	const parsed = capturedResponse.safeParse(response);
	if (!parsed.success) return;

	const body = (parsed.data.content ?? [])
		.map((part) => part.text ?? "")
		.join("")
		.trim();
	const rows = rowsIn(body);
	event.properties.mcp_result_rows = rows;
	// Three ways a call answers nothing: no body at all, a literal null, or a
	// list with no rows in it.
	event.properties.mcp_result_empty =
		body === "" || body === "null" || rows === 0;
};

/**
 * Content out of every event, unless the deployment asked for it.
 *
 * Runs once per event, `$exception` siblings included. It never drops an event:
 * the metadata — which tool, how long, whether it failed, which client, and now
 * how much it answered — is the whole point and carries nothing about the
 * organization.
 */
const redactContent: BeforeSendFn = (event) => {
	// Before the early return below, not after: the row count has to be taken
	// off the real answer, and it has to be taken whether or not that answer is
	// then redacted.
	annotateResult(event);

	if (captureContent()) return event;

	const parameters = event.properties[PostHogMCPAnalyticsProperty.Parameters];
	if (parameters !== undefined) {
		// Only the argument VALUES go. The keys are this app's own schema — `from`,
		// `to`, `projectId` — and say which filters a client used, which is what
		// the event is read for; the values are somebody's dates, ids and entry
		// notes. Redacting the envelope with them would instead read as a tool
		// called with no arguments at all.
		const parsed = capturedParameters.safeParse(parameters);
		const args = parsed.data?.request.params?.arguments;
		if (!parsed.success) {
			event.properties[PostHogMCPAnalyticsProperty.Parameters] = REDACTED;
		} else if (args) {
			const { request } = parsed.data;
			event.properties[PostHogMCPAnalyticsProperty.Parameters] = {
				...parsed.data,
				request: {
					...request,
					params: {
						...request.params,
						arguments: Object.fromEntries(
							Object.keys(args).map((key) => [key, REDACTED]),
						),
					},
				},
			};
		}
	}

	const response = event.properties[PostHogMCPAnalyticsProperty.Response];
	if (response !== undefined) {
		event.properties[PostHogMCPAnalyticsProperty.Response] =
			`[redacted, ${String(JSON.stringify(response)?.length ?? 0)} characters]`;
	}

	return event;
};

/**
 * Wire one request's MCP server to PostHog. A no-op where PostHog is not set up.
 *
 * Call this before the handlers are registered. `instrument` patches
 * `setRequestHandler`, so a handler added first is not wrapped.
 *
 * The identity is static, so this takes a `Ctx`. The route has already
 * resolved the credential and the membership, and they cannot change for the
 * life of this server.
 *
 * Keep `context`, `captureModel` and `enableConversationId` off. Each one adds
 * an argument to the tool schemas that the client is served. `context` would
 * become a required argument on 52 tools, whose parameters are the app's own
 * Zod inputs shared with the UI, the CLI and the assistant. That is a product
 * decision, not an analytics one.
 *
 * So `$session_id` is one per request, not per connection: this server is
 * stateless (`sessionIdGenerator: undefined`).
 */
export const instrumentMcpAnalytics = (server: Server, ctx: Ctx): void => {
	const posthog = getPostHogClient();
	if (!posthog) return;

	instrument(server, posthog, {
		// The SDK's own default is a no-op, because an MCP server usually speaks
		// STDIO and anything written to the console there corrupts the protocol.
		// This one speaks HTTP, so a warning it raises about itself — a schema it
		// declined to touch, a handler it could not wrap — is readable rather than
		// silently dropped.
		logger: (message) => {
			console.warn(`[posthog-mcp] ${message}`);
		},
		identify: { distinctId: ctx.userId },
		context: false,
		captureModel: false,
		// `organization_id` on every event, spelled as the browser's own captures
		// spell it (`server/clients.ts` and the rest), so one filter covers what a
		// workspace did however it did it.
		eventProperties: () => ({ organization_id: ctx.organizationId }),
		beforeSend: redactContent,
	});
};
