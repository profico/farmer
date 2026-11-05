import type { ApiDeleted } from "@farmer/core/api";
import { answerInvitationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { userWriteRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/me/invitations/$id/decline` — say no to an invitation. The
 * workspace that sent it sees that in its audit log. A sign-in session only:
 * an API token gets 403.
 */
export const Route = createFileRoute("/api/v1/me/invitations/$id/decline")({
	server: {
		handlers: {
			POST: userWriteRoute({
				input: answerInvitationInput,
				raw: ({ params }: { params: { id: string } }) => ({
					invitationId: params.id,
				}),
				run: async (caller, input): Promise<ApiDeleted> => {
					const headers = await caller.sessionHeaders();
					const { onboarding } = await import("@farmer/core/auth");
					await onboarding.rejectInvitation(headers, input.invitationId);
					return { id: input.invitationId };
				},
			}),
		},
	},
});
