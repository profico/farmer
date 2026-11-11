import {
	type ApiAssistantSearchHit,
	toApiAssistantSearchHit,
} from "@farmer/core/api";
import { searchConversationsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/assistant/threads/search?q=` — the caller's own
 * threads whose title or text match, newest first (at most 30). 404 when the
 * deployment has the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/search",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: searchConversationsInput,
				run: async (ctx, input): Promise<ApiAssistantSearchHit[]> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					const rows = await assistantService.search(ctx, input);
					return rows.map(toApiAssistantSearchHit);
				},
			}),
		},
	},
});
