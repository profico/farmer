import http2 from "node:http2";

/**
 * APNs speaks HTTP/2 only. Bun's `fetch` speaks HTTP/1.1 to it and fails with
 * `Malformed_HTTP_Response`, so the relay uses `node:http2`, which Bun
 * supports. One session for each origin stays open for the next push, as
 * Apple asks; a session that closes, fails or gets a GOAWAY is dropped, and
 * the next push opens a new one.
 *
 * Under Bun, `stream.setTimeout` and `session.setTimeout` fire at about twice
 * their value. So every deadline here is a plain `setTimeout` or a timestamp.
 *
 * A connection can die without a close (a NAT drops it, a peer goes away).
 * Such a session must not hold the pushes after it, so:
 *
 *  - a request that times out cancels only its own stream. A slow stream
 *    does not prove a dead session, so the session gets a PING, and it
 *    is destroyed only if the PING has no answer in time;
 *  - a PING goes out at an interval, and a PING with no answer in time
 *    destroys the session;
 *  - a session with no request for the idle time closes.
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
	/** A request with no answer in this time fails, and its stream is cancelled. */
	requestTimeoutMs: number;
	/** The interval of the PING on an open session. */
	pingIntervalMs: number;
	/** A PING with no answer in this time destroys the session. */
	pingTimeoutMs: number;
	/** A session with no request for this time closes. The check runs at the
	 *  PING interval. */
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
	const lastUsed = new WeakMap<http2.ClientHttp2Session, number>();

	/** Destroy a session, and drop it from the map. */
	const destroy = (origin: string, session: http2.ClientHttp2Session) => {
		if (sessions.get(origin) === session) sessions.delete(origin);
		if (!session.destroyed) session.destroy();
	};

	/** Send a PING. A session with no answer in time is dead: destroy it. */
	const probe = (origin: string, session: http2.ClientHttp2Session) => {
		// Bun throws on `ping` after a destroy. From a request timer that throw
		// would skip the request's reject.
		if (session.closed || session.destroyed) return;
		const dead = () => destroy(origin, session);
		const deadline = setTimeout(dead, timing.pingTimeoutMs);
		deadline.unref();
		const sent = session.ping((error) => {
			clearTimeout(deadline);
			if (error) dead();
		});
		if (!sent) {
			clearTimeout(deadline);
			dead();
		}
	};

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
		session.on("error", forget);
		session.on("goaway", forget);
		session.on("close", forget);
		pingTimer = setInterval(() => {
			if (session.closed || session.destroyed) return forget();
			const idleMs = Date.now() - (lastUsed.get(session) ?? 0);
			if (idleMs >= timing.idleTimeoutMs) {
				forget();
				return session.close();
			}
			probe(origin, session);
		}, timing.pingIntervalMs);
		pingTimer.unref();
		// An idle session must not keep the process alive at shutdown.
		session.unref();
		lastUsed.set(session, Date.now());
		sessions.set(origin, session);
		return session;
	};

	return (request) =>
		new Promise<Http2Response>((resolve, reject) => {
			const session = sessionFor(request.origin);
			lastUsed.set(session, Date.now());
			const stream = session.request({
				":method": "POST",
				":path": request.path,
				"content-type": "application/json",
				...request.headers,
			});
			const deadline = setTimeout(() => {
				stream.close(http2.constants.NGHTTP2_CANCEL);
				// A slow stream is not a dead session. Ask the session.
				probe(request.origin, session);
				reject(new Error("The HTTP/2 request timed out."));
			}, timing.requestTimeoutMs);
			let status = 0;
			const chunks: Buffer[] = [];
			stream.on("response", (headers) => {
				status = Number(headers[":status"] ?? 0);
			});
			stream.on("data", (chunk: Buffer) => chunks.push(chunk));
			stream.on("end", () => {
				clearTimeout(deadline);
				resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
			});
			stream.on("error", (error) => {
				clearTimeout(deadline);
				reject(error);
			});
			stream.end(request.body);
		});
};
