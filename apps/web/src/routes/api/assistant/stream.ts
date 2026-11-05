import { runAssistantInput } from "@farmer/core/schema";
// A TYPE-only import, so it is erased at compile time and never becomes the
// static `@farmer/core/services` import the client-bundle rule forbids here.
import type { AssistantEvent } from "@farmer/core/services";
import { createFileRoute } from "@tanstack/react-router";

import { SSE_HEARTBEAT, startHeartbeat } from "#/lib/sse-heartbeat.ts";
import { resolveApiOrgContext } from "#/server/api-auth.ts";
import { admitAssistantTurn } from "#/server/assistant-rate-limit.ts";

// One turn of the assistant, streamed.
//
// A server ROUTE rather than a `createServerFn`, because a server function
// resolves to one value and the whole point here is that the answer arrives
// token by token. Session-cookie authed like the server functions, not `api/v1`:
// this is the chat page's own transport, not a public endpoint.
//
// `resolveApiOrgContext` (server/api-auth.ts) rather than the middleware in
// server/auth.ts — see the note at the top of that file. It also re-checks
// membership, so an ex-member with a live session gets a 401 here.

/**
 * Point the agent loop's analytics seam at PostHog, once per process.
 *
 * Here rather than in `server.ts`, which `vite dev` never loads — so a sink
 * installed there would exist in production and nowhere else, and the one
 * place anybody would notice the difference is the dashboard. This route is
 * the only way a turn ever starts, including the resume after an approval, so
 * installing on the way through covers every call the loop makes.
 *
 * Deferred and guarded: `posthog-ai.ts` pulls in `posthog-node`, and
 * `routeTree.gen.ts` imports every route module statically, so a top-level
 * import here would ship the server's analytics client to the browser.
 */
let aiTelemetryInstalled = false;

const installAiTelemetry = async () => {
	if (aiTelemetryInstalled) return;
	aiTelemetryInstalled = true;
	const [{ setAiTelemetrySink }, { posthogAiSink }] = await Promise.all([
		import("@farmer/core/services"),
		import("#/lib/posthog-ai.ts"),
	]);
	// A deployment with no PostHog credentials installs nothing, so the loop
	// keeps the no-op sink and never builds an event.
	const { posthogServerConfig } = await import("#/lib/posthog-server.ts");
	if (!posthogServerConfig()) return;
	setAiTelemetrySink(posthogAiSink);
};

const encoder = new TextEncoder();

const frame = (event: AssistantEvent) =>
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
				const { isAssistantEnabled } =
					await import("@farmer/core/lib/assistant-flag");
				if (!isAssistantEnabled()) {
					return Response.json({ error: "Not found" }, { status: 404 });
				}

				const ctx = await resolveApiOrgContext(request);
				if (!ctx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				// The tools run with this Ctx, so a change the assistant makes is
				// recorded as the assistant's, on behalf of this person. Set on the
				// Ctx itself rather than on a copy: the copy would lose the memo
				// that `resolveApiOrgContext` warmed.
				ctx.actor = { ...ctx.actor, via: "assistant" };

				const parsed = runAssistantInput.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json(
						{ error: parsed.error.issues[0]?.message ?? "Bad request" },
						{ status: 400 },
					);
				}

				// After auth, because the limit is per person: a turn is a paid
				// completion against the org's key, and a runaway script or a stuck
				// retry loop in a tab would otherwise spend it as fast as the model
				// answers. The client shows `error` as it is.
				const admitted = admitAssistantTurn(ctx.userId);
				if (!admitted.ok) {
					return Response.json(
						{
							error: `Too many messages in a minute. Try again in ${admitted.retryAfterSeconds} seconds.`,
						},
						{
							status: 429,
							headers: { "Retry-After": String(admitted.retryAfterSeconds) },
						},
					);
				}

				const { assistantService, userFacingAssistantError } =
					await import("@farmer/core/services");
				await installAiTelemetry();

				const stream = new ReadableStream({
					async start(controller) {
						// The turn can outlive the client: a user who navigates away mid
						// answer aborts the request, and without this the loop would keep
						// calling OpenRouter (and keep billing) for a reader that is gone.
						const abort = new AbortController();
						request.signal.addEventListener("abort", () => abort.abort());

						let closed = false;
						const write = (bytes: Uint8Array) => {
							if (closed) return;
							try {
								controller.enqueue(bytes);
							} catch {
								// The consumer went away between the abort firing and the
								// loop noticing. Nothing to do and nothing worth logging.
								closed = true;
							}
						};
						const send = (event: AssistantEvent) => write(frame(event));

						// A turn can be silent for minutes (a model that thinks, a stall
						// and its retry, a slow tool). `server.ts` closes a connection
						// that is silent for 255 s, so a comment line goes out every
						// 20 s. The `finally` below stops it on every exit path.
						const stopHeartbeat = startHeartbeat(() => write(SSE_HEARTBEAT));
						request.signal.addEventListener("abort", stopHeartbeat);

						try {
							await assistantService.run(ctx, parsed.data, send, abort.signal);
						} catch (error) {
							// The stream has already returned 200 by this point, so an
							// event is the only channel left. Errors the loop throws on
							// purpose (not configured, conversation not found, a refusal)
							// are worded for the person and go through as they are; any
							// other message can carry SQL or a hostname, so it is logged
							// here and the person gets a generic line.
							const message =
								error instanceof Error ? userFacingAssistantError(error) : null;
							if (!message) {
								const { loggableError } =
									await import("@farmer/core/lib/loggable-error");
								console.error("[assistant] turn failed", loggableError(error));
							}
							send({
								type: "error",
								message:
									message ?? "The assistant failed. Try again in a moment.",
							});
						} finally {
							stopHeartbeat();
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
