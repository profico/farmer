import type { ApiDeleted } from "@farmer/core/api";
import { cancelInvitationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ invitationId: cancelInvitationInput });

/**
 * `DELETE /api/v1/orgs/$orgSlug/invitations/$id` — cancels a pending
 * invitation of this organization. Admins only. It goes through better-auth,
 * so an API token cannot do it (see `memberAdmin`).
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/invitations/$id/")({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					invitationId: params.id,
				}),
				run: async (ctx, { invitationId }, caller): Promise<ApiDeleted> => {
					const { memberAdmin } = await import("@farmer/core/auth");
					await memberAdmin.cancel(ctx, caller.sessionHeaders, invitationId);
					return { id: invitationId };
				},
			}),
		},
	},
});
