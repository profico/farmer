import { apiTokenIdInput, createApiTokenInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// Preferences → API tokens. The tokens belong to the person, but every call
// still runs through `orgMiddleware`: the service takes the membership-checked
// Ctx, and "Only this workspace" binds a new token to its organization.

export const listMyApiTokens = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { apiTokensService } = await import("@farmer/core/services");
		return apiTokensService.listMine(context.ctx);
	});

export const createApiToken = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createApiTokenInput)
	.handler(async ({ data, context }) => {
		const { apiTokensService } = await import("@farmer/core/services");
		return apiTokensService.create(context.ctx, data);
	});

export const revokeApiToken = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(apiTokenIdInput)
	.handler(async ({ data: tokenId, context }) => {
		const { apiTokensService } = await import("@farmer/core/services");
		return apiTokensService.revoke(context.ctx, tokenId);
	});
