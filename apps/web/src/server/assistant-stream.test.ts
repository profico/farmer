import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { assistantService, type Ctx } from "@farmer/core/services";

import { SSE_HEARTBEAT_MS } from "#/lib/sse-heartbeat.ts";

import { streamAssistantTurn, turnStream } from "./assistant-stream.ts";

// The wiring of the heartbeat in the stream of a turn. The turn is a fake:
// it waits for a signal the test controls.

const decoder = new TextDecoder();
const TIMED_OUT = Symbol("timed out");

const request = () => {
	const controller = new AbortController();
	return {
		controller,
		request: new Request("http://localhost/stream", {
			signal: controller.signal,
		}),
	};
};

/** The next chunk as text, `null` at the end of the stream, or `TIMED_OUT`
 *  when nothing arrives within `ms`. */
const nextChunk = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	ms: number,
): Promise<string | null | typeof TIMED_OUT> => {
	const timeout = new Promise<typeof TIMED_OUT>((resolve) =>
		setTimeout(() => resolve(TIMED_OUT), ms),
	);
	const read = reader
		.read()
		.then((chunk) => (chunk.done ? null : decoder.decode(chunk.value)));
	return Promise.race([read, timeout]);
};

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("turnStream heartbeat", () => {
	test("sends a heartbeat comment while the turn is silent", async () => {
		const { request: req, controller } = request();
		const stream = turnStream(
			req,
			() => new Promise<void>(() => undefined),
			() => null,
			5,
		);
		const reader = stream.getReader();
		expect(await nextChunk(reader, 500)).toBe(": heartbeat\n\n");
		expect(await nextChunk(reader, 500)).toBe(": heartbeat\n\n");
		controller.abort();
	});

	test("stops after the client aborts", async () => {
		const { request: req, controller } = request();
		const stream = turnStream(
			req,
			// A turn that ignores the abort and stays silent.
			() => new Promise<void>(() => undefined),
			() => null,
			5,
		);
		const reader = stream.getReader();
		expect(await nextChunk(reader, 500)).toBe(": heartbeat\n\n");

		controller.abort();
		// A beat that was already written may still be queued. Drain it.
		while ((await nextChunk(reader, 30)) !== TIMED_OUT);
		expect(await nextChunk(reader, 60)).toBe(TIMED_OUT);
	});

	test("stops and closes the stream when the turn ends", async () => {
		const set = spyOn(globalThis, "setInterval");
		const clear = spyOn(globalThis, "clearInterval");
		spies.push(set, clear);
		const { request: req } = request();
		let finish: () => void = () => undefined;
		const stream = turnStream(
			req,
			(send) =>
				new Promise<void>((resolve) => {
					finish = () => {
						send({ type: "error", message: "done" });
						resolve();
					};
				}),
			() => null,
			5,
		);
		const reader = stream.getReader();
		expect(await nextChunk(reader, 500)).toBe(": heartbeat\n\n");

		finish();
		const chunks: (string | null | typeof TIMED_OUT)[] = [];
		for (;;) {
			const chunk = await nextChunk(reader, 500);
			chunks.push(chunk);
			if (chunk === null || chunk === TIMED_OUT) break;
		}
		expect(chunks.at(-1)).toBeNull();
		expect(
			chunks.some(
				(chunk) =>
					chunk !== null && chunk !== TIMED_OUT && chunk.includes('"done"'),
			),
		).toBe(true);

		const timer = set.mock.results.at(-1)?.value;
		expect(clear.mock.calls.some(([handle]) => handle === timer)).toBe(true);
	});
});

describe("streamAssistantTurn heartbeat", () => {
	test("starts the heartbeat at the 20 s interval", async () => {
		const set = spyOn(globalThis, "setInterval");
		const run = spyOn(assistantService, "run").mockImplementation(
			() => new Promise<void>(() => undefined),
		);
		spies.push(set, run);
		const { request: req, controller } = request();
		// SAFETY: the stubbed `run` never reads the context, and the route
		// only sets `actor` and reads `userId`.
		const ctx = {
			organizationId: "org-heartbeat-test",
			userId: "user-heartbeat-test",
		} as Ctx;
		// SAFETY: the stubbed `run` never reads the input.
		const input = {} as Parameters<typeof streamAssistantTurn>[1];

		const response = await streamAssistantTurn(ctx, input, req);

		expect(SSE_HEARTBEAT_MS).toBe(20_000);
		expect(set.mock.calls.some(([, ms]) => ms === 20_000)).toBe(true);
		controller.abort();
		await response.body?.cancel();
	});
});
