import { type ApiClient, toApiClient } from "@farmer/core/api";
import { clientIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ clientId: clientIdInput });

/**
 * `POST /api/v1/orgs/$orgSlug/clients/$id/restore` — restores an archived
 * client. Admins only, which `clientsService.unarchive` checks.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/clients/$id/restore",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					clientId: params.id,
				}),
				run: async (ctx, { clientId }): Promise<ApiClient> => {
					const { clientsService } = await import("@farmer/core/services");
					await clientsService.unarchive(ctx, clientId);
					const rows = await clientsService.listAll(ctx);
					const row = rows.find((client) => client.id === clientId);
					if (!row) throw new Error("Client not found");
					return toApiClient(row);
				},
			}),
		},
	},
});
