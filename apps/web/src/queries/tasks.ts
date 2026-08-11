import { queryOptions } from "@tanstack/react-query";
import {
	listManagedTasks,
	listProjectsForTask,
	listSelectableTasks,
	listTasksForProject,
} from "#/server/tasks.ts";

// The picker for one entry form: the project's cherry-picked tasks plus the two
// absence tasks. `undefined` means "no project yet", which legitimately returns
// only the absence tasks rather than nothing.
export const tasksForProjectQuery = (projectId: string | undefined) =>
	queryOptions({
		queryKey: ["tasks", "for-project", projectId ?? null],
		queryFn: () => listTasksForProject({ data: projectId }),
	});

export const selectableTasksQuery = () =>
	queryOptions({
		queryKey: ["tasks", "selectable"],
		queryFn: () => listSelectableTasks(),
	});

// Admin's Settings list: org tasks with usage counts, including archived.
export const managedTasksQuery = () =>
	queryOptions({
		queryKey: ["tasks", "managed"],
		queryFn: () => listManagedTasks(),
	});

// The mirror of `projectTasksQuery`: which projects offer a given task. Ids
// only — the names come from the projects list the dialog already has.
export const projectsForTaskQuery = (taskId: string) =>
	queryOptions({
		queryKey: ["tasks", "projects-for-task", taskId],
		queryFn: () => listProjectsForTask({ data: taskId }),
	});
