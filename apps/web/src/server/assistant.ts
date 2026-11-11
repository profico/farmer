import {
	assistantUsageInput,
	conversationIdInput,
	createConversationInput,
	renameConversationInput,
	setAssistantSettingsInput,
	updateAssistantSettingsInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware, orgMiddleware } from "./auth";

// Everything about the assistant EXCEPT the turn itself, which streams and so
// lives in `routes/api/assistant/stream.ts` — `createServerFn` resolves to a
// single value and has nothing to hand back token-by-token.
//
// The OpenRouter key follows the Slack bot token's rule: it goes in through
// `setAssistantSettings` and nothing here returns it. `assistantService.
// settings.get` selects around it and answers with a masked hint.

export const getAssistantSettings = createServerFn({ method: "GET" })
	// Any member, not just admins: the chat page has to know whether to render
	// itself or an "ask an admin to connect this" empty state, and a 403 is a
	// worse way to learn that than a boolean.
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.settings.get(context.ctx);
	});

export const setAssistantSettings = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setAssistantSettingsInput)
	.handler(async ({ data, context }) => {
		const { assistantService, UserFacingError, userFacingAssistantError } =
			await import("@farmer/core/services");
		try {
			return await assistantService.settings.set(context.ctx, data);
		} catch (error) {
			// A refused key is an `OpenRouterError`: its message is safe for the
			// admin, and a refusal is not a fault to report. The REST route does
			// the same.
			const message =
				error instanceof Error ? userFacingAssistantError(error) : null;
			if (message !== null) throw new UserFacingError(message);
			throw error;
		}
	});

export const updateAssistantSettings = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateAssistantSettingsInput)
	.handler(async ({ data, context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.settings.update(context.ctx, data);
	});

export const disconnectAssistant = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.settings.disconnect(context.ctx);
	});

export const listAssistantModels = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.settings.listModels(context.ctx);
	});

export const getAssistantUsage = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(assistantUsageInput)
	.handler(async ({ data, context }) => {
		const { assistantUsageService } = await import("@farmer/core/services");
		return assistantUsageService.summary(context.ctx, data);
	});

export const listConversations = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.conversations.list(context.ctx);
	});

export const getConversation = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(conversationIdInput)
	.handler(async ({ data, context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.conversations.get(context.ctx, data.conversationId);
	});

export const createConversation = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createConversationInput)
	.handler(async ({ data, context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.conversations.create(context.ctx, data);
	});

export const renameConversation = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(renameConversationInput)
	.handler(async ({ data, context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.conversations.rename(context.ctx, data);
	});

export const deleteConversation = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(conversationIdInput)
	.handler(async ({ data, context }) => {
		const { assistantService } = await import("@farmer/core/services");
		return assistantService.conversations.remove(
			context.ctx,
			data.conversationId,
		);
	});
