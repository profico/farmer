import { type ApiInvitation, toApiInvitation } from "@farmer/core/api";
import { inviteMemberInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/invitations` — the pending invitations, and a new
 * one. Admins only.
 *
 * The list is read from the table (`membersService.listInvitations`), so an
 * API token may read it. An invitation goes through better-auth, which sends
 * the email and the Slack message and records the audit row. That needs a
 * session, so an API token cannot invite (see `memberAdmin`).
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/invitations/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiInvitation[]> => {
					const { membersService } = await import("@farmer/core/services");
					const rows = await membersService.listInvitations(ctx);
					return rows.map(toApiInvitation);
				},
			}),
			POST: apiRoute({
				input: inviteMemberInput,
				run: async (ctx, input, caller): Promise<ApiInvitation> => {
					const headers = await caller.sessionHeaders();
					const { memberAdmin } = await import("@farmer/core/auth");
					const created = await memberAdmin.invite(ctx, headers, input);
					// Read back from the list, so the answer has the email state.
					const { membersService } = await import("@farmer/core/services");
					const rows = await membersService.listInvitations(ctx);
					const row = rows.find((pending) => pending.id === created.id);
					if (!row) throw new Error("Invitation not found");
					return toApiInvitation(row);
				},
			}),
		},
	},
});
