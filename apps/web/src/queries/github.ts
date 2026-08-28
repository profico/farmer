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

export const githubConnectionStatusQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).github, "connection-status"],
		queryFn: () => getGithubConnectionStatus(),
	});

export const githubInstallationsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).github, "installations"],
		queryFn: () => listGithubInstallations(),
	});

export const projectGithubReposQuery = (org: string, projectId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).github, "project-repos", projectId],
		queryFn: () => listProjectGithubRepos({ data: projectId }),
	});

export const availableGithubReposQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).github, "available-repos"],
		queryFn: () => listAvailableGithubRepos(),
	});

export const attachedCommitsQuery = (org: string, timeEntryId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).github, "attached-commits", timeEntryId],
		queryFn: () => listAttachedCommits({ data: timeEntryId }),
	});

// Commits authored by the current user on `date` across a project's linked
// repos — used to auto-populate the add-block commit picker. Enabled by the
// caller only when the "auto-load commits" toggle is on and a project is set.
export const suggestedCommitsQuery = (
	org: string,
	projectId: string,
	date: string,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).github, "suggested-commits", projectId, date],
		queryFn: () => suggestCommitsForEntry({ data: { projectId, date } }),
	});
