import http2 from "node:http2";

/**
 * APNs speaks HTTP/2 only. Bun's `fetch` speaks HTTP/1.1 to it and fails with
 * `Malformed_HTTP_Response`, so the relay uses `node:http2`, which Bun
 * supports. One session for each origin stays open for the next push, as
 * Apple asks; a session that closes, fails or gets a GOAWAY is dropped, and
 * the next push opens a new one.
 */

export type Http2Request = {
	origin: string;
	path: string;
	headers: Record<string, string>;
	body: string;
};

export type Http2Response = { status: number; body: string };

export type Http2Transport = (request: Http2Request) => Promise<Http2Response>;

const REQUEST_TIMEOUT_MS = 10_000;

export const createHttp2Transport = (): Http2Transport => {
	const sessions = new Map<string, http2.ClientHttp2Session>();

	const sessionFor = (origin: string): http2.ClientHttp2Session => {
		const existing = sessions.get(origin);
		if (existing && !existing.closed && !existing.destroyed) return existing;
		const session = http2.connect(origin);
		const forget = () => {
			if (sessions.get(origin) === session) sessions.delete(origin);
		};
		session.on("error", forget);
		session.on("goaway", forget);
		session.on("close", forget);
		// An idle session must not keep the process alive at shutdown.
		session.unref();
		sessions.set(origin, session);
		return session;
	};

	return (request) =>
		new Promise<Http2Response>((resolve, reject) => {
			const stream = sessionFor(request.origin).request({
				":method": "POST",
				":path": request.path,
				"content-type": "application/json",
				...request.headers,
			});
			stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
				stream.close(http2.constants.NGHTTP2_CANCEL);
				reject(new Error("The HTTP/2 request timed out."));
			});
			let status = 0;
			const chunks: Buffer[] = [];
			stream.on("response", (headers) => {
				status = Number(headers[":status"] ?? 0);
			});
			stream.on("data", (chunk: Buffer) => chunks.push(chunk));
			stream.on("end", () =>
				resolve({ status, body: Buffer.concat(chunks).toString("utf8") }),
			);
			stream.on("error", reject);
			stream.end(request.body);
		});
};
