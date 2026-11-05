import {
	type ApiAssistantThread,
	toApiAssistantThread,
} from "@farmer/core/api";
import { createConversationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

/**
 * `GET` and `POST /api/v1/orgs/$orgSlug/assistant/threads` — the caller's own
 * conversations, newest first (at most 100), and starting a new one. A new
 * thread uses the organization's default model.
 *
 * 404 when the deployment has the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiAssistantThread[]> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					const rows = await assistantService.conversations.list(ctx);
					return rows.map(toApiAssistantThread);
				},
			}),
			POST: apiRoute({
				input: createConversationInput,
				run: async (ctx, input): Promise<ApiAssistantThread> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					return toApiAssistantThread(
						await assistantService.conversations.create(ctx, input),
					);
				},
			}),
		},
	},
});
