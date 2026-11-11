import type { ApiAssistantRewind } from "@farmer/core/api";
import { conversationIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/assistant/threads/$id/rewind` — removes the last
 * question and the rows after it, and answers with the question text. The
 * client sends the text again as a new message. 404 when the deployment has
 * the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/$id/rewind",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: conversationIdInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					conversationId: params.id,
				}),
				run: async (ctx, input): Promise<ApiAssistantRewind> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					return assistantService.replaceLastTurn(ctx, input);
				},
			}),
		},
	},
});
