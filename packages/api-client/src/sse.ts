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

/**
 * The events of one assistant turn, in order, until `done` or `error`. With
 * a fetch that streams (`expo/fetch`), each event arrives as the server
 * writes it. Without one, the body is read as a whole, and the events arrive
 * together at the end.
 */
export async function* readAssistantEvents(
	response: FetchResponse,
): AsyncGenerator<AssistantEvent, void, undefined> {
	const decoder = new SseDecoder();
	const body = response.body;
	if (!body) {
		const text = await response.text();
		for (const data of [...decoder.push(text), ...decoder.end()]) {
			const event = parseAssistantEvent(data);
			if (!event) continue;
			yield event;
			if (isLast(event)) return;
		}
		yield CUT_OFF;
		return;
	}

	const reader = body.getReader();
	const text = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			const payloads = done
				? [...decoder.push(text.decode()), ...decoder.end()]
				: decoder.push(text.decode(value, { stream: true }));
			for (const data of payloads) {
				const event = parseAssistantEvent(data);
				if (!event) continue;
				yield event;
				if (isLast(event)) return;
			}
			if (done) break;
		}
	} finally {
		// Also runs when the caller stops early: it frees the connection.
		reader.releaseLock();
		await body.cancel().catch(() => undefined);
	}
	yield CUT_OFF;
}
