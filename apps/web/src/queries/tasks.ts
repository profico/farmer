import { queryOptions } from "@tanstack/react-query";

import {
	listManagedTasks,
	listSelectableTasks,
	listTasksForProject,
} from "#/server/tasks.ts";

import { queryKeys } from "./keys.ts";

// The picker for one entry form: with a project, the whole global list; without
// one, the absence tasks and built-ins. `undefined` means "no project yet", which legitimately returns
// only the absence tasks rather than nothing.
export const tasksForProjectQuery = (
	org: string,
	projectId: string | undefined,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).tasks, "for-project", projectId ?? null],
		queryFn: () => listTasksForProject({ data: projectId }),
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
