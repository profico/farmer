/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	type AssistantEvent,
	type AssistantRun,
	eventChange,
	parseFrame,
	readEvents,
} from "./assistant-runs.tsx";

const BASE: AssistantRun = {
	streamingText: "",
	sentMessage: null,
	sentMessageId: null,
	traces: [],
	pending: null,
	error: null,
	isStreaming: true,
};

function apply(event: AssistantEvent, state = BASE): AssistantRun | null {
	const change = eventChange(event);
	return change ? change(state) : null;
}

describe("parseFrame", () => {
	test("reads a data line", () => {
		expect(parseFrame('data: {"type":"done"}')).toEqual({ type: "done" });
	});
	test("skips a line that is not a data line", () => {
		expect(parseFrame(": ping")).toBeNull();
	});
	test("skips a data line with bad JSON", () => {
		expect(parseFrame("data: {oops")).toBeNull();
	});
});

describe("eventChange", () => {
	test("appends a text delta", () => {
		const state = { ...BASE, streamingText: "Hi" };
		expect(apply({ type: "delta", text: " there" }, state)?.streamingText).toBe(
			"Hi there",
		);
	});
	test("records the receipt", () => {
		expect(
			apply({ type: "message", messageId: "m1", role: "user" })?.sentMessageId,
		).toBe("m1");
	});
	test("opens and closes a tool trace", () => {
		const started = apply({
			type: "tool_start",
			toolCallId: "t1",
			name: "list",
			arguments: "{}",
		});
		expect(started?.traces[0]?.ok).toBeNull();
		const ended = apply(
			{ type: "tool_result", toolCallId: "t1", name: "list", ok: true },
			started ?? BASE,
		);
		expect(ended?.traces[0]?.ok).toBe(true);
	});
	test("sets the error", () => {
		expect(apply({ type: "error", message: "bad" })?.error).toBe("bad");
	});
	test("gives no change for an event the store ignores", () => {
		expect(eventChange({ type: "done" })).toBeNull();
	});
});

describe("readEvents", () => {
	test("joins a frame split across two reads", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('data: {"type":"del'));
				controller.enqueue(
					encoder.encode('ta","text":"a"}\n\ndata: {"type":"done"}\n\n'),
				);
				controller.close();
			},
		});
		const seen: AssistantEvent[] = [];
		await readEvents(stream, (event) => seen.push(event));
		expect(seen).toEqual([{ type: "delta", text: "a" }, { type: "done" }]);
	});
});
