import { toApiClient } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/clients` — the organization's active clients.
 *
 * Read-only. Every member may read the list, as in the web app, where the
 * project pickers need it. Writes stay in the web app for now.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/clients")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx) => {
					const { clientsService } = await import("@farmer/core/services");
					const rows = await clientsService.list(ctx);
					return rows.map(toApiClient);
				},
			}),
		},
	},
});
