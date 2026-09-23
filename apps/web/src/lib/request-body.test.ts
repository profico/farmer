/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { declaresBodyOver, readBodyUpTo } from "./request-body.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
	new Request("http://localhost/api/mcp/acme", {
		method: "POST",
		body,
		headers,
	});

/** A body with no Content-Length, as a chunked upload arrives. */
const chunked = (parts: number, size: number) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < parts; i++) controller.enqueue(new Uint8Array(size));
			controller.close();
		},
	});

describe("declaresBodyOver", () => {
	test("reads the Content-Length header", () => {
		expect(
			declaresBodyOver(post("x", { "content-length": "2000" }), 1000),
		).toBe(true);
		expect(
			declaresBodyOver(post("x", { "content-length": "1000" }), 1000),
		).toBe(false);
	});

	test("a missing or unreadable header says nothing", () => {
		expect(declaresBodyOver(new Request("http://localhost/"), 10)).toBe(false);
		expect(
			declaresBodyOver(
				new Request("http://localhost/", {
					headers: { "content-length": "abc" },
				}),
				10,
			),
		).toBe(false);
	});
});

describe("readBodyUpTo", () => {
	test("returns a body within the limit whole", async () => {
		const read = await readBodyUpTo(post('{"jsonrpc":"2.0"}'), 1000);
		expect(read.ok).toBe(true);
		expect(read.ok && new TextDecoder().decode(read.bytes)).toBe(
			'{"jsonrpc":"2.0"}',
		);
	});

	test("refuses a body over the limit", async () => {
		expect((await readBodyUpTo(post("x".repeat(2000)), 1000)).ok).toBe(false);
	});

	test("refuses a chunked body over the limit", async () => {
		expect((await readBodyUpTo(post(chunked(10, 500)), 1000)).ok).toBe(false);
		const small = await readBodyUpTo(post(chunked(2, 400)), 1000);
		expect(small.ok && small.bytes.byteLength).toBe(800);
	});

	test("a request with no body reads as empty", async () => {
		const read = await readBodyUpTo(new Request("http://localhost/"), 10);
		expect(read.ok && read.bytes.byteLength).toBe(0);
	});
});
