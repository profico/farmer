import type { z } from "zod";

/** The largest request body the relay reads, in bytes. */
export const MAX_BODY_BYTES = 8 * 1024;

export type BodyResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: "too_large" | "invalid_json" | "invalid_body" };

/**
 * Read a request body of at most `maxBytes`, without trust in the
 * `Content-Length` header. A chunked body has no length, so the reader counts
 * the bytes and stops at the limit.
 */
const readCapped = async (
	request: Request,
	maxBytes: number,
): Promise<string | null> => {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > maxBytes) return null;
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
};

export const readJsonBody = async <T>(
	request: Request,
	schema: z.ZodType<T>,
	maxBytes: number = MAX_BODY_BYTES,
): Promise<BodyResult<T>> => {
	const text = await readCapped(request, maxBytes);
	if (text === null) return { ok: false, error: "too_large" };
	try {
		// `safeParse` never throws, so the catch is only for `JSON.parse`.
		const parsed = schema.safeParse(JSON.parse(text));
		return parsed.success
			? { ok: true, value: parsed.data }
			: { ok: false, error: "invalid_body" };
	} catch {
		return { ok: false, error: "invalid_json" };
	}
};
