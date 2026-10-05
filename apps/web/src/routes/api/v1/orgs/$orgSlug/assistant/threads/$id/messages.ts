import type { JsonValue } from "@farmer/core/lib/json";
import { runAssistantInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiStreamRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import {
	assertAssistantAvailable,
	streamAssistantTurn,
} from "#/server/assistant-stream.ts";

/** Lifts `message` out of the body. Only the shape is read here;
 *  `runAssistantInput` checks the value. */
const sendBody = z.object({ message: z.json().optional() });

/**
 * `POST /api/v1/orgs/$orgSlug/assistant/threads/$id/messages` — sends one
 * message and streams the answer as Server-Sent Events, the same turn the
 * chat page runs. The events are `ApiAssistantEvent`s.
 *
 * A message sent while an approval card waits declines the card, as in the
 * web app. The per-person limit on assistant turns applies. 404 when the
 * deployment has the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/$id/messages",
)({
	server: {
		handlers: {
			POST: apiStreamRoute({
				input: runAssistantInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>): JsonValue => {
					const parsed = sendBody.safeParse(body);
					const message = parsed.success ? parsed.data.message : undefined;
					return message === undefined
						? { conversationId: params.id }
						: { conversationId: params.id, message };
				},
				stream: async (ctx, input, request) => {
					await assertAssistantAvailable();
					return streamAssistantTurn(ctx, input, request);
				},
			}),
		},
	},
});
