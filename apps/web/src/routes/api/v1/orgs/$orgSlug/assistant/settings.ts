import {
	type ApiAssistantSettings,
	toApiAssistantSettings,
} from "@farmer/core/api";
import {
	setAssistantSettingsInput,
	updateAssistantSettingsInput,
} from "@farmer/core/schema";
import type { Ctx } from "@farmer/core/services";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/** The settings as stored, with the deployment's switch beside them. The key
 *  is never in it: the service answers a masked hint. */
const read = async (ctx: Ctx): Promise<ApiAssistantSettings> => {
	const { assistantService } = await import("@farmer/core/services");
	const { isAssistantEnabled } =
		await import("@farmer/core/lib/assistant-flag");
	return toApiAssistantSettings(
		await assistantService.settings.get(ctx),
		isAssistantEnabled(),
	);
};

/**
 * `/api/v1/orgs/$orgSlug/assistant/settings` — the assistant's AI provider
 * (OpenRouter) for this organization.
 *
 *  - The read is open to any member, as in the web app. The app reads it to
 *    decide whether to show the chat.
 *  - The POST connects, with a new key and a default model. The key is
 *    checked with OpenRouter, sealed and never read back. Admin only.
 *  - The PATCH changes the default model, the pause switch and the house
 *    rules. Admin only.
 *  - The DELETE forgets the key. Admin only. It works when the deployment has
 *    the assistant switched off, so a key can always be removed.
 *
 * Every write answers the settings as they are after it.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/assistant/settings",
)({
	server: {
		handlers: {
			GET: apiRoute({ input: NO_INPUT, run: read }),
			POST: apiRoute({
				input: setAssistantSettingsInput,
				run: async (ctx, input): Promise<ApiAssistantSettings> => {
					const { assistantService } = await import("@farmer/core/services");
					await assistantService.settings.set(ctx, input);
					return read(ctx);
				},
			}),
			PATCH: apiRoute({
				input: updateAssistantSettingsInput,
				run: async (ctx, input): Promise<ApiAssistantSettings> => {
					const { assistantService } = await import("@farmer/core/services");
					await assistantService.settings.update(ctx, input);
					return read(ctx);
				},
			}),
			DELETE: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiAssistantSettings> => {
					const { assistantService } = await import("@farmer/core/services");
					await assistantService.settings.disconnect(ctx);
					return read(ctx);
				},
			}),
		},
	},
});
