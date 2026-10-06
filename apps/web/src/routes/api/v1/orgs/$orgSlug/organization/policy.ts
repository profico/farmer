import { type ApiOrgPolicy, toApiOrgPolicy } from "@farmer/core/api";
import { updateOrgSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/organization/policy` — the Tracking rule's tolerance
 * and the automation lock, on Settings → Organization. Admins only. A change
 * is a patch: a field that is not sent keeps its value, and
 * `automationLockedThrough: null` removes the lock.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/organization/policy",
)({
	server: {
		handlers: {
			GET: apiRoute({
				signInOnly: true,
				input: NO_INPUT,
				run: async (ctx): Promise<ApiOrgPolicy> => {
					const { orgSettingsService } = await import("@farmer/core/services");
					return toApiOrgPolicy(await orgSettingsService.getForAdmin(ctx));
				},
			}),
			PATCH: apiRoute({
				signInOnly: true,
				input: updateOrgSettingsInput,
				run: async (ctx, input): Promise<ApiOrgPolicy> => {
					const { orgSettingsService } = await import("@farmer/core/services");
					await orgSettingsService.update(ctx, input);
					return toApiOrgPolicy(await orgSettingsService.getForAdmin(ctx));
				},
			}),
		},
	},
});
