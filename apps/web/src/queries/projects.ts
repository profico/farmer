import { queryOptions } from "@tanstack/react-query";

import {
	getProject,
	getProjectOverview,
	listAssignableMembers,
	listMyProjects,
	listProjectMembers,
	listProjects,
	listUserProjects,
	listProjectTasks,
} from "#/server/projects.ts";

import { queryKeys } from "./keys.ts";

export const projectsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects],
		queryFn: () => listProjects(),
	});

export const myProjectsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects, "mine"],
		queryFn: () => listMyProjects(),
	});

export const projectQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects, "detail", projectId],
		queryFn: () => getProject({ data: projectId }),
	});

// Under the time-entries root, not the projects one: both are numbers rolled
// up from time entries (the all-time strip, and each row's logged hours), so
// a write from Log time or Book time off already moves them, without the
// dialogs needing to know a project page happens to be open. Keyed under
// "projects" they sat outside every invalidation a time-entry write does —
// `AddBlockDialog` only ever stales the time-entries family — so the strip and
// the roster's hours read stale until something else (a navigation, a project
// list refetch) happened to refresh them.
export const projectOverviewQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timeEntries, "project-overview", projectId],
		queryFn: () => getProjectOverview({ data: projectId }),
	});

export const projectMembersQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timeEntries, "project-members", projectId],
		queryFn: () => listProjectMembers({ data: projectId }),
	});

export const userProjectsQuery = (org: string, userId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects, "by-user", userId],
		queryFn: () => listUserProjects({ data: userId }),
		// The Add button trusts this list, so never serve it from the cache.
		staleTime: 0,
	});

export const assignableMembersQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects, "assignable", projectId],
		queryFn: () => listAssignableMembers({ data: projectId }),
	});

export const projectTasksQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects, "tasks", projectId],
		queryFn: () => listProjectTasks({ data: projectId }),
	});
