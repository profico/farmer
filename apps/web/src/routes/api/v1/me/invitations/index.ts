import { type ApiMyInvitation, toApiMyInvitation } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { userApiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/me/invitations` — the live invitations to the caller's
 * address, as `/no-access` lists them. Empty for an address that is not
 * verified, outside development. An API token bound to one workspace gets an
 * empty list, so it cannot tell where else its owner is asked to work.
 */
export const Route = createFileRoute("/api/v1/me/invitations/")({
	server: {
		handlers: {
			GET: userApiRoute({
				run: async (caller): Promise<ApiMyInvitation[]> => {
					if (caller.boundOrganizationId) return [];
					const { onboarding } = await import("@farmer/core/auth");
					const rows = await onboarding.pendingInvitationsForUser(
						caller.userId,
					);
					return rows.map(toApiMyInvitation);
				},
			}),
		},
	},
});
