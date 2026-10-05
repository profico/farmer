import type { ApiDeleted } from "@farmer/core/api";
import { importClaimInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { userWriteRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/me/import-claims/$organizationId/decline` — leave the
 * workspace whose Harvest import named the caller. The membership goes, and
 * the imported history stays with the workspace. Answers the organization's
 * id. A sign-in session only, as on `/no-access`: an API token gets 403.
 */
export const Route = createFileRoute(
	"/api/v1/me/import-claims/$organizationId/decline",
)({
	server: {
		handlers: {
			POST: userWriteRoute({
				input: importClaimInput,
				raw: ({ params }: { params: { organizationId: string } }) => ({
					organizationId: params.organizationId,
				}),
				run: async (caller, input): Promise<ApiDeleted> => {
					// No better-auth call here. This is the gate that refuses an
					// API token, with the same sentence.
					await caller.sessionHeaders();
					const { importClaimsService } = await import("@farmer/core/services");
					await importClaimsService.decline({
						organizationId: input.organizationId,
						userId: caller.userId,
						actor: caller.actor,
					});
					return { id: input.organizationId };
				},
			}),
		},
	},
});
