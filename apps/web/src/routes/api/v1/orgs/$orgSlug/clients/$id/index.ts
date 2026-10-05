import { type ApiClient, toApiClient } from "@farmer/core/api";
import { updateClientInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `PATCH /api/v1/orgs/$orgSlug/clients/$id` — renames a client. Admins only,
 * which `clientsService.update` checks.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/clients/$id/")({
	server: {
		handlers: {
			PATCH: apiRoute({
				input: updateClientInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { clientId: params.id }),
				run: async (ctx, input): Promise<ApiClient> => {
					const { clientsService } = await import("@farmer/core/services");
					return toApiClient(await clientsService.update(ctx, input));
				},
			}),
		},
	},
});
