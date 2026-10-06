import type { ApiRevoked } from "@farmer/core/api";
import { sessionIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { requireSignIn, userWriteRoute } from "#/server/api-route.ts";

type Params = { id: string };

/**
 * `DELETE /api/v1/me/sessions/$id` — end one of the caller's other sign-ins.
 * Another person's id, and an id that does not exist, both answer
 * `{ revoked: false }`.
 *
 * The session the request is made with is refused with 422. Ending it is
 * signing out, which is `DELETE /api/v1/session`: the client must clear its
 * own stored token, and this route cannot do that for it.
 */
export const Route = createFileRoute("/api/v1/me/sessions/$id")({
	server: {
		handlers: {
			DELETE: userWriteRoute({
				input: sessionIdInput,
				raw: ({ params }: { params: Params }) => params.id,
				run: async (caller, sessionId): Promise<ApiRevoked> => {
					await requireSignIn(caller.via);
					const { sessionsService } = await import("@farmer/core/services");
					const ctx = { userId: caller.userId, actor: caller.actor };
					const { credential } = caller;
					const currentId =
						credential?.kind === "session"
							? await sessionsService.currentIdFor(ctx, credential.token)
							: null;
					return sessionsService.revoke(ctx, sessionId, currentId);
				},
			}),
		},
	},
});
