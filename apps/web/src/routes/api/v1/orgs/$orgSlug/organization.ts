import {
	type ApiOrganizationSettings,
	toApiOrganizationSettings,
} from "@farmer/core/api";
import { updateOrganizationSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/organization` — Settings → Organization: the name,
 * the country, the timezone, the first day of the week and the logo. Admins
 * only, which `organizationService` checks. A change is a patch, and a
 * timezone that is not an IANA name is refused.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/organization")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiOrganizationSettings> => {
					const { organizationService } = await import("@farmer/core/services");
					return toApiOrganizationSettings(
						await organizationService.getSettings(ctx),
					);
				},
			}),
			PATCH: apiRoute({
				input: updateOrganizationSettingsInput,
				run: async (ctx, input): Promise<ApiOrganizationSettings> => {
					const { organizationService } = await import("@farmer/core/services");
					return toApiOrganizationSettings(
						await organizationService.updateSettings(ctx, input),
					);
				},
			}),
		},
	},
});
