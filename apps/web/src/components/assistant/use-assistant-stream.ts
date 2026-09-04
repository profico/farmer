import { useCallback, useRef, useState } from "react";

/**
 * The event union the SSE route emits.
 *
 * Deliberately re-declared here rather than imported from
 * `@farmer/core/services`: that barrel must never appear in a client-reachable
 * module (CLAUDE.md — it reaches `report-pdf.service` and its native typst
 * binding, which fails the client build outright). A type-only import is erased
 * at build time and would work, right up until somebody deletes the `type`
 * keyword while refactoring. Source of truth is `AssistantEvent` in
 * `packages/core/src/services/assistant.service.ts`; these two must be changed
 * together.
 */
export type AssistantEvent =
	| { type: "message"; messageId: string; role: "user" }
	| { type: "delta"; text: string }
	| { type: "tool_start"; toolCallId: string; name: string }
	| { type: "tool_result"; toolCallId: string; name: string; ok: boolean }
	| {
			type: "approval_required";
			messageId: string;
			toolCallId: string;
			name: string;
			summary: string;
			arguments: string;
			preview: ApprovalPreview | null;
			selectable: boolean;
	  }
	| { type: "title"; title: string }
	| { type: "done" }
	| { type: "error"; message: string };

export type ToolTrace = {
	toolCallId: string;
	name: string;
	ok: boolean | null;
};

/** The rows a batch write would touch. Mirrors `ApprovalPreview` in
 *  `assistant-tools.ts` — same re-declaration rule as `AssistantEvent` above,
 *  and the same reason. */
export type ApprovalPreview = {
	columns: string[];
	rows: { id: string; cells: string[] }[];
	note?: string;
};

export type PendingApproval = {
	toolCallId: string;
	name: string;
	summary: string;
	arguments: string;
	preview: ApprovalPreview | null;
	/** Whether the rows can be ticked individually, or are only there to read. */
	selectable: boolean;
};

type Body =
	| { conversationId: string; message: string }
	| {
			conversationId: string;
			resolve: {
				toolCallId: string;
				decision: "approved" | "rejected";
				selectedRowIds?: string[];
			};
	  };

export type AssistantStream = {
	/** Text of the answer currently arriving. Empty when idle. */
	streamingText: string;
	/** The message that started the turn in flight, so the transcript can show
	 *  it while the model works. The server's own copy of it only lands with the
	 *  refetch at the end of the turn, which is a whole answer's worth of waiting
	 *  to see what you just typed. Null on an approval turn, which has no new
	 *  message, and null when idle. */
	sentMessage: string | null;
	/** Tools this turn has touched, in the order the model asked for them. */
	traces: ToolTrace[];
	pending: PendingApproval | null;
	error: string | null;
	isStreaming: boolean;
	send: (conversationId: string, message: string) => Promise<void>;
	resolve: (
		conversationId: string,
		toolCallId: string,
		decision: "approved" | "rejected",
		/** The ticked rows of a batch. Omitted means the whole call. */
		selectedRowIds?: string[],
	) => Promise<void>;
	stop: () => void;
	/** Drop the live turn — called once its messages have been refetched from
	 *  the server, so the answer doesn't appear twice mid-swap. */
	reset: () => void;
};

/**
 * One turn of the assistant, over `fetch` + SSE.
 *
 * `fetch` rather than `EventSource`, which is GET-only and cannot carry the
 * message body — and which would also reconnect on its own, silently re-running
 * a turn that had already spent tokens.
 */
export const useAssistantStream = (opts: {
	onDone: () => void | Promise<void>;
	onTitle?: (title: string) => void;
}): AssistantStream => {
	const [streamingText, setStreamingText] = useState("");
	const [sentMessage, setSentMessage] = useState<string | null>(null);
	const [traces, setTraces] = useState<ToolTrace[]>([]);
	const [pending, setPending] = useState<PendingApproval | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	// Held in a ref as well as state so `run` reads the latest callbacks without
	// re-creating itself on every render of the page around it.
	const optsRef = useRef(opts);
	optsRef.current = opts;

	const reset = useCallback(() => {
		setStreamingText("");
		setSentMessage(null);
		setTraces([]);
	}, []);

	const run = useCallback(async (body: Body) => {
		// One turn at a time: sending again mid-answer abandons the first, which
		// is what the user meant by typing over it.
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setError(null);
		setPending(null);
		setStreamingText("");
		// An approval turn carries no message, so this also clears the one the
		// suspended turn was started with — by then the server's copy has landed.
		setSentMessage("message" in body ? body.message : null);
		setTraces([]);
		setIsStreaming(true);

		try {
			const response = await fetch("/api/assistant/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!response.ok || !response.body) {
				// SAFETY: this is the error path — `.catch(() => null)` already covers a body
				// that is not JSON, and `error` is optional with a status-code fallback below.
				const detail = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				setError(detail?.error ?? `The assistant failed (${response.status})`);
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				// Frames are `data: {...}\n\n`; a read can split one anywhere, so the
				// trailing partial line is carried over rather than parsed.
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.startsWith("data:")) continue;
					let event: AssistantEvent;
					try {
						event = JSON.parse(line.slice(5).trim());
					} catch {
						continue;
					}

					switch (event.type) {
						case "delta":
							setStreamingText((current) => current + event.text);
							break;
						case "tool_start":
							setTraces((current) => [
								...current,
								{ toolCallId: event.toolCallId, name: event.name, ok: null },
							]);
							break;
						case "tool_result":
							setTraces((current) =>
								current.map((trace) =>
									trace.toolCallId === event.toolCallId
										? { ...trace, ok: event.ok }
										: trace,
								),
							);
							break;
						case "approval_required":
							setPending({
								toolCallId: event.toolCallId,
								name: event.name,
								summary: event.summary,
								arguments: event.arguments,
								preview: event.preview ?? null,
								selectable: Boolean(event.selectable),
							});
							break;
						case "title":
							optsRef.current.onTitle?.(event.title);
							break;
						case "error":
							setError(event.message);
							break;
						default:
							break;
					}
				}
			}

			await optsRef.current.onDone();
		} catch (caught) {
			// An abort is the user's own doing (they stopped it, or navigated), not
			// a failure to report back to them.
			if (caught instanceof DOMException && caught.name === "AbortError")
				return;
			setError(
				caught instanceof Error ? caught.message : "The assistant failed",
			);
		} finally {
			if (abortRef.current === controller) {
				abortRef.current = null;
				setIsStreaming(false);
			}
		}
	}, []);

	return {
		streamingText,
		sentMessage,
		traces,
		pending,
		error,
		isStreaming,
		reset,
		send: (conversationId, message) => run({ conversationId, message }),
		resolve: (conversationId, toolCallId, decision, selectedRowIds) =>
			run({
				conversationId,
				resolve: { toolCallId, decision, selectedRowIds },
			}),
		stop: () => abortRef.current?.abort(),
	};
};
