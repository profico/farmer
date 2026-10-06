import type { JsonValue } from "@farmer/core/lib/json";

/**
 * The largest request body that `/api/v1` reads. The largest legitimate body
 * is an upload: base64 of `MAX_UPLOAD_BYTES` (1 MB) is about 1.4 MB, and the
 * JSON around it adds a little. A larger body is refused before it is read
 * in full, so a client cannot make the server hold a body of any size.
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type BodyRead =
	| { kind: "json"; value: JsonValue }
	| { kind: "invalid" }
	| { kind: "too_large" };

/** The body as text, or null when it is over `limit` bytes. A
 *  `Content-Length` over the limit is refused at once. Else the stream is
 *  read in parts and cancelled as soon as the count goes over the limit,
 *  because a client can send no length, or a wrong one. */
const readLimitedText = async (
	request: Request,
	limit: number,
): Promise<string | null> => {
	const declared = Number(request.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > limit) return null;
	if (!request.body) return "";
	const reader = request.body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		parts.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return new TextDecoder().decode(bytes);
};

/** The JSON body of a request that is not a GET: `{}` when it is empty,
 *  `invalid` when it does not parse, and `too_large` over `limit`. */
export const readBody = async (
	request: Request,
	limit: number = MAX_BODY_BYTES,
): Promise<BodyRead> => {
	if (request.method === "GET") return { kind: "json", value: {} };
	const text = await readLimitedText(request, limit);
	if (text === null) return { kind: "too_large" };
	if (!text.trim()) return { kind: "json", value: {} };
	try {
		const value: JsonValue = JSON.parse(text);
		return { kind: "json", value };
	} catch {
		return { kind: "invalid" };
	}
};
