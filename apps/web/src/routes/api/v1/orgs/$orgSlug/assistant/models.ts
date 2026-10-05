import { type ApiAssistantModel, toApiAssistantModel } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/assistant/models` — the OpenRouter models that
 * can call tools, for the default model picker. Admin only, because it is the
 * one read that spends the stored key without a conversation behind it.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/assistant/models")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiAssistantModel[]> => {
					const { assistantService } = await import("@farmer/core/services");
					const models = await assistantService.settings.listModels(ctx);
					return models.map(toApiAssistantModel);
				},
			}),
		},
	},
});
