import { describe, expect, test } from "bun:test";

import { SSE_HEARTBEAT, startHeartbeat } from "./sse-heartbeat";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the SSE heartbeat", () => {
	test("is a comment line, which the client's data: parser skips", () => {
		const text = new TextDecoder().decode(SSE_HEARTBEAT);
		expect(text.startsWith(":")).toBe(true);
		expect(text.endsWith("\n\n")).toBe(true);
		expect(text.split("\n").some((line) => line.startsWith("data:"))).toBe(
			false,
		);
	});

	test("beats while it runs and stops when it is stopped", async () => {
		let beats = 0;
		const stop = startHeartbeat(() => {
			beats += 1;
		}, 5);
		await wait(60);
		stop();
		const atStop = beats;
		expect(atStop).toBeGreaterThan(0);
		await wait(60);
		expect(beats).toBe(atStop);
	});
});
