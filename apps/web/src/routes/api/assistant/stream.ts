import { runAssistantInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { resolveApiOrgContext } from "#/server/api-auth.ts";
import { streamAssistantTurn } from "#/server/assistant-stream.ts";

// One turn of the assistant, streamed.
//
// A server ROUTE rather than a `createServerFn`, because a server function
// resolves to one value and the whole point here is that the answer arrives
// token by token. Session-cookie authed like the server functions, not `api/v1`:
// this is the chat page's own transport, not a public endpoint. The REST API's
// thread routes stream the same turn with a bearer credential; the body both
// share is `streamAssistantTurn` (server/assistant-stream.ts).
//
// `resolveApiOrgContext` (server/api-auth.ts) rather than the middleware in
// server/auth.ts — see the note at the top of that file. It also re-checks
// membership, so an ex-member with a live session gets a 401 here.

export const Route = createFileRoute("/api/assistant/stream")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// The kill switch, before auth and before anything is imported: a
				// feature switched off at the deployment has no live endpoint, rather
				// than one that opens a stream and then explains itself. 404 rather
				// than 403 for the same reason — there is nothing here to be
				// authorized for.
				const { isAssistantEnabled } =
					await import("@farmer/core/lib/assistant-flag");
				if (!isAssistantEnabled()) {
					return Response.json({ error: "Not found" }, { status: 404 });
				}

				const ctx = await resolveApiOrgContext(request);
				if (!ctx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const parsed = runAssistantInput.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json(
						{ error: parsed.error.issues[0]?.message ?? "Bad request" },
						{ status: 400 },
					);
				}

				return streamAssistantTurn(ctx, parsed.data, request);
			},
		},
	},
});
