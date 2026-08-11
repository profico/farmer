import { queryOptions } from "@tanstack/react-query";
import {
	getProject,
	listAssignableMembers,
	listMyProjects,
	listProjectMembers,
	listProjects,
	listProjectTasks,
} from "#/server/projects.ts";

export const projectsQuery = () =>
	queryOptions({
		queryKey: ["projects"],
		queryFn: () => listProjects(),
	});

export const myProjectsQuery = () =>
	queryOptions({
		queryKey: ["projects", "mine"],
		queryFn: () => listMyProjects(),
	});

export const projectQuery = (projectId: string) =>
	queryOptions({
		queryKey: ["projects", "detail", projectId],
		queryFn: () => getProject({ data: projectId }),
	});

export const projectMembersQuery = (projectId: string) =>
	queryOptions({
		queryKey: ["projects", "members", projectId],
		queryFn: () => listProjectMembers({ data: projectId }),
	});

export const assignableMembersQuery = (projectId: string) =>
	queryOptions({
		queryKey: ["projects", "assignable", projectId],
		queryFn: () => listAssignableMembers({ data: projectId }),
	});

export const projectTasksQuery = (projectId: string) =>
	queryOptions({
		queryKey: ["projects", "tasks", projectId],
		queryFn: () => listProjectTasks({ data: projectId }),
	});
