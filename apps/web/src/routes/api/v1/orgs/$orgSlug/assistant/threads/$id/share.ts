import type { ApiAssistantShare } from "@farmer/core/api";
import { conversationIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

const fromPath = ({ params }: ApiRequest<OrgRowParams>) => ({
	conversationId: params.id,
});

/**
 * `POST` and `DELETE /api/v1/orgs/$orgSlug/assistant/threads/$id/share` —
 * share the caller's thread with the organization, and stop sharing it. An
 * Admin may stop any shared thread. 404 when the deployment has the assistant
 * switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/$id/share",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: conversationIdInput,
				raw: fromPath,
				run: async (ctx, { conversationId }): Promise<ApiAssistantShare> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					const { sharedAt } = await assistantService.share(
						ctx,
						conversationId,
					);
					return { sharedAt: sharedAt.toISOString() };
				},
			}),
			DELETE: apiRoute({
				input: conversationIdInput,
				raw: fromPath,
				run: async (ctx, { conversationId }): Promise<ApiAssistantShare> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					return assistantService.unshare(ctx, conversationId);
				},
			}),
		},
	},
});
