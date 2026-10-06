import { describe, expect, test } from "bun:test";

import { MAX_BODY_BYTES, readBody } from "./request-body";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
	new Request("http://localhost/api/v1/x", { method: "POST", body, headers });

/** A body with no `Content-Length`: a stream of `chunks` parts of `size`. */
const streamed = (chunks: number, size: number) => {
	let sent = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent === chunks) return controller.close();
			sent += 1;
			controller.enqueue(new Uint8Array(size).fill(0x20));
		},
	});
	return {
		request: new Request("http://localhost/api/v1/x", {
			method: "POST",
			body: stream,
		}),
		sent: () => sent,
	};
};

describe("readBody", () => {
	test("reads JSON, an empty body and a body that is not JSON", async () => {
		expect(await readBody(post('{"a":1}'))).toEqual({
			kind: "json",
			value: { a: 1 },
		});
		expect(await readBody(post(""))).toEqual({ kind: "json", value: {} });
		expect(await readBody(post("{nope"))).toEqual({ kind: "invalid" });
	});

	test("an upload of 1 MB in base64 fits", async () => {
		const data = Buffer.alloc(1024 * 1024, 7).toString("base64");
		const read = await readBody(post(JSON.stringify({ name: "a.png", data })));
		expect(read.kind).toBe("json");
	});

	test("a Content-Length over the limit is refused before a read", async () => {
		const request = post("{}", {
			"content-length": String(MAX_BODY_BYTES + 1),
		});
		expect(await readBody(request)).toEqual({ kind: "too_large" });
	});

	test("a stream with no length stops at the limit", async () => {
		const chunk = 64 * 1024;
		const { request, sent } = streamed(1000, chunk);
		expect(await readBody(request, 4 * chunk)).toEqual({ kind: "too_large" });
		// The read stopped near the limit, not at the end of the stream.
		expect(sent()).toBeLessThan(10);
	});
});
