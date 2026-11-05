import type { ApiJoinedOrganization } from "@farmer/core/api";
import { importClaimInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { userWriteRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/me/import-claims/$organizationId/accept` — join the workspace
 * whose Harvest import holds the caller's history. Joining runs what each
 * other way in runs: the audit row, the Slack match and `member.added`.
 * Answers the workspace to open.
 *
 * A sign-in session only, as on `/no-access`: an API token gets 403.
 */
export const Route = createFileRoute(
	"/api/v1/me/import-claims/$organizationId/accept",
)({
	server: {
		handlers: {
			POST: userWriteRoute({
				input: importClaimInput,
				raw: ({ params }: { params: { organizationId: string } }) => ({
					organizationId: params.organizationId,
				}),
				run: async (caller, input): Promise<ApiJoinedOrganization> => {
					// No better-auth call here. This is the gate that refuses an
					// API token, with the same sentence.
					await caller.sessionHeaders();
					const { importClaimsService } = await import("@farmer/core/services");
					const { slug } = await importClaimsService.accept({
						organizationId: input.organizationId,
						userId: caller.userId,
						actor: caller.actor,
					});
					return { organizationId: input.organizationId, slug };
				},
			}),
		},
	},
});
