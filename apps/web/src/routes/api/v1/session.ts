import { createFileRoute } from "@tanstack/react-router";

import { userApiRoute } from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/session` — `farmer logout`. Revokes the credential the
 * request was sent with, and no other: a person signed in to the browser and
 * to two laptops logs one laptop out.
 *
 * Either kind of bearer token. A device-flow token ends its session; a personal
 * API token deletes itself, which is how a script that is being retired hands
 * its token back. A read-only token may do this too (see `userApiRoute`).
 *
 * A DELETE is never authenticated by cookie (see `cookieUser` in
 * `server/api-route.ts`), so the credential is always present here; the check
 * below is for the type, not for a case that happens. A token that no longer
 * resolves is a 401 before this runs, which the CLI treats as already logged
 * out.
 */
export const Route = createFileRoute("/api/v1/session")({
	server: {
		handlers: {
			DELETE: userApiRoute({
				status: 204,
				run: async (caller) => {
					const { credential } = caller;
					if (!credential) return null;
					if (credential.kind === "api_token") {
						const { apiTokensService } = await import("@farmer/core/services");
						await apiTokensService.revokePresented(credential.principal);
						return null;
					}
					const { auth } = await import("@farmer/core/auth");
					const context = await auth.$context;
					await context.internalAdapter.deleteSession(credential.token);
					return null;
				},
			}),
		},
	},
});
