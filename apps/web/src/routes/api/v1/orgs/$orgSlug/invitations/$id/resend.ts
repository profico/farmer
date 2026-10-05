import { type ApiInvitation, toApiInvitation } from "@farmer/core/api";
import { resendInvitationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ invitationId: resendInvitationInput });

/**
 * `POST /api/v1/orgs/$orgSlug/invitations/$id/resend` — sends a pending
 * invitation again and moves its expiry forward. Admins only. It goes through
 * better-auth, so an API token cannot do it (see `memberAdmin`).
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/invitations/$id/resend",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					invitationId: params.id,
				}),
				run: async (ctx, { invitationId }, caller): Promise<ApiInvitation> => {
					const headers = await caller.sessionHeaders();
					const { memberAdmin } = await import("@farmer/core/auth");
					const sent = await memberAdmin.resend(ctx, headers, invitationId);
					const { membersService } = await import("@farmer/core/services");
					const rows = await membersService.listInvitations(ctx);
					const row = rows.find((pending) => pending.id === sent.id);
					if (!row) throw new Error("Invitation not found");
					return toApiInvitation(row);
				},
			}),
		},
	},
});
