// The assistant stream: the idle watchdog and the heartbeat comment.

import { describe, expect, test } from "bun:test";

import type { AssistantEvent } from "./schemas-assistant";
import { readAssistantEvents } from "./sse";
import type { FetchResponse } from "./transport";

const encoder = new TextEncoder();

/** A response whose body the test feeds by hand. */
const liveResponse = () => {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		start: (c) => {
			controller = c;
		},
		cancel: () => {
			cancelled = true;
		},
	});
	const response = { body } as unknown as FetchResponse;
	return {
		response,
		send: (text: string) => controller.enqueue(encoder.encode(text)),
		close: () => controller.close(),
		wasCancelled: () => cancelled,
	};
};

const collect = async (
	events: AsyncGenerator<AssistantEvent, void, undefined>,
) => {
	const all: AssistantEvent[] = [];
	for await (const event of events) all.push(event);
	return all;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the idle watchdog", () => {
	test("a silent stream ends with an error event and is cancelled", async () => {
		const live = liveResponse();
		const events = await collect(readAssistantEvents(live.response, 30));
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("error");
		await wait(0);
		expect(live.wasCancelled()).toBe(true);
	});

	test("a heartbeat comment resets the timer and is not an event", async () => {
		const live = liveResponse();
		const run = collect(readAssistantEvents(live.response, 60));
		// Three beats, each inside the limit, together longer than it.
		for (let beat = 0; beat < 3; beat++) {
			await wait(35);
			live.send(": heartbeat\n\n");
		}
		live.send('data: {"type":"done"}\n\n');
		const events = await run;
		expect(events.map((event) => event.type)).toEqual(["done"]);
	});

	test("a stream that goes quiet after a beat is cut", async () => {
		const live = liveResponse();
		const run = collect(readAssistantEvents(live.response, 40));
		live.send(": heartbeat\n\n");
		const events = await run;
		expect(events.map((event) => event.type)).toEqual(["error"]);
	});
});
