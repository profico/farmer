// What the stream reader does when the person stops listening.
//
// The read loop had a `finally` and no `catch`, so the rejection `read()`
// raises the moment the signal fires carried every token of a half-written
// answer out of the function with it. Pressing Stop, or navigating away, threw
// away work the organization had already paid for and left the thread looking
// as though the question had never been asked.
//
// This goes through `globalThis.fetch` because the client is the layer under
// every seam this repository has.

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { ABORTED, streamChatCompletion } from "./openrouter-client";

const realFetch = globalThis.fetch;

/** An SSE body that emits the given frames, then stays open until the signal
 *  fires — at which point it fails the way a real fetch body does.
 *
 *  Staying open is the point: the turn under test is one that is still being
 *  written when the reader gives up on it. A hand-built ReadableStream is not
 *  wired to an AbortSignal the way a fetch body is, so the wiring is spelled
 *  out here rather than assumed. */
const streamingBody = (frames: string[], signal: AbortSignal) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const frame of frames) {
				controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
			}
			signal.addEventListener("abort", () => {
				controller.error(
					new DOMException("The operation was aborted", "AbortError"),
				);
			});
		},
	});

const delta = (text: string) =>
	JSON.stringify({ choices: [{ delta: { content: text } }] });

const call = (signal: AbortSignal) =>
	streamChatCompletion({
		apiKey: "test-key",
		model: "test/model",
		messages: [{ role: "user", content: "hello" }],
		signal,
	});

afterEach(() => {
	globalThis.fetch = realFetch;
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

describe("a stream the caller stops part-way", () => {
	test("gives back what had already arrived", async () => {
		const controller = new AbortController();
		// SAFETY: a test stub for `fetch`. It ignores its arguments and answers
		// one shape — the streamed completion the code under test asks for.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(
				streamingBody([delta("Half an "), delta("answer")], controller.signal),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			)) as typeof globalThis.fetch;

		const pending = call(controller.signal);
		// The frames are already queued; now the person presses Stop.
		setTimeout(() => {
			controller.abort();
		}, 10);
		const turn = await pending;
		expect(turn.content).toBe("Half an answer");
		// Said plainly, because the loop above has to tell "the model stopped"
		// from "the person did" — one of those stores a finished answer.
		expect(turn.finishReason).toBe(ABORTED);
	});

	test("a half-built tool call is not returned as a whole one", async () => {
		// Arguments accumulate across fragments. A call cut off mid-JSON is not
		// something any caller can run, and returning it would put an
		// unanswerable `tool_calls` row in the thread.
		const controller = new AbortController();
		const fragment = JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call-1",
								function: { name: "list_projects", arguments: '{"fro' },
							},
						],
					},
				},
			],
		});
		// SAFETY: as above — a stub that answers one shape.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(streamingBody([fragment], controller.signal), {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})) as typeof globalThis.fetch;

		const pending = call(controller.signal);
		setTimeout(() => {
			controller.abort();
		}, 10);
		const turn = await pending;
		expect(turn.finishReason).toBe(ABORTED);
		// The fragment IS returned here — this layer only reads the wire. Dropping
		// it is the loop's job, and `assistant.service.ts` does it on the same
		// signal.
		expect(turn.toolCalls[0]?.arguments).toBe('{"fro');
	});

	test("an error that is not the abort still travels", async () => {
		const controller = new AbortController();
		// SAFETY: as above.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(streamController) {
						streamController.error(new Error("connection reset"));
					},
				}),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			)) as typeof globalThis.fetch;

		await expect(call(controller.signal)).rejects.toThrow("connection reset");
	});
});
