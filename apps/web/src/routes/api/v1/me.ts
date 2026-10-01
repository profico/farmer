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
					const all = await orgContextService.organizationsFor(caller.userId);
					// A token bound to one workspace lists that one, so it cannot
					// be used to find out where else its owner works.
					const organizations = caller.boundOrganizationId
						? all.filter((org) => org.id === caller.boundOrganizationId)
						: all;
					return {
						user: caller.user,
						// The CLI's contract is the slug and the name. The logo and the
						// role are for the web app's chooser, and `farmer org --json`
						// prints this list as it arrives.
						organizations: organizations.map(({ slug, name }) => ({
							slug,
							name,
						})),
					};
				},
			}),
		},
	},
});
