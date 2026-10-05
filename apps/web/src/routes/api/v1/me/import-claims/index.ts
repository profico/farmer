import { type ApiImportClaim, toApiImportClaim } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { userApiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/me/import-claims` — the workspaces whose Harvest import made a
 * membership for the caller, oldest first. The caller cannot open them until
 * they accept. An API token bound to one workspace gets an empty list.
 */
export const Route = createFileRoute("/api/v1/me/import-claims/")({
	server: {
		handlers: {
			GET: userApiRoute({
				run: async (caller): Promise<ApiImportClaim[]> => {
					if (caller.boundOrganizationId) return [];
					const { importClaimsService } = await import("@farmer/core/services");
					const rows = await importClaimsService.pendingFor(caller.userId);
					return rows.map(toApiImportClaim);
				},
			}),
		},
	},
});
