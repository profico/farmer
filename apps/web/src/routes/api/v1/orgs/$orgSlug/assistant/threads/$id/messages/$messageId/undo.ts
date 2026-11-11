import {
	type ApiAssistantMessage,
	toApiAssistantMessage,
} from "@farmer/core/api";
import { assistantMessageIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

type UndoParams = { orgSlug: string; id: string; messageId: string };

/**
 * `POST /api/v1/orgs/$orgSlug/assistant/threads/$id/messages/$messageId/undo` —
 * undoes one inline write from its `tool` row and answers with the row. 404
 * when the deployment has the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/$id/messages/$messageId/undo",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: assistantMessageIdInput,
				raw: ({ params }: ApiRequest<UndoParams>) => ({
					conversationId: params.id,
					messageId: params.messageId,
				}),
				run: async (ctx, input): Promise<ApiAssistantMessage> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					const { message } = await assistantService.undo(ctx, input);
					return toApiAssistantMessage(message);
				},
			}),
		},
	},
});
