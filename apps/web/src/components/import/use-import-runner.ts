import type {
	HarvestDayRef,
	HarvestFinishResult,
} from "@farmer/core/lib/harvest/index";
import { HARVEST_CHUNK_MAX_ROWS } from "@farmer/core/schema";
import { useCallback, useRef, useState } from "react";

import {
	finishHarvestImport,
	importHarvestDays,
	removeHarvestDays,
	startHarvestImport,
} from "#/server/harvest-import.ts";

import type { HarvestPlanView } from "./harvest-worker-protocol.ts";
import type { HarvestWorker } from "./use-harvest-worker.ts";

type Created = Awaited<ReturnType<typeof startHarvestImport>>["created"];

export type ImportRunnerState = {
	status: "idle" | "running" | "failed" | "done";
	step: string;
	done: number;
	total: number;
	error: string | null;
	created: Created | null;
	inserted: number;
	deleted: number;
	unchangedDays: number;
	keptDays: HarvestDayRef[];
	finish: HarvestFinishResult | null;
};

const IDLE: ImportRunnerState = {
	status: "idle",
	step: "",
	done: 0,
	total: 0,
	error: null,
	created: null,
	inserted: 0,
	deleted: 0,
	unchangedDays: 0,
	keptDays: [],
	finish: null,
};

type Job = {
	planId: number;
	/** The run's id, made here once per attempt and sent with every `start`:
	 *  a retried `start` whose first answer was lost gets that run back. */
	runToken: string;
	plan: HarvestPlanView;
	chunkCount: number;
	removeChunks: HarvestDayRef[][];
	runId: string | null;
	next: number;
	removeNext: number;
};

/**
 * Sends a plan to the server: start, then the day chunks, then the removed
 * days, then finish. The cursor lives in a ref, so "Retry" continues from the
 * step that failed instead of starting a second run. Every step is safe to
 * repeat: `start` answers a run id it has seen with that run, and
 * `importDays` skips the keys it already holds.
 */
export function useImportRunner(worker: HarvestWorker, onFinished: () => void) {
	const job = useRef<Job | null>(null);
	const [state, setState] = useState<ImportRunnerState>(IDLE);

	const advance = useCallback(async () => {
		const j = job.current;
		if (!j) return;
		const total = 1 + j.chunkCount + j.removeChunks.length + 1;
		const progress = (step: string) =>
			setState((s) => ({
				...s,
				status: "running",
				error: null,
				step,
				done: (j.runId ? 1 : 0) + j.next + j.removeNext,
				total,
			}));
		try {
			if (!j.runId) {
				progress("Writing the clients, tasks, people and projects");
				const started = await startHarvestImport({
					data: { ...j.plan.start, runId: j.runToken },
				});
				j.runId = started.runId;
				setState((s) => ({ ...s, created: started.created }));
			}
			const runId = j.runId;
			while (j.next < j.chunkCount) {
				progress(`Importing days: part ${j.next + 1} of ${j.chunkCount}`);
				const { days } = await worker.chunk(j.planId, j.next);
				const res = await importHarvestDays({ data: { runId, days } });
				j.next += 1;
				setState((s) => ({
					...s,
					inserted: s.inserted + res.inserted,
					deleted: s.deleted + res.deleted,
					unchangedDays: s.unchangedDays + res.unchangedDays,
					keptDays: [...s.keptDays, ...res.keptDays],
				}));
			}
			while (j.removeNext < j.removeChunks.length) {
				const days = j.removeChunks[j.removeNext];
				if (!days) break;
				progress("Removing the days that the file no longer has");
				const res = await removeHarvestDays({ data: { runId, days } });
				j.removeNext += 1;
				setState((s) => ({
					...s,
					deleted: s.deleted + res.deleted,
					keptDays: [...s.keptDays, ...res.keptDays],
				}));
			}
			progress("Closing the history months");
			const finish = await finishHarvestImport({
				data: { runId, ...j.plan.finish },
			});
			job.current = null;
			setState((s) => ({
				...s,
				status: "done",
				step: "Done",
				done: total,
				total,
				finish,
			}));
			onFinished();
		} catch (err) {
			setState((s) => ({
				...s,
				status: "failed",
				error:
					err instanceof Error && err.message
						? err.message
						: "The import stopped.",
			}));
		}
	}, [worker, onFinished]);

	const run = useCallback(
		(planId: number, plan: HarvestPlanView, chunkCount: number) => {
			const removeChunks: HarvestDayRef[][] = [];
			for (
				let i = 0;
				i < plan.removedDays.length;
				i += HARVEST_CHUNK_MAX_ROWS
			) {
				removeChunks.push(
					plan.removedDays.slice(i, i + HARVEST_CHUNK_MAX_ROWS),
				);
			}
			job.current = {
				planId,
				runToken: crypto.randomUUID(),
				plan,
				chunkCount,
				removeChunks,
				runId: null,
				next: 0,
				removeNext: 0,
			};
			setState({ ...IDLE, status: "running" });
			void advance();
		},
		[advance],
	);

	const retry = useCallback(() => void advance(), [advance]);

	const reset = useCallback(() => {
		job.current = null;
		setState(IDLE);
	}, []);

	return { state, run, retry, reset };
}
