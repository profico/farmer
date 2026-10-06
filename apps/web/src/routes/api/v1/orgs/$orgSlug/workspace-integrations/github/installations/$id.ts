import type { ApiGithubDisconnect } from "@farmer/core/api";
import { disconnectInstallationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/orgs/$orgSlug/workspace-integrations/github/installations/$id` —
 * disconnects one installation from this workspace. Admin only.
 *
 * `?uninstall=true` also removes the App from the GitHub account. That is
 * refused when another workspace still uses the installation, and the answer
 * says what happened rather than failing.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/github/installations/$id",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				signInOnly: true,
				input: disconnectInstallationInput,
				// A query flag, not a body: many clients drop the body of a DELETE.
				raw: ({ params, query }: ApiRequest<OrgRowParams>) => ({
					installationRowId: params.id,
					uninstall: query.get("uninstall") === "true",
				}),
				run: async (ctx, input): Promise<ApiGithubDisconnect> => {
					const { githubService } = await import("@farmer/core/services");
					return githubService.disconnectInstallation(ctx, input);
				},
			}),
		},
	},
});
