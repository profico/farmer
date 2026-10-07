// OpenRouter, spoken directly.
//
// Hand-rolled over `externalFetch` for the same reason `slack-client.ts` and
// `github-client.ts` are: the surface this app needs is one POST and one GET,
// and an SDK would bring a model registry, a provider abstraction and a
// streaming runtime to carry them. OpenRouter is OpenAI-compatible, so what
// follows is the chat-completions wire format and nothing else.

import { z } from "zod";

import { externalFetch } from "./http";
import type { JsonRecord } from "./json";

const BASE = "https://openrouter.ai/api/v1";

/** Long enough for a model to think and then stream a full answer.
 *
 *  `EXTERNAL_FETCH_TIMEOUT_MS` (15s) is the wrong bound here and dangerously
 *  close to plausible: `externalFetch`'s deadline is an `AbortSignal.timeout`
 *  on the whole request, and a streaming response is not "complete" until the
 *  last token lands. At 15s it does not fail to connect — it guillotines a
 *  working answer mid-sentence, which reads as the model trailing off. */
export const OPENROUTER_STREAM_TIMEOUT_MS = Number(
	process.env.OPENROUTER_STREAM_TIMEOUT_MS ?? 180_000,
);

/** Short: this one really is just a page fetch. */
const MODELS_TIMEOUT_MS = 15_000;

export type ChatMessage =
	| { role: "system" | "user"; content: string }
	| {
			role: "assistant";
			content: string;
			tool_calls?: {
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}[];
	  }
	| { role: "tool"; content: string; tool_call_id: string };

export type ChatTool = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: JsonRecord;
	};
};

/** What a streamed turn produced, once the stream has ended. */
/** `finishReason` on a turn the caller stopped part-way.
 *
 *  Not one of OpenRouter's own reasons — it never gets to send one — so it is
 *  named here and exported, because the loop must be able to tell "the model
 *  stopped" from "the person did". */
export const ABORTED = "aborted";

export type ChatTurn = {
	content: string;
	toolCalls: { id: string; name: string; arguments: string }[];
	promptTokens: number | null;
	completionTokens: number | null;
	/** What OpenRouter charged for the call, in USD, from the same usage row as
	 *  the token counts. Null when it did not send one — a model with no price,
	 *  or a stream that ended before the final chunk. Reported rather than
	 *  computed here, because a price table in this file would go stale
	 *  silently and quote the wrong figure with total confidence. */
	costUsd: number | null;
	/** OpenRouter's own stop reason, passed through for logging. */
	finishReason: string | null;
};

export class OpenRouterError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "OpenRouterError";
	}
}

/** What OpenRouter says in the `error` object of a mid-stream error frame. */
export type UpstreamError = { code: string | number | null; message: string };

/** The `error` object of an SSE frame. Both fields are optional on the wire. */
const upstreamErrorSchema = z.object({
	code: z.union([z.string(), z.number()]).optional(),
	message: z.string().optional(),
});

/** A call that failed to finish an answer.
 *
 *  Four causes reach this class:
 *  - OpenRouter sent an error frame after the 200: a top-level
 *    `error: { code, message }` and `finish_reason: "error"`. The reason is
 *    in `upstream`.
 *  - The connection closed with no error and no `finish_reason`. The answer
 *    is cut at an unknown point and `upstream` is null.
 *  - The app's own deadline fired mid-body. `timedOut` is true.
 *  - The deadline fired before the response headers. `timedOut` is true and
 *    `partial` is empty.
 *
 *  It is not a model that chose to stop and not a person who pressed Stop.
 *
 *  `partial` is what arrived before the failure, with its tokens and cost,
 *  which the organization paid for. The message is for the log and for
 *  telemetry, and `generate` writes it to the log. It can carry the
 *  provider's own text, so it is not for the person: the loop words that
 *  itself. */
export class OpenRouterStreamCutError extends OpenRouterError {
	constructor(
		readonly partial: ChatTurn,
		readonly upstream: UpstreamError | null = null,
		/** Set when the app's own deadline cut the stream, not the provider. */
		readonly timedOut = false,
		/** Set with `timedOut` when no response headers had arrived. */
		beforeHeaders = false,
	) {
		super(
			upstream
				? `stream failed upstream (${upstream.code ?? "no code"}): ${upstream.message}`
				: timedOut
					? beforeHeaders
						? "request timed out before the response headers"
						: "stream timed out before a finish reason"
					: "stream ended without a finish reason",
		);
		this.name = "OpenRouterStreamCutError";
	}
}

const headers = (apiKey: string) => ({
	Authorization: `Bearer ${apiKey}`,
	"Content-Type": "application/json",
	// OpenRouter attributes usage to these on its dashboards. Both optional;
	// neither is a credential.
	"HTTP-Referer": process.env.OPENROUTER_APP_URL ?? "https://farmer.app",
	"X-Title": process.env.OPENROUTER_APP_TITLE ?? "Farmer",
});

export type OpenRouterModel = {
	id: string;
	name: string;
	contextLength: number | null;
	/** USD per million prompt tokens, or null when OpenRouter doesn't say. */
	promptPrice: number | null;
	supportsTools: boolean;
};

/**
 * The catalogue, for the model picker.
 *
 * Filtered to models that advertise tool support — every conversation here can
 * call tools, and a model that silently ignores them looks like an assistant
 * that has forgotten how to read your timesheet.
 */
export const listModels = async (
	apiKey: string,
): Promise<OpenRouterModel[]> => {
	const response = await externalFetch(
		`${BASE}/models`,
		{ headers: headers(apiKey) },
		MODELS_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new OpenRouterError(
			`OpenRouter returned ${response.status} listing models`,
			response.status,
		);
	}
	// SAFETY: guarded by the non-2xx throw above. Every field below the top level
	// is optional because OpenRouter's model list is a moving catalogue — a model
	// missing its pricing is filtered out rather than read.
	const body = (await response.json()) as {
		data?: {
			id: string;
			name?: string;
			context_length?: number;
			pricing?: { prompt?: string };
			supported_parameters?: string[];
		}[];
	};
	return (body.data ?? [])
		.map((m) => ({
			id: m.id,
			name: m.name ?? m.id,
			contextLength: m.context_length ?? null,
			promptPrice: m.pricing?.prompt
				? Number(m.pricing.prompt) * 1_000_000
				: null,
			supportsTools: (m.supported_parameters ?? []).includes("tools"),
		}))
		.filter((m) => m.supportsTools)
		.sort((a, b) => a.name.localeCompare(b.name));
};

/** Cheapest possible call that proves a key works — one token, no tools. */
export const verifyKey = async (apiKey: string): Promise<void> => {
	const response = await externalFetch(
		`${BASE}/key`,
		{ headers: headers(apiKey) },
		MODELS_TIMEOUT_MS,
	);
	if (response.status === 401 || response.status === 403) {
		throw new OpenRouterError("OpenRouter rejected that key", response.status);
	}
	if (!response.ok) {
		throw new OpenRouterError(
			`OpenRouter returned ${response.status}`,
			response.status,
		);
	}
};

/** The turn of a call that produced nothing. */
const emptyTurn = (): ChatTurn => ({
	content: "",
	costUsd: null,
	toolCalls: [],
	promptTokens: null,
	completionTokens: null,
	finishReason: null,
});

/** The deadline can also fire before the headers arrive. That is the same
 *  cut with nothing received, so it takes the same path as a mid-body one.
 *  Any other failure of the request travels unchanged. */
const rethrowAsHeaderTimeout = (
	error: Error,
	signal: AbortSignal | undefined,
): never => {
	if (
		signal?.aborted !== true &&
		error instanceof DOMException &&
		error.name === "TimeoutError"
	) {
		throw new OpenRouterStreamCutError(emptyTurn(), null, true, true);
	}
	throw error;
};

const throwHttpError = async (response: Response): Promise<never> => {
	// The error body is JSON on a well-formed rejection and an HTML error page
	// when something in front of OpenRouter answered instead, so it is read as
	// text and only then hopefully parsed.
	const raw = await response.text().catch(() => "");
	let detail = raw.slice(0, 300);
	try {
		// SAFETY: inside a try whose catch keeps the truncated raw body, and every
		// field is optional — this is a best-effort read of an error body that may
		// have come from a proxy rather than from OpenRouter at all.
		const parsed = JSON.parse(raw) as { error?: { message?: string } };
		if (parsed.error?.message) detail = parsed.error.message;
	} catch {
		// not JSON; the truncated body is the best message available
	}
	throw new OpenRouterError(
		detail || `OpenRouter returned ${response.status}`,
		response.status,
	);
};

type ToolSlot = { id: string; name: string; arguments: string };

type ToolCallDelta = {
	index: number;
	id?: string;
	function?: { name?: string; arguments?: string };
};

type Chunk = {
	/** Parsed below: the wire shape is not trusted. */
	error?: JsonRecord;
	choices?: {
		delta?: {
			content?: string | null;
			tool_calls?: ToolCallDelta[];
		};
		finish_reason?: string | null;
	}[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		/** OpenRouter's own extension to the OpenAI usage row. */
		cost?: number;
	};
};

/** What the read loop has gathered so far. */
type StreamState = {
	content: string;
	slots: Map<number, ToolSlot>;
	promptTokens: number | null;
	completionTokens: number | null;
	costUsd: number | null;
	finishReason: string | null;
	upstream: UpstreamError | null;
};

const newStreamState = (): StreamState => ({
	content: "",
	slots: new Map(),
	promptTokens: null,
	completionTokens: null,
	costUsd: null,
	finishReason: null,
	upstream: null,
});

/** One SSE line to one chunk, or null for a line that carries none. */
const parseDataLine = (line: string): Chunk | null => {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) return null;
	const payload = trimmed.slice(5).trim();
	if (payload === "[DONE]") return null;
	try {
		const chunk: Chunk = JSON.parse(payload);
		return chunk;
	} catch {
		// A frame split across two network reads is the normal case here and
		// is already handled by the `buffer` carry-over in the read loop; anything
		// that still fails to parse is malformed, and dropping one frame is
		// better than ending an otherwise-good answer.
		return null;
	}
};

/** Fold the fragments of the tool calls into their slots, keyed by index. */
const applyToolCallDeltas = (
	slots: Map<number, ToolSlot>,
	calls: ToolCallDelta[],
) => {
	for (const call of calls) {
		const slot = slots.get(call.index) ?? { id: "", name: "", arguments: "" };
		if (call.id) slot.id = call.id;
		if (call.function?.name) slot.name = call.function.name;
		if (call.function?.arguments) slot.arguments += call.function.arguments;
		slots.set(call.index, slot);
	}
};

const upstreamOf = (error: JsonRecord): UpstreamError => {
	const parsed = upstreamErrorSchema.safeParse(error);
	return {
		code: (parsed.success ? parsed.data.code : undefined) ?? null,
		message: (parsed.success ? parsed.data.message : undefined) ?? "no message",
	};
};

const applyChunk = (
	state: StreamState,
	chunk: Chunk,
	onDelta: ((text: string) => void) | undefined,
) => {
	if (chunk.usage) {
		state.promptTokens = chunk.usage.prompt_tokens ?? state.promptTokens;
		state.completionTokens =
			chunk.usage.completion_tokens ?? state.completionTokens;
		state.costUsd = chunk.usage.cost ?? state.costUsd;
	}

	// A failure after the 200 is committed arrives as a top-level `error`
	// object, usually with `finish_reason: "error"` on the same frame.
	if (chunk.error) state.upstream = upstreamOf(chunk.error);

	const choice = chunk.choices?.[0];
	if (!choice) return;
	if (choice.finish_reason) state.finishReason = choice.finish_reason;

	const text = choice.delta?.content;
	if (text) {
		state.content += text;
		onDelta?.(text);
	}
	applyToolCallDeltas(state.slots, choice.delta?.tool_calls ?? []);
};

/** How the read of the body ended, when it did not end by itself. */
type ReadEnd = { aborted: boolean; timedOut: boolean };

/** An abort is not a failure, and what had already arrived is not rubbish.
 *
 *  `reader.read()` rejects the moment the signal fires, and with no catch
 *  here that rejection carried every token of a half-written answer out of
 *  the function with it — so pressing Stop, or navigating away, threw away
 *  work the org had already paid OpenRouter for and left the thread looking
 *  as though the question had never been asked. The partial answer is
 *  returned instead, under a finish reason that says what happened; the
 *  caller decides whether it is worth storing. Any other error is a real
 *  one and still travels: `null` says so, and the caller rethrows it. */
const classifyReadError = (
	error: Error | undefined,
	signal: AbortSignal | undefined,
): ReadEnd | null => {
	// Two shapes reach here: the `AbortError` a fetch body read rejects with,
	// and whatever the runtime throws when a stream is torn down under it. The
	// signal is the reliable half of the answer, so it is asked first.
	// A signal aborted with a plain value rejects with that value, not an Error.
	const aborted = signal?.aborted === true || error?.name === "AbortError";
	// The app's own deadline reaches the body read through `AbortSignal.any`
	// in `externalFetch`. It rejects with a `TimeoutError`, not an
	// `AbortError`, and the caller's signal stays unfired. It is a cut, so
	// the partial turn is kept and reported by the caller.
	const timedOut =
		!aborted && error instanceof DOMException && error.name === "TimeoutError";
	if (!aborted && !timedOut) return null;
	return { aborted, timedOut };
};

const toTurn = (state: StreamState): ChatTurn => ({
	content: state.content,
	costUsd: state.costUsd,
	toolCalls: [...state.slots.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, slot]) => slot)
		.filter((slot) => slot.id && slot.name),
	promptTokens: state.promptTokens,
	completionTokens: state.completionTokens,
	finishReason: state.finishReason,
});

/** A close with the signal fired is a Stop, not a failure. Past that, two
 *  things fail the call. The first is an error frame, or the finish reason
 *  "error" that OpenRouter documents for it: the provider said it gave up.
 *  The second is a stream that ended with no finish reason at all, which is
 *  an upstream that closed the connection on a slow call. Returning either
 *  as a turn made a cut answer, or no answer, look like a success. Even tool
 *  calls that look whole are not trusted: the failure can come before the
 *  last fragment of their arguments. */
const assertFinished = (
	turn: ChatTurn,
	state: StreamState,
	timedOut: boolean,
) => {
	if (turn.finishReason === ABORTED) return;
	if (state.upstream) throw new OpenRouterStreamCutError(turn, state.upstream);
	if (turn.finishReason === "error") {
		throw new OpenRouterStreamCutError(turn, {
			code: null,
			message: 'finish reason "error" with no error object',
		});
	}
	if (turn.finishReason === null)
		throw new OpenRouterStreamCutError(turn, null, timedOut);
};

/**
 * One streamed completion.
 *
 * `onDelta` fires per text fragment so the UI can paint as the answer arrives;
 * tool calls are assembled silently and returned whole, because a half-built
 * argument string is not something any caller can act on.
 *
 * Tool-call deltas are the fiddly part of this format: they arrive fragmented
 * and are correlated by `index`, NOT by id — the id and the function name come
 * on the first fragment for a slot and are absent from every fragment after it,
 * while `arguments` accumulates across all of them. Keying the accumulator on
 * id therefore loses every continuation.
 */
export const streamChatCompletion = async (opts: {
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	tools?: ChatTool[];
	signal?: AbortSignal;
	onDelta?: (text: string) => void;
}): Promise<ChatTurn> => {
	const response = await externalFetch(
		`${BASE}/chat/completions`,
		{
			method: "POST",
			headers: headers(opts.apiKey),
			signal: opts.signal,
			body: JSON.stringify({
				model: opts.model,
				messages: opts.messages,
				tools: opts.tools?.length ? opts.tools : undefined,
				stream: true,
				// Ask for the usage row on the final chunk; without this the stream
				// ends with no token counts at all.
				stream_options: { include_usage: true },
			}),
		},
		OPENROUTER_STREAM_TIMEOUT_MS,
	).catch((error: unknown) => {
		if (error instanceof Error) rethrowAsHeaderTimeout(error, opts.signal);
		throw error;
	});

	if (!response.ok || !response.body) return throwHttpError(response);

	const state = newStreamState();
	let timedOut = false;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// SSE frames are separated by a blank line, but OpenRouter also sends
			// `: OPENROUTER PROCESSING` comment lines as a keep-alive during a cold
			// start, so this splits on newlines and ignores anything that is not a
			// `data:` line rather than assuming frame structure.
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const chunk = parseDataLine(line);
				if (chunk) applyChunk(state, chunk, opts.onDelta);
			}
		}
	} catch (error) {
		const classified = classifyReadError(
			error instanceof Error ? error : undefined,
			opts.signal,
		);
		if (classified === null) throw error;
		timedOut = classified.timedOut;
		if (classified.aborted) state.finishReason = ABORTED;
	} finally {
		// Releasing the lock lets the connection be torn down when the caller
		// aborts mid-answer, which is the common case for a user who navigates away.
		reader.releaseLock();
	}

	// A close with the signal already fired is the caller's doing, however the
	// runtime ended the read. Without this a clean close after a Stop would be
	// reported as the upstream cutting the answer.
	if (
		(state.finishReason === null || state.finishReason === "error") &&
		opts.signal?.aborted
	)
		state.finishReason = ABORTED;

	const turn = toTurn(state);
	assertFinished(turn, state, timedOut);
	return turn;
};
