import { type ApiSession, toApiSession } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { requireSignIn, userApiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/me/sessions` — the sign-ins of the caller that can still be
 * used: browsers, terminals and phones. It is Preferences → Signed-in
 * devices. The caller's own session is first and marked `isCurrent`.
 *
 * A session belongs to the person and not to a workspace, so no organization
 * is in the path. The mobile app and the CLI hold a session token, which
 * names the current row. A signed-in browser that reads with its cookie has
 * no token to name it, so it sees no current row. An API token is refused.
 */
export const Route = createFileRoute("/api/v1/me/sessions/")({
	server: {
		handlers: {
			GET: userApiRoute({
				run: async (caller): Promise<ApiSession[]> => {
					await requireSignIn(caller.via);
					const { sessionsService } = await import("@farmer/core/services");
					const ctx = { userId: caller.userId, actor: caller.actor };
					const { credential } = caller;
					const currentId =
						credential?.kind === "session"
							? await sessionsService.currentIdFor(ctx, credential.token)
							: null;
					const rows = await sessionsService.listMine(ctx, currentId);
					return rows.map(toApiSession);
				},
			}),
		},
	},
});
