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

import { at } from "../test/harness";
import {
	ABORTED,
	OpenRouterError,
	OpenRouterNetworkError,
	OpenRouterStreamCutError,
	retryableBeforeOutput,
	stallTimeoutFromEnv,
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

	test("an error that is not the abort is a network error with the cause", async () => {
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

		const error = await call(controller.signal).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(OpenRouterNetworkError);
		expect(error).toHaveProperty("cause.message", "connection reset");
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

// ── the no-progress watchdog ─────────────────────────────────────────────────
//
// OpenRouter keeps a stalled call open with `: OPENROUTER PROCESSING` comment
// lines. A call that ran 180 s with no tokens died twice in production, so the
// client aborts a call that makes no progress, and it must not count those
// comments as progress. The limit is a few milliseconds here.

const STALL_MS = 60;
const enc = new TextEncoder();

/** A body that sends each chunk at its offset in milliseconds and then stays
 *  open until the request signal fires, as a stalled upstream does. A step
 *  with `close` ends the body instead. */
const timedStream = (
	steps: { at: number; text?: string; close?: boolean }[],
	signal: AbortSignal | null | undefined,
) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			const timers = steps.map((step) =>
				setTimeout(() => {
					if (step.text) controller.enqueue(enc.encode(step.text));
					if (step.close) controller.close();
				}, step.at),
			);
			signal?.addEventListener("abort", () => {
				for (const timer of timers) clearTimeout(timer);
				controller.error(new DOMException("aborted", "AbortError"));
			});
		},
	});

const frame = (payload: string) => `data: ${payload}\n\n`;
const keepAlive = ": OPENROUTER PROCESSING\n\n";

/** Answers with the given steps, and records the request bodies. */
const serveTimed = (steps: Parameters<typeof timedStream>[0]) => {
	const bodies: string[] = [];
	// SAFETY: a test stub for `fetch`. It reads the request body and signal and
	// answers one shape: a timed event stream.
	globalThis.fetch = (async (
		_input: string | URL | Request,
		init?: RequestInit,
	) => {
		bodies.push(String(init?.body ?? ""));
		return new Response(timedStream(steps, init?.signal), {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		});
	}) as typeof globalThis.fetch;
	return bodies;
};

const watched = (
	over: { tools?: Parameters<typeof streamChatCompletion>[0]["tools"] } = {},
) =>
	streamChatCompletion({
		apiKey: "test-key",
		model: "test/model",
		messages: [{ role: "user", content: "hello" }],
		stallTimeoutMs: STALL_MS,
		...over,
	});

/** The error a call rejects with. Fails the test when it resolves. */
const caught = async (work: Promise<unknown>): Promise<Error> => {
	try {
		await work;
	} catch (error) {
		if (error instanceof Error) return error;
		throw error;
	}
	throw new Error("the call was expected to fail");
};

const reasoning = (text: string) =>
	JSON.stringify({ choices: [{ delta: { reasoning: text } }] });

describe("the no-progress watchdog", () => {
	test("keep-alive comments only abort at the stall limit", async () => {
		serveTimed(
			[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map((offset) => ({
				at: offset,
				text: keepAlive,
			})),
		);
		const startedAt = Date.now();
		const error = await caught(watched());
		expect(error).toBeInstanceOf(OpenRouterStreamCutError);
		expect(error).toMatchObject({
			stalled: true,
			timedOut: false,
			outputStarted: false,
			message: "stream stalled: no progress before the stall limit",
		});
		// It stopped near the limit, not after the last comment.
		expect(Date.now() - startedAt).toBeLessThan(STALL_MS + 60);
		expect(retryableBeforeOutput(error)).toBe("stall");
	});

	test("an empty delta is not progress", async () => {
		serveTimed(
			[0, 20, 40, 60].map((offset) => ({
				at: offset,
				text: frame(JSON.stringify({ choices: [{ delta: { content: "" } }] })),
			})),
		);
		await expect(watched()).rejects.toMatchObject({ stalled: true });
	});

	test("steady reasoning deltas over a longer total are not aborted", async () => {
		const steps = [0, 30, 60, 90, 120, 150].map((offset) => ({
			at: offset,
			text: frame(reasoning("thinking ")),
		}));
		serveTimed([
			...steps,
			{ at: 180, text: frame(delta("Answer")) },
			{ at: 190, text: frame(finish("stop")), close: true },
		]);
		const startedAt = Date.now();
		const turn = await watched();
		// The total is three times the limit; each gap is half of it.
		expect(Date.now() - startedAt).toBeGreaterThan(STALL_MS * 2);
		expect(turn.content).toBe("Answer");
		expect(turn.finishReason).toBe("stop");
		expect(turn.firstProgressMs).toBeLessThan(STALL_MS);
	});

	test("content and then a stall is a stall that is not retryable", async () => {
		serveTimed([{ at: 0, text: frame(delta("Half an answer")) }]);
		const error = await caught(watched());
		expect(error).toBeInstanceOf(OpenRouterStreamCutError);
		expect(error).toMatchObject({
			stalled: true,
			outputStarted: true,
			partial: { content: "Half an answer" },
		});
		expect(retryableBeforeOutput(error)).toBeNull();
	});

	test("a reasoning delta counts as output for the retry rule", async () => {
		serveTimed([{ at: 0, text: frame(reasoning("hmm")) }]);
		const error = await caught(watched());
		expect(error).toMatchObject({ stalled: true, outputStarted: true });
		expect(retryableBeforeOutput(error)).toBeNull();
	});

	test("a stall before the headers is a stall", async () => {
		// SAFETY: a test stub for `fetch` that never answers and fails when the
		// request signal fires.
		globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("aborted", "AbortError"));
				});
			})) as typeof globalThis.fetch;
		await expect(watched()).rejects.toMatchObject({
			name: "OpenRouterStreamCutError",
			stalled: true,
			outputStarted: false,
		});
	});

	test("a Stop is still an abort, not a stall", async () => {
		const controller = new AbortController();
		serveTimed([{ at: 0, text: frame(delta("Half")) }]);
		setTimeout(() => {
			controller.abort();
		}, 10);
		const turn = await streamChatCompletion({
			apiKey: "test-key",
			model: "test/model",
			messages: [{ role: "user", content: "hello" }],
			signal: controller.signal,
			stallTimeoutMs: 1000,
		});
		expect(turn.finishReason).toBe(ABORTED);
	});

	test("the served model, the provider and the first progress are read", async () => {
		serveTimed([
			{ at: 0, text: keepAlive },
			{
				at: 20,
				text: frame(
					JSON.stringify({
						model: "z-ai/glm-5.3-flash-20261001",
						provider: "Z.AI",
						choices: [{ delta: { content: "Hi" } }],
					}),
				),
			},
			{ at: 25, text: frame(finish("stop")), close: true },
		]);
		const turn = await watched();
		expect(turn.servedModel).toBe("z-ai/glm-5.3-flash-20261001");
		expect(turn.provider).toBe("Z.AI");
		// The comment at 0 ms does not count: the first progress is the delta.
		expect(turn.firstProgressMs).toBeGreaterThanOrEqual(15);
	});

	test("tools are sent with require_parameters, and no tools are not", async () => {
		const withTools = serveTimed([
			{ at: 0, text: frame(finish("stop")), close: true },
		]);
		await watched({
			tools: [
				{
					type: "function",
					function: { name: "t", description: "d", parameters: {} },
				},
			],
		});
		expect(JSON.parse(at(withTools, 0)).provider).toEqual({
			require_parameters: true,
		});
		const without = serveTimed([
			{ at: 0, text: frame(finish("stop")), close: true },
		]);
		await watched();
		expect(JSON.parse(at(without, 0)).provider).toBeUndefined();
	});
});

describe("which failures may be retried", () => {
	test("a TLS fault before the headers is a network error", async () => {
		// SAFETY: a test stub for `fetch` that fails as a TLS fault does.
		globalThis.fetch = (async (
			_input: string | URL | Request,
		): Promise<Response> => {
			throw new TypeError("unknown certificate verification error");
		}) as typeof globalThis.fetch;
		const error = await caught(watched());
		expect(error).toBeInstanceOf(OpenRouterNetworkError);
		expect(error).toBeInstanceOf(OpenRouterError);
		expect(error.cause).toBeInstanceOf(TypeError);
		expect(retryableBeforeOutput(error)).toBe("network");
	});

	test("an HTTP status before streaming", () => {
		const retryable = (status: number) =>
			retryableBeforeOutput(new OpenRouterError("x", status));
		expect(retryable(503)).toBe("http_503");
		expect(retryable(429)).toBe("http_429");
		expect(retryable(408)).toBe("http_408");
		expect(retryable(401)).toBeNull();
		expect(retryable(402)).toBeNull();
		expect(retryable(400)).toBeNull();
		expect(retryableBeforeOutput(new OpenRouterError("no status"))).toBeNull();
	});

	test("an error frame before any output", () => {
		const emptyTurn = {
			content: "",
			toolCalls: [],
			promptTokens: null,
			completionTokens: null,
			costUsd: null,
			finishReason: "error",
		};
		const frameError = (code: string | number, turn = emptyTurn) =>
			retryableBeforeOutput(
				new OpenRouterStreamCutError(turn, { code, message: "m" }),
			);
		expect(frameError(502)).toBe("upstream_error");
		expect(frameError("server_error")).toBe("upstream_error");
		expect(frameError(429)).toBe("upstream_error");
		expect(frameError(402)).toBeNull();
		expect(frameError(502, { ...emptyTurn, content: "Half" })).toBeNull();
	});

	test("the total deadline is not retried", () => {
		const emptyTurn = {
			content: "",
			toolCalls: [],
			promptTokens: null,
			completionTokens: null,
			costUsd: null,
			finishReason: null,
		};
		expect(
			retryableBeforeOutput(
				new OpenRouterStreamCutError(emptyTurn, null, true, true),
			),
		).toBeNull();
	});

	test("an HTTP 503 before streaming keeps its status", async () => {
		// SAFETY: a test stub for `fetch` that answers one rejection.
		globalThis.fetch = (async (_input: string | URL | Request) =>
			new Response(JSON.stringify({ error: { message: "overloaded" } }), {
				status: 503,
			})) as typeof globalThis.fetch;
		await expect(watched()).rejects.toMatchObject({
			status: 503,
			message: "overloaded",
		});
	});
});

/** A body that sends the given frames, then fails the way a reset socket does. */
const resetBody = (frames: string[], fault: Error) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const text of frames) controller.enqueue(encoder.encode(text));
		},
		pull(controller) {
			controller.error(fault);
		},
	});

const serveReset = (frames: string[], fault: Error) => {
	// SAFETY: a test stub for `fetch` that answers one streamed body.
	globalThis.fetch = (async (_input: string | URL | Request) =>
		new Response(resetBody(frames, fault), {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		})) as typeof globalThis.fetch;
};

describe("a body-read fault in the middle of a stream", () => {
	test("with no output it is the retryable network error", async () => {
		const fault = new TypeError("terminated");
		serveReset([keepAlive], fault);
		const error = await caught(watched());
		expect(error).toBeInstanceOf(OpenRouterNetworkError);
		expect(error.cause).toBe(fault);
		expect(retryableBeforeOutput(error)).toBe("network");
	});

	test("after a content delta it is a cut that is not retried", async () => {
		const fault = new Error("socket closed");
		serveReset([frame(delta("Half"))], fault);
		const error = await caught(watched());
		expect(error).toBeInstanceOf(OpenRouterStreamCutError);
		expect(error).toMatchObject({ outputStarted: true, timedOut: false });
		expect(error.message).not.toContain("socket closed");
		expect(error.cause).toBe(fault);
		expect(retryableBeforeOutput(error)).toBeNull();
		if (error instanceof OpenRouterStreamCutError)
			expect(error.partial.content).toBe("Half");
	});

	test("after a reasoning delta it is a cut that is not retried", async () => {
		serveReset([frame(reasoning("thinking"))], new Error("reset"));
		const error = await caught(watched());
		expect(error).toBeInstanceOf(OpenRouterStreamCutError);
		expect(retryableBeforeOutput(error)).toBeNull();
	});

	test("after a finish reason the answer is whole and is returned", async () => {
		serveReset(
			[frame(delta("Done")), frame(finish("stop"))],
			new Error("reset"),
		);
		const turn = await watched();
		expect(turn.content).toBe("Done");
		expect(turn.finishReason).toBe("stop");
	});

	test("a throw in onDelta is not a network error", async () => {
		serveReset([frame(delta("Hi"))], new Error("reset"));
		const bug = new RangeError("caller bug");
		const error = await caught(
			streamChatCompletion({
				apiKey: "test-key",
				model: "test/model",
				messages: [{ role: "user", content: "hello" }],
				stallTimeoutMs: STALL_MS,
				onDelta: () => {
					throw bug;
				},
			}),
		);
		expect(error).toBe(bug);
	});
});

describe("the stall limit from the environment", () => {
	test("unset, empty or invalid gives the default", () => {
		expect(stallTimeoutFromEnv(undefined)).toBe(60_000);
		expect(stallTimeoutFromEnv("")).toBe(60_000);
		expect(stallTimeoutFromEnv("  ")).toBe(60_000);
		expect(stallTimeoutFromEnv("abc")).toBe(60_000);
	});

	test("an explicit number is used, and 0 stays 0", () => {
		expect(stallTimeoutFromEnv("90000")).toBe(90_000);
		expect(stallTimeoutFromEnv("0")).toBe(0);
	});
});
