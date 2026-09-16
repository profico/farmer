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
	process.env.POSTHOG_AI_CAPTURE_CONTENT === "true";

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

/**
 * Content out of every event, unless the deployment asked for it.
 *
 * Runs once per event, `$exception` siblings included. It never drops an event:
 * the metadata — which tool, how long, whether it failed, which client — is the
 * whole point and carries nothing about the organization.
 */
const redactContent: BeforeSendFn = (event) => {
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
 * Called before the handlers are registered, which is what the SDK's example
 * does and what this one needs: `instrument` patches `setRequestHandler`, so a
 * handler added afterwards is wrapped and one added first is not.
 *
 * **The identity is static, and that is the whole reason this takes a `Ctx`.**
 * The SDK's `identify` option exists for a server that learns who is calling
 * from the request; here the route has already resolved the credential and the
 * membership before anything is constructed, so the answer is known and cannot
 * change for the life of this server.
 *
 * Two options are deliberately left off, because both change the tool SCHEMAS
 * the client is served:
 *
 *  - `context` (on by default) adds a required `context` string to every tool,
 *    for the agent to narrate what the person is trying to do, and captures it
 *    as `$mcp_intent`. It is the most informative thing this SDK offers and it
 *    is also a required argument on 52 tools whose parameters are otherwise the
 *    app's own Zod inputs, shared with the UI, the CLI and the assistant. A
 *    measurement that rewrites the thing it measures is a product decision
 *    rather than an analytics one, so it is left to be made on purpose.
 *  - `captureModel` injects an `llm_model` argument the same way, for a value
 *    the SDK's own documentation calls unverified. `$mcp_client_name`,
 *    `$mcp_client_version` and `$mcp_client_user_agent` already arrive without
 *    it.
 *
 * `$session_id` is therefore one per REQUEST, not one per connection: this
 * server is stateless (`sessionIdGenerator: undefined`), so there is no session
 * id for the SDK to anchor on. `enableConversationId` is the SDK's answer and
 * injects an argument of its own, so it is off for the reason above.
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
