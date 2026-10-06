import http2 from "node:http2";

/**
 * APNs speaks HTTP/2 only. Bun's `fetch` speaks HTTP/1.1 to it and fails with
 * `Malformed_HTTP_Response`, so the relay uses `node:http2`, which Bun
 * supports. One session for each origin stays open for the next push, as
 * Apple asks; a session that closes, fails or gets a GOAWAY is dropped, and
 * the next push opens a new one.
 *
 * A connection can die without a close (a NAT drops it, a peer goes away).
 * Such a session must not hold the pushes after it, so:
 *
 *  - a request that times out destroys its session, and the next push opens
 *    a new one;
 *  - a PING goes out at an interval, and a PING with no answer in time
 *    destroys the session;
 *  - a session with no activity for the idle time closes.
 */

export type Http2Request = {
	origin: string;
	path: string;
	headers: Record<string, string>;
	body: string;
};

export type Http2Response = { status: number; body: string };

export type Http2Transport = (request: Http2Request) => Promise<Http2Response>;

export type Http2Timing = {
	/** A request with no answer in this time fails, and its session goes. */
	requestTimeoutMs: number;
	/** The interval of the PING on an open session. */
	pingIntervalMs: number;
	/** A PING with no answer in this time destroys the session. */
	pingTimeoutMs: number;
	/** A session with no activity for this time closes. */
	idleTimeoutMs: number;
};

export const DEFAULT_HTTP2_TIMING: Http2Timing = {
	requestTimeoutMs: 10_000,
	pingIntervalMs: 60_000,
	pingTimeoutMs: 10_000,
	idleTimeoutMs: 10 * 60_000,
};

export const createHttp2Transport = (
	timing: Http2Timing = DEFAULT_HTTP2_TIMING,
): Http2Transport => {
	const sessions = new Map<string, http2.ClientHttp2Session>();

	const sessionFor = (origin: string): http2.ClientHttp2Session => {
		const existing = sessions.get(origin);
		if (existing && !existing.closed && !existing.destroyed) return existing;
		const session = http2.connect(origin);
		let pingTimer: ReturnType<typeof setInterval> | null = null;
		const forget = () => {
			if (sessions.get(origin) === session) sessions.delete(origin);
			if (pingTimer) clearInterval(pingTimer);
			pingTimer = null;
		};
		const kill = () => {
			forget();
			if (!session.destroyed) session.destroy();
		};
		session.on("error", forget);
		session.on("goaway", forget);
		session.on("close", forget);
		session.setTimeout(timing.idleTimeoutMs, () => {
			forget();
			session.close();
		});
		pingTimer = setInterval(() => {
			if (session.closed || session.destroyed) return forget();
			const deadline = setTimeout(kill, timing.pingTimeoutMs);
			deadline.unref();
			const sent = session.ping((error) => {
				clearTimeout(deadline);
				if (error) kill();
			});
			if (!sent) {
				clearTimeout(deadline);
				kill();
			}
		}, timing.pingIntervalMs);
		pingTimer.unref();
		// An idle session must not keep the process alive at shutdown.
		session.unref();
		sessions.set(origin, session);
		return session;
	};

	/** Destroy a session that a request found dead, and drop it from the map,
	 *  so the next push opens a new one. */
	const discard = (origin: string, session: http2.ClientHttp2Session) => {
		if (sessions.get(origin) === session) sessions.delete(origin);
		if (!session.destroyed) session.destroy();
	};

	return (request) =>
		new Promise<Http2Response>((resolve, reject) => {
			const session = sessionFor(request.origin);
			const stream = session.request({
				":method": "POST",
				":path": request.path,
				"content-type": "application/json",
				...request.headers,
			});
			stream.setTimeout(timing.requestTimeoutMs, () => {
				stream.close(http2.constants.NGHTTP2_CANCEL);
				// A request with no answer most likely means a dead connection.
				// The next push must not wait on it too.
				discard(request.origin, session);
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
