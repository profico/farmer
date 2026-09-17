import type { ApiMe } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { userApiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/me` — who a token belongs to, and which organizations they may
 * name in a URL.
 *
 * The one route that has to work before an organization is chosen: a
 * device-flow token was never used to enter a workspace, so `farmer login`
 * asks this and then offers the list. Only the caller's own memberships are
 * listed, so this is not a way to find out which workspaces exist.
 */
export const Route = createFileRoute("/api/v1/me")({
	server: {
		handlers: {
			GET: userApiRoute({
				run: async (caller): Promise<ApiMe> => {
					const { orgContextService } = await import("@farmer/core/services");

					return {
						user: caller.user,
						organizations: await orgContextService.organizationsFor(
							caller.userId,
						),
					};
				},
			}),
		},
	},
});
