import { type AssistantEvent, assistantEventSchema } from "./schemas-assistant";
import type { FetchResponse } from "./transport";

/**
 * Splits a Server-Sent Events stream into the `data` of each event. The
 * text arrives in chunks that can end anywhere, also inside a line or
 * between a `\r` and its `\n`, so the decoder keeps the rest of a chunk until
 * the event ends. Only the `data` field is read: the assistant's stream sends
 * no other field, and a comment line (`:`) is a keep-alive.
 */
export class SseDecoder {
	#buffer = "";

	/** Adds a chunk, and gives the `data` of each event it completed. */
	push(chunk: string): string[] {
		this.#buffer += chunk;
		// A `\r` at the end can be the first half of a `\r\n`: keep it until
		// the next chunk tells.
		const held = this.#buffer.endsWith("\r") ? "\r" : "";
		const text = (held ? this.#buffer.slice(0, -1) : this.#buffer).replaceAll(
			/\r\n?/g,
			"\n",
		);
		const frames = text.split("\n\n");
		this.#buffer = (frames.pop() ?? "") + held;
		return frames.flatMap((frame) => this.#dataOf(frame));
	}

	/** The stream closed: an event with no blank line after it still counts. */
	end(): string[] {
		const rest = this.#buffer.replaceAll(/\r\n?/g, "\n");
		this.#buffer = "";
		return this.#dataOf(rest);
	}

	#dataOf(frame: string): string[] {
		const lines = frame
			.split("\n")
			.filter((line) => line === "data" || line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""));
		return lines.length === 0 ? [] : [lines.join("\n")];
	}
}

const parseJson = (text: string): ReturnType<typeof JSON.parse> | null => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

/**
 * One event, or null for an event this app cannot read. A newer server can
 * add an event type; the app skips it rather than end the turn.
 */
export const parseAssistantEvent = (data: string): AssistantEvent | null => {
	const parsed = assistantEventSchema.safeParse(parseJson(data));
	return parsed.success ? parsed.data : null;
};

const isLast = (event: AssistantEvent) =>
	event.type === "done" || event.type === "error";

/** The event when the stream closes before `done` or `error`. */
const CUT_OFF: AssistantEvent = {
	type: "error",
	message:
		"The connection closed before the answer was complete. Open the conversation again to see the rest.",
};

/** The event when no byte arrives for `STREAM_IDLE_TIMEOUT_MS`. */
const STALLED: AssistantEvent = {
	type: "error",
	message:
		"The connection to the server went quiet. Check your connection, then open the conversation again to see the rest.",
};

/**
 * How long a stream may stay without a byte. The server writes a
 * `: heartbeat` comment every 20 seconds (`lib/sse-heartbeat.ts`), so three
 * missed beats mean a dead connection. The comment is not an event, but its
 * bytes reset this timer.
 */
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

const IDLE = Symbol("idle");

/** The next chunk, or `IDLE` when none arrives within `idleMs`. */
const readOrIdle = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	idleMs: number,
) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const idle = new Promise<typeof IDLE>((resolve) => {
		timer = setTimeout(() => resolve(IDLE), idleMs);
	});
	try {
		return await Promise.race([reader.read(), idle]);
	} finally {
		clearTimeout(timer);
	}
};

/** The events in some payloads. Gives true when the last one ended the turn. */
function* eventsIn(
	payloads: string[],
): Generator<AssistantEvent, boolean, undefined> {
	for (const data of payloads) {
		const event = parseAssistantEvent(data);
		if (!event) continue;
		yield event;
		if (isLast(event)) return true;
	}
	return false;
}

/**
 * The events of one assistant turn, in order, until `done` or `error`. With
 * a fetch that streams (`expo/fetch`), each event arrives as the server
 * writes it. Without one, the body is read as a whole, and the events arrive
 * together at the end. A stream with no byte for `idleMs` ends with an error
 * event.
 */
export async function* readAssistantEvents(
	response: FetchResponse,
	idleMs = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<AssistantEvent, void, undefined> {
	const decoder = new SseDecoder();
	const body = response.body;
	if (!body) {
		const text = await response.text();
		if (yield* eventsIn([...decoder.push(text), ...decoder.end()])) return;
		yield CUT_OFF;
		return;
	}

	const reader = body.getReader();
	const text = new TextDecoder();
	try {
		for (;;) {
			const result = await readOrIdle(reader, idleMs);
			if (result === IDLE) {
				yield STALLED;
				return;
			}
			const { done, value } = result;
			const payloads = done
				? [...decoder.push(text.decode()), ...decoder.end()]
				: decoder.push(text.decode(value, { stream: true }));
			if (yield* eventsIn(payloads)) return;
			if (done) break;
		}
	} finally {
		// Also runs when the caller stops early: it frees the connection. Not
		// awaited, because a dead connection can leave the cancel pending.
		void reader.cancel().catch(() => undefined);
	}
	yield CUT_OFF;
}
