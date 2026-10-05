import { ApiClientError, type AssistantThreadDetail } from "@farmer/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { threadKey, threadsKey } from "../api/assistant";
import { scope, useWorkspace, type Workspace } from "../api/queries";
import { applyEvent, IDLE, type Run, startRun } from "./turn";

/**
 * The turns in flight, one for each thread. The store lives outside the
 * screens, so a turn goes on when the person leaves the chat, and the answer
 * waits in the thread when they come back. One turn at a time for each
 * thread, as on the web.
 */

type Entry = { run: Run; controller: AbortController | null };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

const notify = () => {
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const keyOf = (w: Workspace, threadId: string) =>
	`${w.origin}\n${w.slug}\n${threadId}`;

const set = (key: string, run: Run, controller: AbortController | null) => {
	entries.set(key, { run, controller });
	notify();
};

const patch = (key: string, change: (run: Run) => Run) => {
	const entry = entries.get(key);
	if (!entry) return;
	set(key, change(entry.run), entry.controller);
};

/** A stored answer can arrive a moment after the stream ends. */
const SETTLE_TRIES = 8;
const SETTLE_WAIT_MS = 250;

const pause = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

type Turn =
	| { kind: "send"; message: string }
	| {
			kind: "resolve";
			toolCallId: string;
			decision: "approved" | "rejected";
			selectedRowIds?: string[];
	  };

/** The text for a turn that failed before its first event. */
const failureText = (error: Error) => {
	if (error instanceof ApiClientError && error.code === "rate_limited") {
		return error.message;
	}
	if (error instanceof ApiClientError && error.kind === "unreachable") {
		return "The server cannot be reached. Check the connection, then try again.";
	}
	return error.message || "The assistant failed. Try again.";
};

export type RunActions = {
	/** True when the message reached the server. The composer gives the
	 *  draft back when it did not. */
	send: (threadId: string, message: string) => Promise<boolean>;
	resolve: (
		threadId: string,
		toolCallId: string,
		decision: "approved" | "rejected",
		selectedRowIds?: string[],
	) => Promise<void>;
	stop: (threadId: string) => void;
};

/** The actions of the turns in the current workspace. */
export const useRunActions = (): RunActions => {
	const w = useWorkspace();
	const queryClient = useQueryClient();

	/** The turn is over: read the stored thread, then drop the live copy. */
	const settle = useCallback(
		async (key: string, threadId: string, awaitAnswer: boolean) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: threadsKey(w) }),
				queryClient.invalidateQueries({ queryKey: threadKey(w, threadId) }),
				// A tool can change entries, projects, clients and tasks.
				queryClient.invalidateQueries({ queryKey: scope(w) }),
			]);
			for (let tries = 0; awaitAnswer && tries < SETTLE_TRIES; tries++) {
				const thread = queryClient.getQueryData<AssistantThreadDetail>(
					threadKey(w, threadId),
				);
				const last = thread?.messages.at(-1);
				if (last?.role === "assistant" && last.content.trim()) break;
				await pause(SETTLE_WAIT_MS);
				await queryClient.refetchQueries({ queryKey: threadKey(w, threadId) });
			}
			const entry = entries.get(key);
			if (!entry || entry.controller) return;
			// An error stays until the next turn, so the person can read it.
			// The rest is in the stored thread now, or back in the composer.
			set(
				key,
				entry.run.error ? { ...IDLE, error: entry.run.error } : IDLE,
				null,
			);
		},
		[queryClient, w],
	);

	const run = useCallback(
		async (threadId: string, turn: Turn): Promise<boolean> => {
			const key = keyOf(w, threadId);
			entries.get(key)?.controller?.abort();
			const controller = new AbortController();
			set(
				key,
				startRun(turn.kind === "send" ? turn.message : null),
				controller,
			);
			const mine = () => entries.get(key)?.controller === controller;
			let delivered = turn.kind === "resolve";

			try {
				const stream =
					turn.kind === "send"
						? w.client.sendAssistantMessage(
								w.slug,
								threadId,
								{ message: turn.message },
								controller.signal,
							)
						: w.client.answerAssistantApproval(
								w.slug,
								threadId,
								{
									toolCallId: turn.toolCallId,
									decision: turn.decision,
									selectedRowIds: turn.selectedRowIds,
								},
								controller.signal,
							);
				for await (const event of stream) {
					if (!mine()) break;
					if (event.type === "message" && event.role === "user") {
						delivered = true;
					}
					patch(key, (state) => applyEvent(state, event));
				}
			} catch (caught) {
				const error =
					caught instanceof Error ? caught : new Error(String(caught));
				// A stop aborts the request. It is not a failure to explain.
				if (mine() && error.name !== "AbortError") {
					patch(key, (state) => ({ ...state, error: failureText(error) }));
				}
			} finally {
				if (mine()) {
					const entry = entries.get(key);
					if (entry) set(key, { ...entry.run, isStreaming: false }, null);
				}
			}
			const streamed = entries.get(key)?.run.streamed ?? false;
			if (!entries.get(key)?.controller) {
				await settle(key, threadId, controller.signal.aborted && streamed);
			}
			return delivered;
		},
		[settle, w],
	);

	return useMemo(
		() => ({
			send: (threadId, message) => run(threadId, { kind: "send", message }),
			resolve: async (threadId, toolCallId, decision, selectedRowIds) => {
				await run(threadId, {
					kind: "resolve",
					toolCallId,
					decision,
					selectedRowIds,
				});
			},
			stop: (threadId) => entries.get(keyOf(w, threadId))?.controller?.abort(),
		}),
		[run, w],
	);
};

/** The live turn of one thread, or the idle state. */
export const useRun = (threadId: string): Run => {
	const w = useWorkspace();
	const key = keyOf(w, threadId);
	return useSyncExternalStore(
		subscribe,
		() => entries.get(key)?.run ?? IDLE,
		() => IDLE,
	);
};

/** True while a turn of the thread runs. The thread list shows it. */
export const useThreadRunning = (threadId: string): boolean =>
	useRun(threadId).isStreaming;
