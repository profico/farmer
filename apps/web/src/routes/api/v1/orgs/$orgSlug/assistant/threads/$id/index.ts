import {
	type ApiAssistantThread,
	type ApiAssistantThreadDetail,
	type ApiDeleted,
	toApiAssistantMessage,
	toApiAssistantThread,
} from "@farmer/core/api";
import {
	conversationIdInput,
	renameConversationInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import { assertAssistantAvailable } from "#/server/assistant-stream.ts";

const fromPath = ({ params }: ApiRequest<OrgRowParams>) => ({
	conversationId: params.id,
});

/** A rename body: only `title`. The thread comes from the path. */
const renameBody = z.object({ title: z.json() });

/**
 * `GET`, `PATCH` and `DELETE /api/v1/orgs/$orgSlug/assistant/threads/$id` —
 * one of the caller's own conversations with its messages, a new title, and
 * deleting it. Another person's thread is a 404.
 *
 * 404 when the deployment has the assistant switched off.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/threads/$id/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: conversationIdInput,
				raw: fromPath,
				run: async (
					ctx,
					{ conversationId },
				): Promise<ApiAssistantThreadDetail> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					const { conversation, messages, promptTokens, contextLength } =
						await assistantService.conversations.get(ctx, conversationId);
					return {
						thread: toApiAssistantThread(conversation),
						messages: messages.map(toApiAssistantMessage),
						promptTokens,
						contextLength,
					};
				},
			}),
			PATCH: apiRoute({
				input: renameConversationInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) => {
					const parsed = renameBody.safeParse(body);
					return {
						title: parsed.success ? parsed.data.title : null,
						conversationId: params.id,
					};
				},
				run: async (ctx, input): Promise<ApiAssistantThread> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					await assistantService.conversations.rename(ctx, input);
					const { conversation } = await assistantService.conversations.get(
						ctx,
						input.conversationId,
					);
					return toApiAssistantThread(conversation);
				},
			}),
			DELETE: apiRoute({
				input: conversationIdInput,
				raw: fromPath,
				run: async (ctx, { conversationId }): Promise<ApiDeleted> => {
					await assertAssistantAvailable();
					const { assistantService } = await import("@farmer/core/services");
					await assistantService.conversations.remove(ctx, conversationId);
					return { id: conversationId };
				},
			}),
		},
	},
});
