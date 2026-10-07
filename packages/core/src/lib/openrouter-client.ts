// OpenRouter, spoken directly.
//
// Hand-rolled over `externalFetch` for the same reason `slack-client.ts` and
// `github-client.ts` are: the surface this app needs is one POST and one GET,
// and an SDK would bring a model registry, a provider abstraction and a
// streaming runtime to carry them. OpenRouter is OpenAI-compatible, so what
// follows is the chat-completions wire format and nothing else.

import { z } from "zod";

import { durationFromEnv, externalFetch } from "./http";
import type { JsonRecord } from "./json";

const BASE = "https://openrouter.ai/api/v1";

/** Long enough for a model to think and then stream a full answer.
 *
 *  `EXTERNAL_FETCH_TIMEOUT_MS` (15s) is the wrong bound here and dangerously
 *  close to plausible: `externalFetch`'s deadline is an `AbortSignal.timeout`
 *  on the whole request, and a streaming response is not "complete" until the
 *  last token lands. At 15s it does not fail to connect — it guillotines a
 *  working answer mid-sentence, which reads as the model trailing off. */
export const OPENROUTER_STREAM_TIMEOUT_MS = durationFromEnv(
	process.env.OPENROUTER_STREAM_TIMEOUT_MS,
	180_000,
);

/** How long a call may go with no progress before it is aborted as a stall.
 *
 *  Progress is a content delta, a reasoning delta, a tool-call delta, a finish
 *  reason or a usage row. An SSE comment line (`: OPENROUTER PROCESSING`) is
 *  not progress: OpenRouter keeps sending it while an upstream is stuck, so
 *  counting it would hide the stall.
 *
 *  The limit is on a GAP with no progress, not on the total. The slowest
 *  successful calls in production took 80.3 s, 54.3 s and 49.8 s in total, and
 *  their output streamed for part of that time. Their time to the first
 *  progress was not recorded, so the 60 s default is a guess, not a
 *  measurement. An explicit 0 turns the watchdog off, and the total deadline
 *  above still applies. An unset, empty, negative or invalid value gives the
 *  default (`durationFromEnv`). */
export const OPENROUTER_STALL_TIMEOUT_MS = durationFromEnv(
	process.env.OPENROUTER_STALL_TIMEOUT_MS,
	60_000,
	"off",
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
	/** The model that served the call, from the response chunks. It can differ
	 *  from the requested id: a `~...-latest` id moves to new versions. */
	servedModel?: string | null;
	/** The upstream provider that served the call, from the response chunks. */
	provider?: string | null;
	/** Milliseconds from the request start to the first progress. Null when
	 *  nothing arrived. */
	firstProgressMs?: number | null;
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

/** The request did not reach OpenRouter, or the connection failed before the
 *  response headers (a refused connection, a TLS fault, a reset). Nothing was
 *  streamed. The original error is in `cause`, for the log. The message is
 *  fixed, so it can reach the person. */
export class OpenRouterNetworkError extends OpenRouterError {
	constructor(cause: Error) {
		super("The connection to OpenRouter failed before an answer started.");
		this.name = "OpenRouterNetworkError";
		this.cause = cause;
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
		detail: { stalled?: boolean; outputStarted?: boolean } = {},
	) {
		super(
			upstream
				? `stream failed upstream (${upstream.code ?? "no code"}): ${upstream.message}`
				: detail.stalled
					? "stream stalled: no progress before the stall limit"
					: timedOut
						? beforeHeaders
							? "request timed out before the response headers"
							: "stream timed out before a finish reason"
						: "stream ended without a finish reason",
		);
		this.name = "OpenRouterStreamCutError";
		this.stalled = detail.stalled ?? false;
		this.outputStarted =
			detail.outputStarted ??
			(partial.content !== "" || partial.toolCalls.length > 0);
	}

	/** Set when the no-progress watchdog fired. It is not the total deadline. */
	readonly stalled: boolean;
	/** True when a content, reasoning or tool-call delta had arrived. A call
	 *  with output is never retried. */
	readonly outputStarted: boolean;
}

/** Why a failed call may be tried once more, or null when it may not.
 *
 *  Only a failure with no output is safe to repeat: a stall, a network fault
 *  before the headers, an HTTP 408 or 5xx, an error frame, or a stream that
 *  closed empty. An HTTP 429 is not retried. The 180 s total deadline is not retried, because it
 *  already cost three minutes. The return value is a short code for the log
 *  and for telemetry. */
export const retryableBeforeOutput = (error: Error): string | null => {
	if (error instanceof OpenRouterStreamCutError) {
		if (error.outputStarted || error.timedOut) return null;
		if (error.stalled) return "stall";
		if (error.upstream) {
			const code = Number(error.upstream.code);
			const clientFault =
				Number.isInteger(code) &&
				code >= 400 &&
				code < 500 &&
				code !== 408 &&
				code !== 429;
			return clientFault ? null : "upstream_error";
		}
		return "empty_stream";
	}
	if (error instanceof OpenRouterNetworkError) return "network";
	if (error instanceof OpenRouterError && error.status !== undefined) {
		const { status } = error;
		// Not 429. An HTTP 429 from OpenRouter is usually the rate limit of the
		// organization's key, and a retry at once hits the same limit and bills
		// nothing but a second refusal. A 429 in an error frame is different: the
		// provider refused after the stream started, and the retry can go to
		// another provider.
		if (status === 408 || status >= 500) return `http_${String(status)}`;
	}
	return null;
};

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
	/** The no-progress limit in milliseconds. Defaults to
	 *  `OPENROUTER_STALL_TIMEOUT_MS`. A test passes a small value. */
	stallTimeoutMs?: number;
}): Promise<ChatTurn> => {
	// The no-progress watchdog. It aborts its own controller, so the caller's
	// signal stays unfired and a stall is told apart from a Stop.
	const stallMs = opts.stallTimeoutMs ?? OPENROUTER_STALL_TIMEOUT_MS;
	const startedAt = Date.now();
	const stallController = new AbortController();
	let stalled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const arm = () => {
		if (timer) clearTimeout(timer);
		if (!(stallMs > 0)) return;
		timer = setTimeout(() => {
			stalled = true;
			stallController.abort();
		}, stallMs);
	};
	const disarm = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
	};
	let outputStarted = false;
	let firstProgressMs: number | null = null;
	let servedModel: string | null = null;
	let provider: string | null = null;
	const progress = (output: boolean) => {
		firstProgressMs ??= Date.now() - startedAt;
		if (output) outputStarted = true;
		arm();
	};
	const emptyTurn = (): ChatTurn => ({
		content: "",
		costUsd: null,
		toolCalls: [],
		promptTokens: null,
		completionTokens: null,
		finishReason: null,
	});
	arm();
	// The deadline can also fire before the headers arrive. That is the same
	// cut with nothing received, so it takes the same path as a mid-body one.
	const response = await externalFetch(
		`${BASE}/chat/completions`,
		{
			method: "POST",
			headers: headers(opts.apiKey),
			signal: opts.signal
				? AbortSignal.any([opts.signal, stallController.signal])
				: stallController.signal,
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
		disarm();
		if (opts.signal?.aborted === true) throw error;
		if (stalled) {
			throw new OpenRouterStreamCutError(emptyTurn(), null, false, false, {
				stalled: true,
				outputStarted: false,
			});
		}
		if (error instanceof DOMException && error.name === "TimeoutError") {
			throw new OpenRouterStreamCutError(emptyTurn(), null, true, true);
		}
		// A refused connection, a TLS fault or a reset, before any header.
		if (error instanceof Error && error.name !== "AbortError")
			throw new OpenRouterNetworkError(error);
		throw error;
	});

	if (!response.ok || !response.body) {
		// The error body is JSON on a well-formed rejection and an HTML error page
		// when something in front of OpenRouter answered instead, so it is read as
		// text and only then hopefully parsed.
		const raw = await response.text().catch(() => "");
		disarm();
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
	}

	let content = "";
	const slots = new Map<
		number,
		{ id: string; name: string; arguments: string }
	>();
	let promptTokens: number | null = null;
	let completionTokens: number | null = null;
	let costUsd: number | null = null;
	let finishReason: string | null = null;
	let timedOut = false;
	let upstream: UpstreamError | null = null;
	// A fault while the body is read (a reset, a closed socket, a TLS error).
	let readError: Error | null = null;
	// Set when the caller's `onDelta` threw. That is a bug in the caller, not a
	// network fault, and it travels unchanged.
	let callbackFailed = false;

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
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const payload = trimmed.slice(5).trim();
				if (payload === "[DONE]") continue;

				let chunk: {
					/** Parsed below: the wire shape is not trusted. */
					error?: JsonRecord;
					model?: string;
					provider?: string;
					choices?: {
						delta?: {
							content?: string | null;
							reasoning?: string | null;
							reasoning_content?: string | null;
							reasoning_details?: JsonRecord[];
							tool_calls?: {
								index: number;
								id?: string;
								function?: { name?: string; arguments?: string };
							}[];
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
				try {
					chunk = JSON.parse(payload);
				} catch {
					// A frame split across two network reads is the normal case here and
					// is already handled by the `buffer` carry-over above; anything that
					// still fails to parse is malformed, and dropping one frame is
					// better than ending an otherwise-good answer.
					continue;
				}

				if (chunk.model) servedModel = chunk.model;
				if (chunk.provider) provider = chunk.provider;

				if (chunk.usage) {
					progress(false);
					promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
					completionTokens = chunk.usage.completion_tokens ?? completionTokens;
					costUsd = chunk.usage.cost ?? costUsd;
				}

				// A failure after the 200 is committed arrives as a top-level `error`
				// object, usually with `finish_reason: "error"` on the same frame.
				if (chunk.error) {
					const parsed = upstreamErrorSchema.safeParse(chunk.error);
					upstream = {
						code: (parsed.success ? parsed.data.code : undefined) ?? null,
						message:
							(parsed.success ? parsed.data.message : undefined) ??
							"no message",
					};
				}

				const choice = chunk.choices?.[0];
				if (!choice) continue;
				if (choice.finish_reason) {
					finishReason = choice.finish_reason;
					progress(false);
				}

				const text = choice.delta?.content;
				if (text) {
					progress(true);
					content += text;
					try {
						opts.onDelta?.(text);
					} catch (callbackError) {
						callbackFailed = true;
						throw callbackError;
					}
				}

				// A thinking model streams reasoning before its answer. It is progress,
				// although nobody reads it.
				if (
					choice.delta?.reasoning ||
					choice.delta?.reasoning_content ||
					choice.delta?.reasoning_details?.length
				)
					progress(true);

				for (const call of choice.delta?.tool_calls ?? []) {
					progress(true);
					const slot = slots.get(call.index) ?? {
						id: "",
						name: "",
						arguments: "",
					};
					if (call.id) slot.id = call.id;
					if (call.function?.name) slot.name = call.function.name;
					if (call.function?.arguments)
						slot.arguments += call.function.arguments;
					slots.set(call.index, slot);
				}
			}
		}
	} catch (error) {
		// An abort is not a failure, and what had already arrived is not rubbish.
		//
		// `reader.read()` rejects the moment the signal fires, and with no catch
		// here that rejection carried every token of a half-written answer out of
		// the function with it — so pressing Stop, or navigating away, threw away
		// work the org had already paid OpenRouter for and left the thread looking
		// as though the question had never been asked. The partial answer is
		// returned instead, under a finish reason that says what happened; the
		// caller decides whether it is worth storing. Any other error is a real
		// one and still travels.
		// Two shapes reach here: the `AbortError` a fetch body read rejects with,
		// and whatever the runtime throws when a stream is torn down under it. The
		// signal is the reliable half of the answer, so it is asked first.
		const aborted =
			opts.signal?.aborted === true ||
			(!stalled && error instanceof Error && error.name === "AbortError");
		// The app's own deadline reaches the body read through `AbortSignal.any`
		// in `externalFetch`. It rejects with a `TimeoutError`, not an
		// `AbortError`, and the caller's signal stays unfired. It is a cut, so
		// the partial turn is kept and reported below.
		timedOut =
			!aborted &&
			error instanceof DOMException &&
			error.name === "TimeoutError";
		if (!aborted && !timedOut && !stalled) {
			// Only a fault of the connection becomes a failed call. It is judged
			// below, because a finish reason that already came means the answer
			// is whole. Any other error is a real one and still travels.
			if (callbackFailed || !(error instanceof Error)) throw error;
			readError = error;
		}
		if (aborted) finishReason = ABORTED;
	} finally {
		// Releasing the lock lets the connection be torn down when the caller
		// aborts mid-answer, which is the common case for a user who navigates away.
		disarm();
		reader.releaseLock();
	}

	// A close with the signal already fired is the caller's doing, however the
	// runtime ended the read. Without this a clean close after a Stop would be
	// reported as the upstream cutting the answer.
	if (
		(finishReason === null || finishReason === "error") &&
		opts.signal?.aborted
	)
		finishReason = ABORTED;

	const turn: ChatTurn = {
		content,
		costUsd,
		toolCalls: [...slots.entries()]
			.sort(([a], [b]) => a - b)
			.map(([, slot]) => slot)
			.filter((slot) => slot.id && slot.name),
		promptTokens,
		completionTokens,
		finishReason,
		servedModel,
		provider,
		firstProgressMs,
	};
	const detail = { stalled, outputStarted };

	// A close with the signal fired is a Stop, not a failure. Past that, two
	// things fail the call. The first is an error frame, or the finish reason
	// "error" that OpenRouter documents for it: the provider said it gave up.
	// The second is a stream that ended with no finish reason at all, which is
	// an upstream that closed the connection on a slow call. Returning either
	// as a turn made a cut answer, or no answer, look like a success. Even tool
	// calls that look whole are not trusted: the failure can come before the
	// last fragment of their arguments.
	if (finishReason !== ABORTED) {
		if (upstream)
			throw new OpenRouterStreamCutError(turn, upstream, false, false, detail);
		if (finishReason === "error") {
			throw new OpenRouterStreamCutError(
				turn,
				{
					code: null,
					message: 'finish reason "error" with no error object',
				},
				false,
				false,
				detail,
			);
		}
		if (finishReason === null && readError) {
			// With no output yet, the call is the same as one that failed before
			// the headers, so it is retried. With output, it is a cut that is
			// not retried, and the person gets the fixed line.
			if (!outputStarted) throw new OpenRouterNetworkError(readError);
			const cut = new OpenRouterStreamCutError(
				turn,
				null,
				false,
				false,
				detail,
			);
			cut.cause = readError;
			throw cut;
		}
		if (finishReason === null)
			throw new OpenRouterStreamCutError(turn, null, timedOut, false, detail);
	}
	return turn;
};
