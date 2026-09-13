import { queryOptions } from "@tanstack/react-query";

import {
	listManagedTasks,
	listRecentTasks,
	listSelectableTasks,
	listTasksForProject,
} from "#/server/tasks.ts";

import { queryKeys } from "./keys.ts";

// The picker for one entry form: with a project, the whole global list; without
// one, the absence tasks and built-ins. `undefined` means "no project yet",
// which legitimately returns the absence list rather than nothing.
export const tasksForProjectQuery = (
	org: string,
	projectId: string | undefined,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).tasks, "for-project", projectId ?? null],
		queryFn: () => listTasksForProject({ data: projectId }),
	});

// The picker's "Recent" group: the caller's last three distinct tasks on this
// project, or anywhere if they have not logged on it yet. Never considered
// fresh, so every dialog open refetches it and the entry just logged is at the
// top next time.
export const recentTasksQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).tasks, "recent", projectId],
		queryFn: () => listRecentTasks({ data: projectId }),
		staleTime: 0,
	});

export const selectableTasksQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).tasks, "selectable"],
		queryFn: () => listSelectableTasks(),
	});

// Admin's Settings list: org tasks with usage counts, including archived.
export const managedTasksQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).tasks, "managed"],
		queryFn: () => listManagedTasks(),
	});
