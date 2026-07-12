import { updateIntegrationSettingsInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

// POST (not GET) so the response is never CDN/browser-cacheable — private,
// cookie-scoped per-user state; see getGithubConnectionStatus for the why.
export const getIntegrationSettings = createServerFn({
	method: "POST",
})
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { integrationSettingsService } = await import("@farmer/core/services");
		return integrationSettingsService.get(context.ctx);
	});

export const updateIntegrationSettings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateIntegrationSettingsInput)
	.handler(async ({ data, context }) => {
		const { integrationSettingsService } = await import(
			"@farmer/core/services"
		);
		return integrationSettingsService.update(context.ctx, data);
	});
