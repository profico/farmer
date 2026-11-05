import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

import { conversationQuery } from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import { invalidateTimer } from "#/queries/timer.ts";

/**
 * The event union the SSE route emits.
 *
 * Deliberately re-declared here rather than imported from
 * `@farmer/core/services`: that barrel must never appear in a client-reachable
 * module (CLAUDE.md — it reaches `postgres`, which crashes hydration silently).
 * A type-only import is erased
 * at build time and would work, right up until somebody deletes the `type`
 * keyword while refactoring. Source of truth is `AssistantEvent` in
 * `packages/core/src/services/assistant.service.ts`; these two must be changed
 * together.
 */
export type AssistantEvent =
	| { type: "message"; messageId: string; role: "user" }
	| { type: "delta"; text: string }
	| {
			type: "tool_start";
			toolCallId: string;
			name: string;
			/** The call's raw arguments — `toolDetail` turns them into the subject
			 *  line beside the step. */
			arguments: string;
	  }
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
	/** The call's raw arguments, as the model sent them. */
	arguments: string;
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
	/** Whether the rows can be ticked individually, or are only there to read. */
	selectable: boolean;
	preview: ApprovalPreview | null;
};

/** Everything a turn in flight has produced so far, for ONE conversation. */
export type AssistantRun = {
	/** Text of the answer currently arriving. Empty when idle. */
	streamingText: string;
	/** The message that started the turn in flight, so the transcript can show
	 *  it while the model works. The server's own copy of it only lands with the
	 *  refetch at the end of the turn, which is a whole answer's worth of waiting
	 *  to see what you just typed. Null on an approval turn, which has no new
	 *  message, and null when idle. */
	sentMessage: string | null;
	/** The id the server gave that message, from the `message` receipt.
	 *
	 *  The transcript needs it to know when to STOP drawing the live copy. A
	 *  thread refetched mid-turn — the 30s `staleTime` runs out while you are in
	 *  another thread, and coming back re-runs the loader — brings the stored row
	 *  in long before the turn ends, and the question was then on screen twice
	 *  until it finished. Comparing ids rather than text, because the same
	 *  question asked twice in one thread is two rows and not a duplicate.
	 *
	 *  Null until the receipt arrives, which is also the window in which no
	 *  stored copy can exist yet. */
	sentMessageId: string | null;
	/** Tools this turn has touched, in the order the model asked for them. */
	traces: ToolTrace[];
	pending: PendingApproval | null;
	error: string | null;
	isStreaming: boolean;
};

/** How long to wait for the server's copy of a stopped turn, and how often to
 *  look. Two seconds all told: long enough for one insert on a busy database,
 *  short enough that nobody reads it as the answer having frozen. */
const SETTLE_TRIES = 8;
const SETTLE_WAIT_MS = 250;

const IDLE: AssistantRun = {
	streamingText: "",
	sentMessage: null,
	sentMessageId: null,
	traces: [],
	pending: null,
	error: null,
	isStreaming: false,
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

type Actions = {
	/**
	 * Sends one message. Resolves TRUE when the server stored it and FALSE when
	 * it never got that far — a rate limit, a dead session, a network that was
	 * not there.
	 *
	 * The composer clears itself on send, so without this answer a refused turn
	 * costs the person what they typed and they retype it from memory. False is
	 * "this was never said", which is exactly when the draft should come back.
	 */
	send: (conversationId: string, message: string) => Promise<boolean>;
	resolve: (
		conversationId: string,
		toolCallId: string,
		decision: "approved" | "rejected",
		/** The ticked rows of a batch. Omitted means the whole call. */
		selectedRowIds?: string[],
	) => Promise<void>;
	stop: (conversationId: string) => void;
};

/**
 * Three contexts rather than one, and the split is what keeps the sidebar cheap.
 *
 * `RunsContext` changes on every streamed token. The thread list only ever asks
 * "which of these is working?", which changes twice a turn — so it reads
 * `RunningContext` and re-renders twice, not once per token. `ActionsContext` is
 * stable for the life of the provider, so a component that only sends is never
 * re-rendered by somebody else's answer arriving.
 */
/** The state of a thread at the start of a turn. */
function startedRun(body: Body): AssistantRun {
	return {
		...IDLE,
		// An approval turn carries no message, so this also clears the one
		// the suspended turn was started with — by then the server's copy
		// has landed.
		sentMessage: "message" in body ? body.message : null,
		isStreaming: true,
	};
}

/** The run of each thread, by conversation id. */
type RunsById = Record<string, AssistantRun>;

/** Mark a thread as no longer streaming. A thread with no row is left alone. */
function stopStreaming(state: RunsById, conversationId: string) {
	const held = state[conversationId];
	if (!held?.isStreaming) return state;
	return {
		...state,
		[conversationId]: { ...held, isStreaming: false },
	};
}

/** Read the message of a failed response, or name the status code. */
async function failureDetail(response: Response): Promise<string> {
	// SAFETY: this is the error path — `.catch(() => null)` already covers a body
	// that is not JSON, and `error` is optional with a status-code fallback below.
	const detail = (await response.json().catch(() => null)) as {
		error?: string;
	} | null;
	return detail?.error ?? `The assistant failed (${response.status})`;
}

/** Read one `data:` line as an event. A line that is not an event gives null. */
export function parseFrame(line: string): AssistantEvent | null {
	if (!line.startsWith("data:")) return null;
	try {
		return JSON.parse(line.slice(5).trim());
	} catch {
		return null;
	}
}

/** Give each event of a stream to `onEvent`, until the stream ends. */
export async function readEvents(
	stream: ReadableStream<Uint8Array>,
	onEvent: (event: AssistantEvent) => void,
): Promise<void> {
	const reader = stream.getReader();
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
			const event = parseFrame(line);
			if (event) onEvent(event);
		}
	}
}

/** The change an event makes to a thread. An event with no change gives null. */
export function eventChange(
	event: AssistantEvent,
): ((state: AssistantRun) => AssistantRun) | null {
	switch (event.type) {
		case "message":
			return (state) => ({ ...state, sentMessageId: event.messageId });
		case "delta":
			return (state) => ({
				...state,
				streamingText: state.streamingText + event.text,
			});
		case "tool_start":
			return (state) => ({
				...state,
				traces: [
					...state.traces,
					{
						toolCallId: event.toolCallId,
						name: event.name,
						ok: null,
						arguments: event.arguments,
					},
				],
			});
		case "tool_result":
			return (state) => ({
				...state,
				traces: state.traces.map((trace) =>
					trace.toolCallId === event.toolCallId
						? { ...trace, ok: event.ok }
						: trace,
				),
			});
		case "approval_required":
			return (state) => ({
				...state,
				pending: {
					toolCallId: event.toolCallId,
					name: event.name,
					summary: event.summary,
					arguments: event.arguments,
					preview: event.preview ?? null,
					selectable: Boolean(event.selectable),
				},
			});
		case "error":
			return (state) => ({ ...state, error: event.message });
		default:
			return null;
	}
}

const RunsContext = createContext<Record<string, AssistantRun>>({});
const RunningContext = createContext<readonly string[]>([]);
const ActionsContext = createContext<Actions | null>(null);

/**
 * Every assistant turn in flight, keyed by the conversation it belongs to.
 *
 * Mounted by the `/$orgSlug` layout rather than by the assistant page, for two
 * reasons that are really one. A turn belongs to a THREAD, not to whatever the
 * URL happens to point at: state held on the page was shared by every
 * conversation, so opening a second thread showed the first one's answer
 * streaming into it, and its own approval card on top. And the thread list lives
 * in the sidebar, which the page does not contain and cannot tell that a thread
 * is working.
 *
 * Living above the route also means a turn survives navigation — asking a long
 * question, going to look at your timesheet and coming back now finds the answer
 * waiting, instead of a request that was abandoned mid-flight.
 *
 * One turn at a time PER CONVERSATION, not per person: sending again into the
 * same thread abandons the first, which is what typing over an answer means,
 * while a different thread runs alongside it. The server is already per-request
 * and per-conversation, so nothing there needed to change.
 */
export function AssistantRunsProvider({
	orgSlug,
	children,
}: {
	orgSlug: string;
	children: React.ReactNode;
}) {
	const queryClient = useQueryClient();
	const [runs, setRuns] = useState<RunsById>({});
	const [running, setRunning] = useState<readonly string[]>([]);
	const controllers = useRef(new Map<string, AbortController>());

	// Read through a ref inside `run`, which is created once: the org slug is
	// fixed for the life of this provider (it is the layout's own param), and
	// depending on it would re-create every action on an unrelated re-render.
	const orgSlugRef = useRef(orgSlug);
	orgSlugRef.current = orgSlug;

	const patch = useCallback(
		(
			conversationId: string,
			change: (current: AssistantRun) => AssistantRun,
		) => {
			setRuns((current) => ({
				...current,
				[conversationId]: change(current[conversationId] ?? IDLE),
			}));
		},
		[],
	);

	/**
	 * Clear what the live connection produced, once the server's own copy of it
	 * has been refetched.
	 *
	 * `pending` and `error` survive: a write waiting for consent outlives the
	 * connection that proposed it, and an error line is the only record left that
	 * the turn failed. When neither is there the thread is forgotten entirely,
	 * so a long session does not accumulate a row per conversation ever opened.
	 */
	const dropLiveTurn = useCallback((conversationId: string) => {
		setRuns((state) => {
			const held = state[conversationId];
			if (!held) return state;
			if (!held.pending && !held.error) {
				const rest = { ...state };
				delete rest[conversationId];
				return rest;
			}
			return {
				...state,
				[conversationId]: {
					...held,
					streamingText: "",
					sentMessage: null,
					sentMessageId: null,
					traces: [],
					isStreaming: false,
				},
			};
		});
	}, []);

	/** Take the server's copy of the turn and let go of the live one.
	 *
	 *  Both endings run it — the turn that finished and the turn somebody
	 *  stopped — because both leave a row in the thread that this store is
	 *  holding a second, unsaved copy of.
	 *
	 *  `awaitAnswer` is what a STOPPED turn needs and a finished one does not.
	 *  A finished turn's `done` event is sent after the row is written, so one
	 *  refetch is enough. A stop is the other way round: the browser hangs up
	 *  first and the server writes the partial answer a round trip later, so
	 *  refetching immediately reads the thread without it and dropping the live
	 *  copy then leaves the reader with nothing at all until they reload. */
	const settle = useCallback(
		async (conversationId: string, awaitAnswer = false) => {
			const keys = queryKeys(orgSlugRef.current);
			const query = conversationQuery(orgSlugRef.current, conversationId);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...keys.assistant, "conversations"],
				}),
				// This thread by name, not "the open one": the turn that just
				// finished may be in a thread nobody is looking at.
				queryClient.invalidateQueries({ queryKey: query.queryKey }),
				// A turn can have written a time entry, so anything reading them is
				// now stale. Named through the same root the writes use, so this
				// cannot drift from what `createTimeEntry` invalidates.
				queryClient.invalidateQueries({ queryKey: keys.timeEntries }),
				// The timer reads a continued entry's task and note live.
				invalidateTimer(queryClient, orgSlugRef.current),
			]);
			// Bounded, because waiting forever for a row that may never come is a
			// thread frozen mid-answer. Every ending other than the one it is for
			// either has its row already or has no row to wait for, and that is
			// what the ceiling costs: a second and a half of the live copy still
			// showing, which is exactly what it showed a moment ago.
			for (let tries = 0; awaitAnswer && tries < SETTLE_TRIES; tries++) {
				const thread = queryClient.getQueryData(query.queryKey);
				const last = thread?.messages.at(-1);
				if (last?.role === "assistant" && last.content.trim()) break;
				await new Promise((resolve) => setTimeout(resolve, SETTLE_WAIT_MS));
				await queryClient.refetchQueries({ queryKey: query.queryKey });
			}
			// Only after the server's copy has landed, or the answer would show
			// twice — once live, once persisted — for a frame. `pending` and
			// `error` stay: a suspended write outlives the connection that
			// proposed it, and an error is the only record the turn failed.
			dropLiveTurn(conversationId);
		},
		[dropLiveTurn, queryClient],
	);

	const run = useCallback(
		async (conversationId: string, body: Body): Promise<boolean> => {
			// One turn at a time in THIS thread: sending again mid-answer abandons
			// the first, which is what the user meant by typing over it. A turn in
			// another thread is left alone.
			controllers.current.get(conversationId)?.abort();
			const controller = new AbortController();
			controllers.current.set(conversationId, controller);
			/** Whether this call still owns the thread, or a newer one has taken it
			 *  over. Every write below asks first, so an aborted turn finishing its
			 *  teardown cannot wipe the turn that replaced it. */
			const current = () =>
				controllers.current.get(conversationId) === controller;

			setRuns((state) => ({
				...state,
				[conversationId]: startedRun(body),
			}));
			setRunning((state) =>
				state.includes(conversationId) ? state : [...state, conversationId],
			);

			// The server's `message` event is the receipt: it is emitted once the row
			// is written. Inferring delivery from "the response was 200" instead would
			// call a turn delivered that died inside the handler before it stored
			// anything — which is the case where the draft most needs giving back.
			let delivered = false;
			// Whether the model said anything before the turn ended. Only a turn
			// that did leaves a partial answer on the server for a stop to wait on.
			let streamed = false;

			try {
				const response = await fetch("/api/assistant/stream", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
					signal: controller.signal,
				});

				if (!response.ok || !response.body) {
					const message = await failureDetail(response);
					if (current())
						patch(conversationId, (state) => ({ ...state, error: message }));
					return false;
				}

				await readEvents(response.body, (event) => {
					if (!current()) return;
					if (event.type === "message") delivered = true;
					if (event.type === "delta") streamed = true;
					const change = eventChange(event);
					if (change) patch(conversationId, change);
				});

				if (current()) await settle(conversationId);
				return delivered;
			} catch (caught) {
				// An abort is the user's own doing (they stopped it, or typed over
				// it), not a failure to report back to them — and not a draft to hand
				// back either. Returning false here would drop the abandoned message
				// into a composer the person has already refilled.
				//
				// It still settles, because a stopped turn is not an empty one: the
				// server keeps whatever the model had already written (see the abort
				// branch in `assistant.service.ts`). Without the refetch the live
				// half-answer would sit in this store beside the stored copy and the
				// reader would see it twice the moment anything else invalidated.
				if (caught instanceof DOMException && caught.name === "AbortError") {
					// Wait for the partial answer only when there is one to wait for:
					// the server stores nothing for a turn stopped before the model
					// said a word.
					if (current()) await settle(conversationId, streamed);
					return true;
				}
				if (current()) {
					const message =
						caught instanceof Error ? caught.message : "The assistant failed";
					patch(conversationId, (state) => ({ ...state, error: message }));
				}
				return delivered;
			} finally {
				if (current()) {
					controllers.current.delete(conversationId);
					setRunning((state) => state.filter((id) => id !== conversationId));
					setRuns((state) => stopStreaming(state, conversationId));
				}
			}
		},
		[patch, settle],
	);

	const actions = useMemo<Actions>(
		() => ({
			send: (conversationId, message) =>
				run(conversationId, { conversationId, message }),
			// An approval turn carries no message, so there is no receipt to report
			// and nothing to give back.
			resolve: async (conversationId, toolCallId, decision, selectedRowIds) => {
				await run(conversationId, {
					conversationId,
					resolve: { toolCallId, decision, selectedRowIds },
				});
			},
			stop: (conversationId) =>
				controllers.current.get(conversationId)?.abort(),
		}),
		[run],
	);

	return (
		<ActionsContext.Provider value={actions}>
			<RunningContext.Provider value={running}>
				<RunsContext.Provider value={runs}>{children}</RunsContext.Provider>
			</RunningContext.Provider>
		</ActionsContext.Provider>
	);
}

/** The turn in flight in one conversation, or an idle one — including for the
 *  unsaved "new chat", which has no id yet and therefore nothing running. */
export function useAssistantRun(conversationId: string | null): AssistantRun {
	const runs = useContext(RunsContext);
	return (conversationId ? runs[conversationId] : null) ?? IDLE;
}

/** The conversations with a turn in flight. What the thread list marks. */
export function useAssistantRunning(): readonly string[] {
	return useContext(RunningContext);
}

export function useAssistantActions(): Actions {
	const actions = useContext(ActionsContext);
	if (!actions) {
		throw new Error("useAssistantActions outside AssistantRunsProvider");
	}
	return actions;
}
