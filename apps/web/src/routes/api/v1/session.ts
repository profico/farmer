import { createFileRoute } from "@tanstack/react-router";

import { userApiRoute } from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/session` — `farmer logout`. Revokes the session the bearer
 * token IS, and no other: a person signed in to the browser and to two laptops
 * logs one laptop out.
 *
 * A DELETE is never authenticated by cookie (see `cookieUser` in
 * `server/api-route.ts`), so the token is always present here; the check below
 * is for the type, not for a case that happens. A token that no longer resolves
 * is a 401 before this runs, which the CLI treats as already logged out.
 */
export const Route = createFileRoute("/api/v1/session")({
	server: {
		handlers: {
			DELETE: userApiRoute({
				status: 204,
				run: async (caller) => {
					if (!caller.token) return null;
					const { auth } = await import("@farmer/core/auth");
					const context = await auth.$context;
					await context.internalAdapter.deleteSession(caller.token);

					return null;
				},
			}),
		},
	},
});
