import type { ApiJoinedOrganization } from "@farmer/core/api";
import { answerInvitationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { userWriteRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/me/invitations/$id/accept` — join the workspace that sent
 * the invitation. better-auth makes the membership and checks that the
 * invitation is to the caller's verified address. Answers the workspace to
 * open. A sign-in session only: an API token gets 403.
 */
export const Route = createFileRoute("/api/v1/me/invitations/$id/accept")({
	server: {
		handlers: {
			POST: userWriteRoute({
				input: answerInvitationInput,
				raw: ({ params }: { params: { id: string } }) => ({
					invitationId: params.id,
				}),
				run: async (caller, input): Promise<ApiJoinedOrganization> => {
					const headers = await caller.sessionHeaders();
					const { onboarding } = await import("@farmer/core/auth");
					return onboarding.acceptInvitation(headers, input.invitationId);
				},
			}),
		},
	},
});
