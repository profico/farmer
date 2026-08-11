import { queryOptions } from "@tanstack/react-query";
import {
	getGithubConnectionStatus,
	listAttachedCommits,
	listAvailableGithubRepos,
	listGithubInstallations,
	listProjectGithubRepos,
	suggestCommitsForEntry,
} from "#/server/github.ts";
import { queryKeys } from "./keys.ts";

export const githubConnectionStatusQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.github, "connection-status"],
		queryFn: () => getGithubConnectionStatus(),
	});

export const githubInstallationsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.github, "installations"],
		queryFn: () => listGithubInstallations(),
	});

export const projectGithubReposQuery = (projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys.github, "project-repos", projectId],
		queryFn: () => listProjectGithubRepos({ data: projectId }),
	});

export const availableGithubReposQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.github, "available-repos"],
		queryFn: () => listAvailableGithubRepos(),
	});

export const attachedCommitsQuery = (timeEntryId: string) =>
	queryOptions({
		queryKey: [...queryKeys.github, "attached-commits", timeEntryId],
		queryFn: () => listAttachedCommits({ data: timeEntryId }),
	});

// Commits authored by the current user on `date` across a project's linked
// repos — used to auto-populate the add-block commit picker. Enabled by the
// caller only when the "auto-load commits" toggle is on and a project is set.
export const suggestedCommitsQuery = (projectId: string, date: string) =>
	queryOptions({
		queryKey: [...queryKeys.github, "suggested-commits", projectId, date],
		queryFn: () => suggestCommitsForEntry({ data: { projectId, date } }),
	});
