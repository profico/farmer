// OpenRouter, spoken directly.
//
// Hand-rolled over `externalFetch` for the same reason `slack-client.ts` and
// `github-client.ts` are: the surface this app needs is one POST and one GET,
// and an SDK would bring a model registry, a provider abstraction and a
// streaming runtime to carry them. OpenRouter is OpenAI-compatible, so what
// follows is the chat-completions wire format and nothing else.

import { externalFetch } from "./http";

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
		parameters: Record<string, unknown>;
	};
};

/** What a streamed turn produced, once the stream has ended. */
export type ChatTurn = {
	content: string;
	toolCalls: { id: string; name: string; arguments: string }[];
	promptTokens: number | null;
	completionTokens: number | null;
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
	);

	if (!response.ok || !response.body) {
		// The error body is JSON on a well-formed rejection and an HTML error page
		// when something in front of OpenRouter answered instead, so it is read as
		// text and only then hopefully parsed.
		const raw = await response.text().catch(() => "");
		let detail = raw.slice(0, 300);
		try {
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
	let finishReason: string | null = null;

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
					choices?: {
						delta?: {
							content?: string | null;
							tool_calls?: {
								index: number;
								id?: string;
								function?: { name?: string; arguments?: string };
							}[];
						};
						finish_reason?: string | null;
					}[];
					usage?: { prompt_tokens?: number; completion_tokens?: number };
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

				if (chunk.usage) {
					promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
					completionTokens = chunk.usage.completion_tokens ?? completionTokens;
				}

				const choice = chunk.choices?.[0];
				if (!choice) continue;
				if (choice.finish_reason) finishReason = choice.finish_reason;

				const text = choice.delta?.content;
				if (text) {
					content += text;
					opts.onDelta?.(text);
				}

				for (const call of choice.delta?.tool_calls ?? []) {
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
	} finally {
		// Releasing the lock lets the connection be torn down when the caller
		// aborts mid-answer, which is the common case for a user who navigates away.
		reader.releaseLock();
	}

	return {
		content,
		toolCalls: [...slots.entries()]
			.sort(([a], [b]) => a - b)
			.map(([, slot]) => slot)
			.filter((slot) => slot.id && slot.name),
		promptTokens,
		completionTokens,
		finishReason,
	};
};
