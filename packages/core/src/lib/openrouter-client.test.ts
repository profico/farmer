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

import {
	ABORTED,
	OpenRouterError,
	OpenRouterStreamCutError,
	streamChatCompletion,
} from "./openrouter-client";

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

	test("an abort with a reason that is not an Error is still an abort", async () => {
		const controller = new AbortController();
		// SAFETY: as above.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(streamController) {
						streamController.enqueue(
							new TextEncoder().encode(`data: ${delta("Half")}\n\n`),
						);
						// The read fails with the plain value of the abort reason.
						controller.signal.addEventListener("abort", () => {
							streamController.error(controller.signal.reason);
						});
					},
				}),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			)) as typeof globalThis.fetch;

		const pending = call(controller.signal);
		setTimeout(() => {
			controller.abort("user stopped");
		}, 10);
		const turn = await pending;
		expect(turn.content).toBe("Half");
		expect(turn.finishReason).toBe(ABORTED);
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

// ── a stream that ends on its own ───────────────────────────────────────────
//
// An upstream (OpenRouter, or the provider behind it) can close the connection
// with no error and no finish reason. In production this was a call that ran
// for 120 s, ended with no tokens, and was reported as a success.

/** An SSE body that emits the frames and then closes by itself. */
const closingBody = (frames: string[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const frame of frames) {
				controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
			}
			controller.close();
		},
	});

const serve = (frames: string[]) => {
	// SAFETY: a test stub for `fetch` that answers one shape.
	globalThis.fetch = (async (_input: string | URL | Request) =>
		new Response(closingBody(frames), {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		})) as typeof globalThis.fetch;
};

const finish = (reason: string) =>
	JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] });

const usage = JSON.stringify({
	choices: [],
	usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.002 },
});

const toolFragment = (args: string) =>
	JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call-1",
							function: { name: "list_projects", arguments: args },
						},
					],
				},
			},
		],
	});

describe("a stream that ends without a finish reason", () => {
	const CUT = "stream ended without a finish reason";

	test("an empty stream is an error", async () => {
		serve([]);
		await expect(call(new AbortController().signal)).rejects.toMatchObject({
			name: "OpenRouterStreamCutError",
			message: CUT,
		});
	});

	test("a stream with only [DONE] is an error", async () => {
		serve(["[DONE]"]);
		await expect(call(new AbortController().signal)).rejects.toThrow(CUT);
	});

	test("it is an OpenRouterError, so callers that catch one catch this", async () => {
		serve([delta("Half")]);
		await expect(call(new AbortController().signal)).rejects.toBeInstanceOf(
			OpenRouterError,
		);
	});

	test("what arrived is carried on the error", async () => {
		serve([delta("Half an "), delta("answer"), toolFragment('{"fro'), usage]);
		const error = await call(new AbortController().signal).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(error).toMatchObject({
			name: "OpenRouterStreamCutError",
			partial: {
				content: "Half an answer",
				finishReason: null,
				promptTokens: 12,
				completionTokens: 3,
				costUsd: 0.002,
				toolCalls: [
					{ id: "call-1", name: "list_projects", arguments: '{"fro' },
				],
			},
		});
	});

	test("a call whose arguments look whole is still not trusted", async () => {
		serve([toolFragment("{}")]);
		await expect(call(new AbortController().signal)).rejects.toThrow(CUT);
	});

	test("a close with the caller's signal already fired is an abort", async () => {
		serve([delta("Half")]);
		const controller = new AbortController();
		controller.abort();
		const turn = await call(controller.signal);
		expect(turn.finishReason).toBe(ABORTED);
		expect(turn.content).toBe("Half");
	});

	test("every finish reason the model can send is a success", async () => {
		for (const reason of ["stop", "tool_calls", "length", "content_filter"]) {
			serve([delta("Whole"), finish(reason), usage, "[DONE]"]);
			const turn = await call(new AbortController().signal);
			expect(turn.finishReason).toBe(reason);
			expect(turn.content).toBe("Whole");
		}
	});

	test("an error frame is an error that carries the reason and the partial", async () => {
		serve([
			delta("Half"),
			usage,
			JSON.stringify({
				error: {
					code: "server_error",
					message: "Provider disconnected unexpectedly",
				},
				choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
			}),
			"[DONE]",
		]);
		const error = await call(new AbortController().signal).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(OpenRouterStreamCutError);
		expect(error).toMatchObject({
			message:
				"stream failed upstream (server_error): Provider disconnected unexpectedly",
			upstream: {
				code: "server_error",
				message: "Provider disconnected unexpectedly",
			},
			partial: { content: "Half", finishReason: "error", promptTokens: 12 },
		});
	});

	test("an error object with no finish reason is still an error", async () => {
		serve([
			delta("Half"),
			JSON.stringify({ error: { code: 429, message: "Rate limited" } }),
		]);
		await expect(call(new AbortController().signal)).rejects.toMatchObject({
			upstream: { code: 429, message: "Rate limited" },
		});
	});

	test("the finish reason error with no error object is an error", async () => {
		serve([delta("Half"), finish("error"), "[DONE]"]);
		await expect(call(new AbortController().signal)).rejects.toMatchObject({
			name: "OpenRouterStreamCutError",
			upstream: { code: null },
			partial: { content: "Half", finishReason: "error" },
		});
	});

	test("the app's own timeout keeps the partial turn", async () => {
		// A fetch body rejects with `TimeoutError`, not `AbortError`, when the
		// deadline passed through `AbortSignal.any` fires mid-read.
		// SAFETY: a test stub for `fetch`. It ignores its arguments and answers
		// one shape: a stream that fails with a timeout after two frames.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						const encoder = new TextEncoder();
						controller.enqueue(encoder.encode(`data: ${delta("Half ")}\n\n`));
						controller.enqueue(encoder.encode(`data: ${delta("way")}\n\n`));
						// `error()` drops queued chunks, so the failure comes later.
						setTimeout(() => {
							controller.error(
								new DOMException("The operation timed out.", "TimeoutError"),
							);
						}, 10);
					},
				}),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			)) as typeof globalThis.fetch;
		const error = await call(new AbortController().signal).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(OpenRouterStreamCutError);
		expect(error).toMatchObject({
			message: "stream timed out before a finish reason",
			timedOut: true,
			partial: { content: "Half way", finishReason: null },
		});
	});

	test("the app's own timeout before the headers is a cut with no text", async () => {
		// SAFETY: a test stub for `fetch`. It ignores its arguments and fails
		// the way a fetch does when the deadline fires before the headers.
		globalThis.fetch = (async (
			_input: string | URL | Request,
		): Promise<Response> => {
			throw new DOMException("The operation timed out.", "TimeoutError");
		}) as typeof globalThis.fetch;
		await expect(call(new AbortController().signal)).rejects.toMatchObject({
			name: "OpenRouterStreamCutError",
			message: "request timed out before the response headers",
			timedOut: true,
			partial: { content: "", finishReason: null },
		});
	});

	test("an error frame after a Stop is still an abort", async () => {
		serve([delta("Half"), finish("error")]);
		const controller = new AbortController();
		controller.abort();
		const turn = await call(controller.signal);
		expect(turn.finishReason).toBe(ABORTED);
	});

	test("a finish reason with no [DONE] is a success", async () => {
		serve([delta("Whole"), finish("stop")]);
		const turn = await call(new AbortController().signal);
		expect(turn.finishReason).toBe("stop");
	});

	test("a null finish reason on a chunk does not count", async () => {
		serve([
			JSON.stringify({
				choices: [{ delta: { content: "x" }, finish_reason: null }],
			}),
			"[DONE]",
		]);
		await expect(call(new AbortController().signal)).rejects.toThrow(CUT);
	});

	test("a frame split across two reads still yields the finish reason", async () => {
		const encoder = new TextEncoder();
		const whole = `data: ${finish("stop")}\n\n`;
		// SAFETY: a test stub for `fetch` that answers one shape.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode(whole.slice(0, 20)));
						controller.enqueue(encoder.encode(whole.slice(20)));
						controller.close();
					},
				}),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			)) as typeof globalThis.fetch;
		const turn = await call(new AbortController().signal);
		expect(turn.finishReason).toBe("stop");
	});
});

describe("a rejected request", () => {
	const reject = (status: number, body: string) => {
		// SAFETY: a test stub for `fetch` that answers one shape.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(body, { status })) as typeof globalThis.fetch;
	};

	const failure = async () => {
		try {
			await call(new AbortController().signal);
		} catch (error) {
			if (error instanceof OpenRouterError) return error;
			throw error;
		}
		throw new Error("the call did not fail");
	};

	test("a JSON error body gives its message", async () => {
		reject(401, JSON.stringify({ error: { message: "No auth credentials" } }));
		const error = await failure();
		expect(error.message).toBe("No auth credentials");
		expect(error.status).toBe(401);
	});

	test("an HTML error body gives its first 300 characters", async () => {
		reject(502, `<html>${"x".repeat(400)}</html>`);
		const error = await failure();
		expect(error.message).toBe(`<html>${"x".repeat(400)}</html>`.slice(0, 300));
		expect(error.status).toBe(502);
	});

	test("a JSON body with no message keeps the raw text", async () => {
		reject(500, '{"error":{}}');
		await expect(call(new AbortController().signal)).rejects.toThrow(
			'{"error":{}}',
		);
	});

	test("an empty body names the status", async () => {
		reject(503, "");
		await expect(call(new AbortController().signal)).rejects.toThrow(
			"OpenRouter returned 503",
		);
	});
});

describe("a stream with a null frame", () => {
	test("skips `data: null` and keeps both good frames", async () => {
		const finish = JSON.stringify({
			choices: [{ delta: {}, finish_reason: "stop" }],
		});
		const frames = [delta("Hello, "), "null", delta("world"), finish, "[DONE]"];
		// SAFETY: as above — a stub that answers one shape.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(frames.map((frame) => `data: ${frame}\n\n`).join(""), {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			})) as typeof globalThis.fetch;

		const turn = await call(new AbortController().signal);
		expect(turn.content).toBe("Hello, world");
		expect(turn.finishReason).toBe("stop");
	});
});
