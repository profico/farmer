import type {
	AbsenceRange,
	FilingRulePatch,
	Integrations,
	IntegrationSettingsPatch,
	NewRecurringBlock,
	NotificationSettings,
	NotificationSettingsPatch,
	RecurringBlock,
	RecurringBlockPatch,
	WorkingHoursDay,
	WorkingHoursDayPatch,
} from "@farmer/api-client";
import {
	type QueryClient,
	type QueryKey,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { useAccess, useMeta } from "./capabilities";
import { scope, type Workspace, useWorkspace } from "./queries";
import { recurringBlocksKey, timerSettingsKey } from "./time";

// The queries and the writes of the "You" screens: the person's own
// settings and records. Each key starts with `scope(w)`. Each query waits
// for API version 2, because a link can open a screen past the gate in
// More.

const MINUTE = 60_000;

const keys = (w: Workspace) => ({
	notifications: [...scope(w), "you", "notifications"],
	hiddenTasks: [...scope(w), "you", "hidden-tasks"],
	workingHours: [...scope(w), "you", "working-hours"],
	// The Time screens read or change these resources too, so the two
	// areas share one key for each.
	filingRules: [...scope(w), "filing-rules"],
	timerSettings: timerSettingsKey(w),
	recurringBlocks: recurringBlocksKey(w),
	integrations: [...scope(w), "you", "integrations"],
	holidays: (year: number) => [...scope(w), "you", "holidays", year],
	absences: [...scope(w), "absences"],
	absenceMonth: (year: number, month: number) => [
		...scope(w),
		"absences",
		year,
		month,
	],
	rewind: (year: number) => [...scope(w), "you", "rewind", year],
});

/** The reads of the Time tab and the reports. A write that adds or removes
 *  time makes them old. */
const invalidateTime = (queryClient: QueryClient, w: Workspace) =>
	Promise.all(
		["entries", "unfiled", "tracking", "home", "reports"].map((part) =>
			queryClient.invalidateQueries({ queryKey: [...scope(w), part] }),
		),
	);

/**
 * A write that shows its result at once. The cached value changes before
 * the request, and goes back if the server refuses. A switch thus does not
 * jump back while the request runs.
 */
const optimistic = async <T>(
	queryClient: QueryClient,
	queryKey: QueryKey,
	change: (current: T) => T,
) => {
	await queryClient.cancelQueries({ queryKey });
	const previous = queryClient.getQueryData<T>(queryKey);
	if (previous !== undefined) {
		queryClient.setQueryData<T>(queryKey, change(previous));
	}
	return { queryKey, previous };
};

const rollback = (
	queryClient: QueryClient,
	context: { queryKey: QueryKey; previous: unknown } | undefined,
) => {
	if (context) queryClient.setQueryData(context.queryKey, context.previous);
};

// ── /meta: the push relay ───────────────────────────────────────────────

/**
 * Whether the Server sends native push to the app. It comes from the shared
 * `/meta` query. A Server from before the mobile push sends no `pushRelay`:
 * that is off.
 */
export const usePushRelayEnabled = (): boolean =>
	useMeta().data?.pushRelay?.enabled ?? false;

// ── Preferences ─────────────────────────────────────────────────────────

export const useNotificationSettings = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).notifications,
		queryFn: () => w.client.getNotificationSettings(w.slug),
		enabled: fullApi,
	});
};

export const useUpdateNotificationSettings = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const queryKey = keys(w).notifications;
	return useMutation({
		mutationFn: (patch: NotificationSettingsPatch) =>
			w.client.updateNotificationSettings(w.slug, patch),
		onMutate: (patch) =>
			optimistic<NotificationSettings>(queryClient, queryKey, (current) => ({
				...current,
				...patch,
			})),
		onError: (_error, _patch, context) => rollback(queryClient, context),
		onSuccess: (settings) => queryClient.setQueryData(queryKey, settings),
	});
};

export const useHiddenTasks = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).hiddenTasks,
		queryFn: () => w.client.listHiddenTasks(w.slug),
		enabled: fullApi,
	});
};

/**
 * Switch one task off or on, or every task on (`taskId: null`). The key is
 * shared, so the list is read again only after the last of several fast
 * presses. Else a read between two presses gives a list without the
 * second, and its switch jumps back for a moment.
 */
export const useSetTaskHidden = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const queryKey = keys(w).hiddenTasks;
	const mutationKey = [...queryKey, "write"];
	return useMutation({
		mutationKey,
		mutationFn: ({
			taskId,
			hidden,
		}: {
			taskId: string | null;
			hidden: boolean;
		}) =>
			taskId === null
				? w.client.showAllTasks(w.slug)
				: w.client.setTaskHidden(w.slug, { taskId, hidden }),
		onMutate: ({ taskId, hidden }) =>
			optimistic<{ taskIds: string[] }>(queryClient, queryKey, (current) => {
				if (taskId === null) return { taskIds: [] };
				const others = current.taskIds.filter((id) => id !== taskId);
				return { taskIds: hidden ? [...others, taskId] : others };
			}),
		onError: (_error, _vars, context) => rollback(queryClient, context),
		onSettled: () => {
			if (queryClient.isMutating({ mutationKey }) === 1) {
				return queryClient.invalidateQueries({ queryKey });
			}
		},
	});
};

export const useFilingRules = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).filingRules,
		queryFn: () => w.client.listFilingRules(w.slug),
		enabled: fullApi,
	});
};

export const useUpdateFilingRule = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: FilingRulePatch }) =>
			w.client.updateFilingRule(w.slug, id, patch),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: keys(w).filingRules }),
	});
};

export const useDeleteFilingRule = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => w.client.deleteFilingRule(w.slug, id),
		// Not awaited: the sheet of the rule closes first, so it does not
		// show "gone" while the list is read again.
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys(w).filingRules });
		},
	});
};

// ── Schedule ────────────────────────────────────────────────────────────

export const useWorkingHours = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).workingHours,
		queryFn: () => w.client.listWorkingHours(w.slug),
		enabled: fullApi,
	});
};

/** One weekday of the working hours. `whoami` holds the working days and
 *  the tracking holds the targets, so both are read again after it. */
export const useUpdateWorkingHoursDay = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const queryKey = keys(w).workingHours;
	return useMutation({
		mutationFn: (patch: WorkingHoursDayPatch) =>
			w.client.updateWorkingHoursDay(w.slug, patch),
		onMutate: (patch) =>
			optimistic<WorkingHoursDay[]>(queryClient, queryKey, (days) =>
				days.map((day) =>
					day.dayOfWeek === patch.dayOfWeek
						? {
								...day,
								enabled: patch.enabled,
								startTime: patch.startTime ?? day.startTime,
								endTime: patch.endTime ?? day.endTime,
							}
						: day,
				),
			),
		onError: (_error, _patch, context) => rollback(queryClient, context),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey }),
				queryClient.invalidateQueries({ queryKey: [...scope(w), "whoami"] }),
				queryClient.invalidateQueries({ queryKey: [...scope(w), "tracking"] }),
			]),
	});
};

export const useUpdateTimerSettings = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (maxSeconds: number) =>
			w.client.updateTimerSettings(w.slug, { maxSeconds }),
		// The timer card shows when a running timer is dropped, so it is read
		// again with the new limit.
		onSuccess: (settings) => {
			queryClient.setQueryData(keys(w).timerSettings, settings);
			return queryClient.invalidateQueries({
				queryKey: [...scope(w), "timer"],
			});
		},
	});
};

// ── Recurring blocks ────────────────────────────────────────────────────

export const useRecurringBlocks = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).recurringBlocks,
		queryFn: () => w.client.listRecurringBlocks(w.slug),
		enabled: fullApi,
	});
};

/** A block becomes entries on the next read of a range, so a change to one
 *  makes the cached days old. */
const useBlockSettled = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: keys(w).recurringBlocks }),
			invalidateTime(queryClient, w),
		]);
};

export const useCreateRecurringBlock = () => {
	const w = useWorkspace();
	const settled = useBlockSettled();
	return useMutation({
		mutationFn: (body: NewRecurringBlock) =>
			w.client.createRecurringBlock(w.slug, body),
		onSuccess: settled,
	});
};

export const useUpdateRecurringBlock = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const settled = useBlockSettled();
	const queryKey = keys(w).recurringBlocks;
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: RecurringBlockPatch }) =>
			w.client.updateRecurringBlock(w.slug, id, patch),
		onMutate: ({ id, patch }) =>
			optimistic<RecurringBlock[]>(queryClient, queryKey, (blocks) =>
				blocks.map((block) =>
					block.id === id && patch.active !== undefined
						? { ...block, active: patch.active }
						: block,
				),
			),
		onError: (_error, _vars, context) => rollback(queryClient, context),
		onSettled: settled,
	});
};

export const useDeleteRecurringBlock = () => {
	const w = useWorkspace();
	const settled = useBlockSettled();
	return useMutation({
		mutationFn: (id: string) => w.client.deleteRecurringBlock(w.slug, id),
		// Not awaited, so the sheet of the block closes before the list is
		// read again.
		onSuccess: () => {
			void settled();
		},
	});
};

export const useEnableBreakBlock = () => {
	const w = useWorkspace();
	const settled = useBlockSettled();
	return useMutation({
		mutationFn: () => w.client.enableBreakBlock(w.slug),
		onSuccess: settled,
	});
};

// ── Integrations ────────────────────────────────────────────────────────

/**
 * The GitHub and Google Calendar connections. A connection is made on the
 * web, so the person comes back to the app from the browser. The value is
 * old at once, so the read happens again each time the app comes to the
 * front.
 */
export const useIntegrations = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).integrations,
		queryFn: () => w.client.getIntegrations(w.slug),
		enabled: fullApi,
		staleTime: 0,
	});
};

export const useUpdateIntegrationSettings = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const queryKey = keys(w).integrations;
	return useMutation({
		mutationFn: (patch: IntegrationSettingsPatch) =>
			w.client.updateIntegrationSettings(w.slug, patch),
		onMutate: (patch) =>
			optimistic<Integrations>(queryClient, queryKey, (current) => ({
				...current,
				settings: { ...current.settings, ...patch },
			})),
		onError: (_error, _patch, context) => rollback(queryClient, context),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey }),
				invalidateTime(queryClient, w),
			]),
	});
};

export type Provider = "github" | "googleCalendar";

export const useDisconnect = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (provider: Provider) =>
			provider === "github"
				? w.client.disconnectGithub(w.slug)
				: w.client.disconnectGoogleCalendar(w.slug),
		onSuccess: (integrations) =>
			queryClient.setQueryData(keys(w).integrations, integrations),
	});
};

/** Runs every automation that is on, as the background worker does. */
export const useSyncNow = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => w.client.sync(w.slug),
		onSuccess: () => invalidateTime(queryClient, w),
	});
};

// ── Holidays and absences ───────────────────────────────────────────────

export const useHolidays = (year: number) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).holidays(year),
		queryFn: () => w.client.listHolidays(w.slug, { year }),
		// The year comes from `whoami`; 0 is a year not known yet.
		enabled: fullApi && year > 0,
		staleTime: 60 * MINUTE,
	});
};

export const useAbsences = (year: number, month: number) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).absenceMonth(year, month),
		queryFn: () => w.client.listAbsences(w.slug, { year, month }),
		enabled: fullApi && year > 0,
	});
};

const useAbsenceSettled = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: keys(w).absences }),
			invalidateTime(queryClient, w),
		]);
};

export const useLogAbsence = () => {
	const w = useWorkspace();
	const settled = useAbsenceSettled();
	return useMutation({
		mutationFn: (body: AbsenceRange) => w.client.logAbsence(w.slug, body),
		onSuccess: settled,
	});
};

export const useDeleteAbsence = () => {
	const w = useWorkspace();
	const settled = useAbsenceSettled();
	return useMutation({
		mutationFn: (id: string) => w.client.deleteAbsence(w.slug, id),
		onSuccess: settled,
	});
};

// ── Rewind ──────────────────────────────────────────────────────────────

export const useRewind = (year: number, enabled: boolean) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: keys(w).rewind(year),
		queryFn: () => w.client.getRewind(w.slug, { year }),
		enabled: fullApi && enabled,
		staleTime: 5 * MINUTE,
	});
};
