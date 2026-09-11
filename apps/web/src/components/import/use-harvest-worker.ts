import type {
	HarvestChoices,
	HarvestSnapshot,
} from "@farmer/core/lib/harvest/index";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
	HarvestWorkerRequest,
	HarvestWorkerResponse,
} from "./harvest-worker-protocol.ts";

type Answer<T extends HarvestWorkerResponse["type"]> = Extract<
	HarvestWorkerResponse,
	{ type: T }
>;

type Pending = {
	resolve: (res: HarvestWorkerResponse) => void;
	reject: (err: Error) => void;
};

// Spread per member, so each request keeps its own fields without its id.
type RequestBody = HarvestWorkerRequest extends infer R
	? R extends { id: number }
		? Omit<R, "id">
		: never
	: never;

/**
 * One Worker per mounted import screen, made on the first call — never during
 * the server render — and ended when the screen unmounts, which also drops
 * the parsed files it holds.
 */
export function useHarvestWorker() {
	const state = useRef<{
		worker: Worker;
		pending: Map<number, Pending>;
		next: number;
	} | null>(null);

	useEffect(
		() => () => {
			state.current?.worker.terminate();
			state.current = null;
		},
		[],
	);

	const send = useCallback(
		(body: RequestBody): Promise<HarvestWorkerResponse> => {
			if (!state.current) {
				const worker = new Worker(
					new URL("./harvest.worker.ts", import.meta.url),
					{ type: "module" },
				);
				const pending = new Map<number, Pending>();
				worker.addEventListener(
					"message",
					(event: MessageEvent<HarvestWorkerResponse>) => {
						const waiting = pending.get(event.data.id);
						pending.delete(event.data.id);
						waiting?.resolve(event.data);
					},
				);
				// A Worker that failed to load answers nothing, so every caller
				// waiting on it is told rather than left spinning.
				worker.addEventListener("error", (event) => {
					for (const waiting of pending.values()) {
						waiting.reject(
							new Error(event.message || "The import worker stopped."),
						);
					}
					pending.clear();
				});
				state.current = { worker, pending, next: 0 };
			}
			const current = state.current;
			current.next += 1;
			const id = current.next;
			return new Promise((resolve, reject) => {
				current.pending.set(id, { resolve, reject });
				current.worker.postMessage({ ...body, id });
			});
		},
		[],
	);

	return useMemo(() => {
		function expect<T extends HarvestWorkerResponse["type"]>(type: T) {
			return (res: HarvestWorkerResponse): Answer<T> => {
				if (res.type === "error") throw new Error(res.message);
				if (res.type !== type) {
					throw new Error(
						`The import worker answered ${res.type}, not ${type}.`,
					);
				}
				// SAFETY: `res.type === type` was checked on the line above, and
				// `type` is the discriminant of exactly one member of the union.
				return res as Answer<T>;
			};
		}
		return {
			parse: (files: { name: string; text: string }[]) =>
				send({ type: "parse", files }).then(expect("parsed")),
			plan: (snapshot: HarvestSnapshot, choices: HarvestChoices) =>
				send({ type: "plan", snapshot, choices }).then(expect("plan")),
			chunk: (planId: number, index: number) =>
				send({ type: "chunk", planId, index }).then(expect("chunk")),
		};
	}, [send]);
}

export type HarvestWorker = ReturnType<typeof useHarvestWorker>;
