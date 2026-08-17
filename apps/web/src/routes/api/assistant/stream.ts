import { runAssistantInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { resolveApiOrgContext } from "#/server/api-auth.ts";

// One turn of the assistant, streamed.
//
// A server ROUTE rather than a `createServerFn`, because a server function
// resolves to one value and the whole point here is that the answer arrives
// token by token. Session-cookie authed like `api/reports/pdf`, not `api/v1`:
// this is the chat page's own transport, not a public endpoint.
//
// `resolveApiOrgContext` (server/api-auth.ts) rather than the middleware in
// server/auth.ts — see the note at the top of that file. It also re-checks
// membership, so an ex-member with a live session gets a 401 here.

const encoder = new TextEncoder();

const frame = (event: unknown) =>
	encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export const Route = createFileRoute("/api/assistant/stream")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// The kill switch, before auth and before anything is imported: a
				// feature switched off at the deployment has no live endpoint, rather
				// than one that opens a stream and then explains itself. 404 rather
				// than 403 for the same reason — there is nothing here to be
				// authorized for.
				const { isAssistantEnabled } = await import(
					"@farmer/core/lib/assistant-flag"
				);
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

				const { assistantService } = await import("@farmer/core/services");

				const stream = new ReadableStream({
					async start(controller) {
						// The turn can outlive the client: a user who navigates away mid
						// answer aborts the request, and without this the loop would keep
						// calling OpenRouter (and keep billing) for a reader that is gone.
						const abort = new AbortController();
						request.signal.addEventListener("abort", () => abort.abort());

						let closed = false;
						const send = (event: unknown) => {
							if (closed) return;
							try {
								controller.enqueue(frame(event));
							} catch {
								// The consumer went away between the abort firing and the
								// loop noticing. Nothing to do and nothing worth logging.
								closed = true;
							}
						};

						try {
							await assistantService.run(ctx, parsed.data, send, abort.signal);
						} catch (error) {
							// Every error the loop can name (not configured, conversation
							// not found, a service refusing a tool) arrives here as a
							// message the user can act on. The stream has already returned
							// 200 by this point, so this is the only channel left.
							send({
								type: "error",
								message:
									error instanceof Error
										? error.message
										: "The assistant failed",
							});
						} finally {
							closed = true;
							controller.close();
						}
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						// Nginx and friends buffer streaming responses by default, which
						// turns a live answer into one lump on completion.
						"X-Accel-Buffering": "no",
					},
				});
			},
		},
	},
});
