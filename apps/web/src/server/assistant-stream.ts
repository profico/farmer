import type { RunAssistantInput } from "@farmer/core/schema";
// TYPE-only imports, so they are erased at compile time and never become the
// static `@farmer/core/services` import the client-bundle rule forbids here.
import type { AssistantEvent, Ctx } from "@farmer/core/services";

import { admitAssistantTurn } from "#/server/assistant-rate-limit.ts";

// One turn of the assistant, streamed as Server-Sent Events. The body of both
// stream routes: the chat page's cookie route (`api/assistant/stream`) and the
// REST API's two thread routes (`api/v1/orgs/$orgSlug/assistant/threads/$id/
// messages` and `.../approvals`). Each route resolves the caller its own way and
// checks `ASSISTANT_ENABLED` first; everything after that is here, so the two
// cannot drift.

/**
 * Point the agent loop's analytics seam at PostHog, once per process.
 *
 * Here rather than in `server.ts`, which `vite dev` never loads — so a sink
 * installed there would exist in production and nowhere else, and the one
 * place anybody would notice the difference is the dashboard. A turn only
 * starts through `streamAssistantTurn`, including the resume after an
 * approval, so installing on the way through covers every call the loop makes.
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

/**
 * Run one turn for `ctx` and answer with the stream of its events.
 *
 * The caller has already authenticated the request and parsed `input`. The
 * request is still needed for its abort signal.
 */
export const streamAssistantTurn = async (
	ctx: Ctx,
	input: RunAssistantInput,
	request: Request,
): Promise<Response> => {
	// The tools run with this Ctx, so a change the assistant makes is recorded
	// as the assistant's, on behalf of this person. Set on the Ctx itself rather
	// than on a copy: the copy would lose the memo the route's auth warmed.
	ctx.actor = { ...ctx.actor, via: "assistant" };

	// After auth, because the limit is per person: a turn is a paid completion
	// against the org's key, and a runaway script or a stuck retry loop in a
	// tab would otherwise spend it as fast as the model answers. The client
	// shows `error` as it is; `code` is the REST API's error code.
	const admitted = admitAssistantTurn(ctx.userId);
	if (!admitted.ok) {
		return Response.json(
			{
				error: `Too many messages in a minute. Try again in ${admitted.retryAfterSeconds} seconds.`,
				code: "rate_limited",
			},
			{
				status: 429,
				headers: {
					"Retry-After": String(admitted.retryAfterSeconds),
					"Cache-Control": "no-store",
				},
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
			const send = (event: AssistantEvent) => {
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
				await assistantService.run(ctx, input, send, abort.signal);
			} catch (error) {
				// The stream has already returned 200 by this point, so an
				// event is the only channel left. Errors the loop throws on
				// purpose (not configured, conversation not found, a refusal)
				// are worded for the person and go through as they are; any
				// other message can carry SQL or a hostname, so it is logged
				// here and the person gets a generic line.
				const message =
					error instanceof Error ? userFacingAssistantError(error) : null;
				if (!message) console.error("[assistant] turn failed", error);
				send({
					type: "error",
					message: message ?? "The assistant failed. Try again in a moment.",
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
};

/**
 * The REST API's answer when `ASSISTANT_ENABLED` is off: the thread routes do
 * not exist, as the chat page does not. A bare `Error` whose sentence says
 * "not found" is what `apiRoute` maps to 404 (`classifyServiceError`).
 */
export const assertAssistantAvailable = async (): Promise<void> => {
	const { isAssistantEnabled } =
		await import("@farmer/core/lib/assistant-flag");
	if (!isAssistantEnabled()) throw new Error("Not found");
};
