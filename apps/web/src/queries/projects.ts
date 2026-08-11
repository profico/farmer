import { queryOptions } from "@tanstack/react-query";
import {
	getProject,
	listAssignableMembers,
	listMyProjects,
	listProjectMembers,
	listProjects,
	listProjectTasks,
} from "#/server/projects.ts";
import { queryKeys } from "./keys.ts";

export const projectsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.projects],
		queryFn: () => listProjects(),
	});

export const myProjectsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.projects, "mine"],
		queryFn: () => listMyProjects(),
	});

export const projectQuery = (projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys.projects, "detail", projectId],
		queryFn: () => getProject({ data: projectId }),
	});

export const projectMembersQuery = (projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys.projects, "members", projectId],
		queryFn: () => listProjectMembers({ data: projectId }),
	});

export const assignableMembersQuery = (projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys.projects, "assignable", projectId],
		queryFn: () => listAssignableMembers({ data: projectId }),
	});

export const projectTasksQuery = (projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys.projects, "tasks", projectId],
		queryFn: () => listProjectTasks({ data: projectId }),
	});
