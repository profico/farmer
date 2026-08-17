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

export const projectMembersQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).projects, "members", projectId],
		queryFn: () => listProjectMembers({ data: projectId }),
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
