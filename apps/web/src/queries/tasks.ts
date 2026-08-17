import { queryOptions } from "@tanstack/react-query";
import {
	listManagedTasks,
	listProjectsForTask,
	listSelectableTasks,
	listTasksForProject,
} from "#/server/tasks.ts";
import { queryKeys } from "./keys.ts";

// The picker for one entry form: the project's cherry-picked tasks plus the two
// absence tasks. `undefined` means "no project yet", which legitimately returns
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

// The mirror of `projectTasksQuery`: which projects offer a given task. Ids
// only — the names come from the projects list the dialog already has.
export const projectsForTaskQuery = (org: string, taskId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).tasks, "projects-for-task", taskId],
		queryFn: () => listProjectsForTask({ data: taskId }),
	});
