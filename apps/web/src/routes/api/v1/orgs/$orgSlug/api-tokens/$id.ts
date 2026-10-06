import type { ApiRevoked } from "@farmer/core/api";
import { apiTokenIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
	requireSignIn,
} from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/orgs/$orgSlug/api-tokens/$id` — revoke one of the caller's
 * tokens. Another person's id and an unknown id both answer
 * `{ revoked: false }`. The next request made with the token is a 401.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/api-tokens/$id")({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: apiTokenIdInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => params.id,
				run: async (ctx, tokenId, caller): Promise<ApiRevoked> => {
					await requireSignIn(caller.via);
					const { apiTokensService } = await import("@farmer/core/services");
					return apiTokensService.revoke(ctx, tokenId);
				},
			}),
		},
	},
});
