import { queryOptions } from "@tanstack/react-query";
import {
	listMyProjects,
	listProjectMembers,
	listProjects,
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

export const projectMembersQuery = (projectId: string) =>
	queryOptions({
		queryKey: ["projects", "members", projectId],
		queryFn: () => listProjectMembers({ data: projectId }),
	});
