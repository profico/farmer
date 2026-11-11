import {
	type ApiAssistantSharedThread,
	toApiAssistantMessage,
	toApiAssistantThread,
} from "@farmer/core/api";
import { conversationIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/assistant/shared-threads/$id` — a thread that its
 * owner shared with the organization. Any member may read it. Read only. A
 * thread that is not shared is a 404. 404 when the deployment has the
 * assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/shared-threads/$id",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: conversationIdInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					conversationId: params.id,
				}),
				run: async (
					ctx,
					{ conversationId },
				): Promise<ApiAssistantSharedThread> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					const shared = await assistantService.getShared(ctx, conversationId);
					return {
						thread: toApiAssistantThread(shared.conversation),
						messages: shared.messages.map(toApiAssistantMessage),
						sharedAt: shared.sharedAt.toISOString(),
						sharedBy: shared.sharedBy,
					};
				},
			}),
		},
	},
});
