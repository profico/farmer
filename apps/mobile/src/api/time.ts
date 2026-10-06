import type {
	ConfirmTimer,
	CopyDay,
	CopyWeek,
	FileTimeEntries,
	NewTimeEntry,
	TimeEntry,
	TimeEntryPatch,
} from "@farmer/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { planCellWrite } from "../time/week-grid";
import { useAccess } from "./capabilities";
import { refreshTime, scope, useWorkspace, type Workspace } from "./queries";

/**
 * The queries and the writes of the Time tab. The reads of `queries.ts`
 * (entries, unfiled, tracking, timer) stay there; this module adds the
 * routes of API version 2, and writes that also refresh the week chart.
 *
 * Two reads here write on the server: `time-entries` and `home` compute
 * the fill blocks of their days again. So each is read once a minute at
 * most, never only because the app came to the front, and only while a
 * screen shows it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The recurring blocks. The "You" screens own the hooks of this key. */
export const recurringBlocksKey = (w: Workspace) =>
	[...scope(w), "recurring-blocks"] as const;

/** The person's timer limit. The "You" screens write it. */
export const timerSettingsKey = (w: Workspace) =>
	[...scope(w), "timer-settings"] as const;

/** The names of the public holidays between two days, by day key. */
export const useHolidayNames = (from: string, to: string) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "holidays", from, to],
		queryFn: () => w.client.listHolidaysInRange(w.slug, { from, to }),
		select: (days) => new Map(days.map((day) => [day.date, day.name])),
		enabled: fullApi,
		staleTime: HOUR,
	});
};

/** The week chart of this week: the totals, the holidays and the marks the
 *  server gives each day. */
export const useHome = (enabled: boolean) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "home"],
		queryFn: () => w.client.getHome(w.slug),
		enabled: fullApi && enabled,
		staleTime: MINUTE,
		refetchOnWindowFocus: false,
	});
};

/** The person's timer limit. A head start must be shorter. */
export const useTimerSettings = (enabled = true) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: timerSettingsKey(w),
		queryFn: () => w.client.getTimerSettings(w.slug),
		enabled: fullApi && enabled,
		staleTime: 5 * MINUTE,
	});
};

export const useCreateTimeEntry = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: NewTimeEntry) => w.client.createTimeEntry(w.slug, body),
		onSuccess: () => refreshTime(queryClient, w),
	});
};

export const useUpdateTimeEntry = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: TimeEntryPatch }) =>
			w.client.updateTimeEntry(w.slug, id, patch),
		onSuccess: () => refreshTime(queryClient, w),
	});
};

export const useDeleteTimeEntry = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => w.client.deleteTimeEntry(w.slug, id),
		onSuccess: () => refreshTime(queryClient, w),
	});
};

/**
 * Stops the timer and logs the entry. `onSaved` runs before the cached
 * timer is cleared: a screen that shows the timer would otherwise lose it
 * and unmount before a callback of `mutate` could run.
 */
export const useConfirmTimerEntry = ({
	onSaved,
}: { onSaved?: () => void } = {}) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: ConfirmTimer) => w.client.confirmTimer(w.slug, body),
		onSuccess: async () => {
			onSaved?.();
			queryClient.setQueryData([...scope(w), "timer"], { timer: null });
			await refreshTime(queryClient, w);
		},
	});
};

export const useCopyDay = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: CopyDay) => w.client.copyDay(w.slug, body),
		onSuccess: () => refreshTime(queryClient, w),
	});
};

export const useCopyWeek = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: CopyWeek) => w.client.copyWeek(w.slug, body),
		onSuccess: () => refreshTime(queryClient, w),
	});
};

/** Runs the calendar and GitHub engines now. */
export const useSyncNow = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => w.client.sync(w.slug),
		onSuccess: () => refreshTime(queryClient, w),
	});
};

/** Files entries to a project, and with `remember` adds a filing rule. */
export const useFileEntries = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: FileTimeEntries) =>
			w.client.fileTimeEntries(w.slug, body),
		onSuccess: () =>
			Promise.all([
				refreshTime(queryClient, w),
				queryClient.invalidateQueries({
					queryKey: [...scope(w), "filing-rules"],
				}),
			]),
	});
};

/**
 * Deletes entries one by one. A failure is kept, not thrown: a batch that
 * stops half way has still deleted what came before, and the screen must
 * show that.
 */
export const useRemoveEntries = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (ids: string[]) => {
			const removed: string[] = [];
			let firstError: string | null = null;
			for (const id of ids) {
				try {
					await w.client.deleteTimeEntry(w.slug, id);
					removed.push(id);
				} catch (error) {
					firstError ??= error instanceof Error ? error.message : String(error);
				}
			}
			return { removed, firstError };
		},
		onSettled: () => refreshTime(queryClient, w),
	});
};

/** Puts removed entries back. It stops at the first failure, so the screen
 *  does not say that an undo worked when it did not. */
export const useRestoreEntries = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (bodies: NewTimeEntry[]) => {
			for (const body of bodies) {
				await w.client.createTimeEntry(w.slug, body);
			}
		},
		onSettled: () => refreshTime(queryClient, w),
	});
};

export type CellInput = {
	/** The entries behind the cell, as the screen read them. */
	cell: readonly TimeEntry[];
	date: string;
	projectId: string | null;
	taskId: string;
	durationSeconds: number;
};

/**
 * Writes one cell of the week grid. The first entry changes before the
 * others are deleted, so a refused change (a day over 24 hours) deletes
 * nothing.
 */
export const useWriteCell = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: CellInput) => {
			const plan = planCellWrite(input.cell, input.durationSeconds);
			switch (plan.kind) {
				case "none":
					return;
				case "create":
					await w.client.createTimeEntry(w.slug, {
						date: input.date,
						taskId: input.taskId,
						projectId: input.projectId ?? undefined,
						durationSeconds: plan.durationSeconds,
					});
					return;
				case "update":
					await w.client.updateTimeEntry(w.slug, plan.id, {
						durationSeconds: plan.durationSeconds,
					});
					for (const id of plan.deleteIds) {
						await w.client.deleteTimeEntry(w.slug, id);
					}
					return;
				case "delete":
					for (const id of plan.ids) {
						await w.client.deleteTimeEntry(w.slug, id);
					}
			}
		},
		onSettled: () => refreshTime(queryClient, w),
	});
};

/** Writes the notes of a row, one entry at a time. */
export const useWriteNotes = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (patches: { id: string; description: string }[]) => {
			for (const patch of patches) {
				await w.client.updateTimeEntry(w.slug, patch.id, {
					description: patch.description,
				});
			}
		},
		onSettled: () => refreshTime(queryClient, w),
	});
};

/**
 * Removes a row of the week grid. The row leaves the cached week at once
 * and comes back if the server refuses. The days go in parallel; the
 * entries of one day go in order, because each delete moves that day's
 * fill block. Each day is waited for before a failure is thrown.
 */
export const useRemoveRow = (from: string, to: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const queryKey = [...scope(w), "entries", from, to];
	return useMutation({
		mutationFn: async (days: string[][]) => {
			const results = await Promise.allSettled(
				days.map(async (ids) => {
					for (const id of ids) await w.client.deleteTimeEntry(w.slug, id);
				}),
			);
			const failed = results.find((result) => result.status === "rejected");
			if (failed) throw failed.reason;
		},
		onMutate: async (days) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData<TimeEntry[]>(queryKey);
			const ids = new Set(days.flat());
			queryClient.setQueryData<TimeEntry[]>(queryKey, (old) =>
				old?.filter((entry) => !ids.has(entry.id)),
			);
			return { previous };
		},
		onError: (_error, _days, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onSettled: () => refreshTime(queryClient, w),
	});
};
