import { afterEach, describe, expect, test } from "bun:test";
import http2 from "node:http2";

import { z } from "zod";

import { createHttp2Transport, type Http2Timing } from "./http2";

const timing: Http2Timing = {
	requestTimeoutMs: 200,
	pingIntervalMs: 60_000,
	pingTimeoutMs: 1_000,
	idleTimeoutMs: 60_000,
};

let server: http2.Http2Server | null = null;

afterEach(() => {
	server?.close();
	server = null;
});

/** A plain-text HTTP/2 server. `/hang` never answers; any other path is a
 *  200. Counts the sessions that clients open. */
const startServer = async () => {
	const counts = { sessions: 0 };
	const created = http2.createServer();
	created.on("session", () => {
		counts.sessions += 1;
	});
	created.on("stream", (stream, headers) => {
		if (headers[":path"] === "/hang") return;
		stream.respond({ ":status": 200 });
		stream.end("ok");
	});
	await new Promise<void>((resolve) => created.listen(0, resolve));
	server = created;
	const port = z.object({ port: z.number() }).parse(created.address()).port;
	return { origin: `http://localhost:${port}`, counts };
};

const call = (
	transport: ReturnType<typeof createHttp2Transport>,
	origin: string,
	path: string,
) => transport({ origin, path, headers: {}, body: "{}" });

describe("createHttp2Transport", () => {
	test("pushes share one session", async () => {
		const { origin, counts } = await startServer();
		const transport = createHttp2Transport(timing);
		expect((await call(transport, origin, "/a")).status).toBe(200);
		expect((await call(transport, origin, "/b")).status).toBe(200);
		expect(counts.sessions).toBe(1);
	});

	test("a request that times out drops its session; the next push opens a new one", async () => {
		const { origin, counts } = await startServer();
		const transport = createHttp2Transport(timing);
		expect((await call(transport, origin, "/a")).status).toBe(200);
		await expect(call(transport, origin, "/hang")).rejects.toThrow(
			"The HTTP/2 request timed out.",
		);
		expect((await call(transport, origin, "/b")).status).toBe(200);
		expect(counts.sessions).toBe(2);
	});
});
