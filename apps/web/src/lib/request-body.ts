/**
 * A request body read with a ceiling, for a route that must refuse a large
 * body before a library reads all of it.
 *
 * The MCP SDK's transport calls `request.json()` with no limit, so the route
 * checks here first. Two steps, because a body may come with or without a
 * `Content-Length`:
 *
 *  - `declaresBodyOver` reads the header alone. It costs nothing, so it can run
 *    before the credential is resolved.
 *  - `readBodyUpTo` reads the stream and stops as soon as it passes the limit,
 *    which is the only answer for a chunked body (no `Content-Length`) and for
 *    a header that lied.
 *
 * The production host's global `maxRequestBodySize` (`server.ts`) is the
 * backstop behind both.
 */

/** Whether the request's `Content-Length` says the body is over `maxBytes`. A
 *  missing or unreadable header says nothing, and `readBodyUpTo` decides. */
export const declaresBodyOver = (
	request: Request,
	maxBytes: number,
): boolean => {
	const declared = request.headers.get("content-length");
	if (declared === null || !/^\d+$/.test(declared.trim())) return false;
	return Number(declared.trim()) > maxBytes;
};

export type BoundedBody =
	| { ok: true; bytes: Uint8Array<ArrayBuffer> }
	| { ok: false };

/** The whole body, or `{ ok: false }` once it passes `maxBytes`. The stream
 *  is cancelled at that point, so the rest is never buffered. */
export const readBodyUpTo = async (
	request: Request,
	maxBytes: number,
): Promise<BoundedBody> => {
	if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return { ok: false };
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, bytes };
};
