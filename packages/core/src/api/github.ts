/**
 * GitHub on a time entry and on a project: the commits and pull requests a
 * person attaches as evidence, and the repositories an admin links to a
 * project.
 */

import type {
	PullRequestActivityKind,
	PullRequestReviewState,
} from "../lib/github-activity";

/** `GET /api/v1/orgs/$slug/github/commits?projectId&date` — a commit of the
 *  caller on that day, in a repository of the project. */
export type ApiCommitSuggestion = {
	projectGithubRepoId: string;
	repoFullName: string;
	sha: string;
	message: string;
	authorLogin: string | null;
	/** An instant, ISO 8601. */
	committedAt: string;
	url: string;
};

export const toApiCommitSuggestion = (row: {
	projectGithubRepoId: string;
	repoFullName: string;
	sha: string;
	message: string;
	authorLogin: string | null;
	committedAt: Date;
	url: string;
}): ApiCommitSuggestion => ({
	projectGithubRepoId: row.projectGithubRepoId,
	repoFullName: row.repoFullName,
	sha: row.sha,
	message: row.message,
	authorLogin: row.authorLogin,
	committedAt: row.committedAt.toISOString(),
	url: row.url,
});

/** `GET /api/v1/orgs/$slug/time-entries/$id/commits` — a commit attached to
 *  the entry. The text is a copy from the time it was attached. */
export type ApiAttachedCommit = {
	/** The attachment's id, for `DELETE …/commits/$commitId`. */
	id: string;
	sha: string;
	message: string;
	authorLogin: string | null;
	committedAt: string;
	url: string;
	/** Null when the repository was unlinked later. */
	repoFullName: string | null;
};

export const toApiAttachedCommit = (row: {
	id: string;
	sha: string;
	message: string;
	authorLogin: string | null;
	committedAt: Date;
	url: string;
	repo: { fullName: string } | null;
}): ApiAttachedCommit => ({
	id: row.id,
	sha: row.sha,
	message: row.message,
	authorLogin: row.authorLogin,
	committedAt: row.committedAt.toISOString(),
	url: row.url,
	repoFullName: row.repo?.fullName ?? null,
});

/** One thing the caller did on a pull request. */
export type ApiPullRequestEvent = {
	kind: PullRequestActivityKind;
	/** Only on `reviewed`. */
	reviewState: PullRequestReviewState | null;
	occurredAt: string;
};

/** `GET /api/v1/orgs/$slug/github/pull-requests?projectId&date` — a pull
 *  request the caller worked on that day. */
export type ApiPullRequestSuggestion = {
	projectGithubRepoId: string;
	repoFullName: string;
	number: number;
	title: string;
	url: string;
	activity: ApiPullRequestEvent[];
};

export const toApiPullRequestSuggestion = (row: {
	projectGithubRepoId: string;
	repoFullName: string;
	number: number;
	title: string;
	url: string;
	activity: {
		kind: PullRequestActivityKind;
		reviewState: PullRequestReviewState | null;
		occurredAt: Date;
	}[];
}): ApiPullRequestSuggestion => ({
	projectGithubRepoId: row.projectGithubRepoId,
	repoFullName: row.repoFullName,
	number: row.number,
	title: row.title,
	url: row.url,
	activity: row.activity.map((event) => ({
		kind: event.kind,
		reviewState: event.reviewState,
		occurredAt: event.occurredAt.toISOString(),
	})),
});

/** `GET /api/v1/orgs/$slug/time-entries/$id/pull-requests` — one pull
 *  request event attached to the entry. One row for each event, not for each
 *  pull request. */
export type ApiAttachedPullRequest = {
	/** The attachment's id, for `DELETE …/pull-requests/$activityId`. */
	id: string;
	kind: PullRequestActivityKind;
	reviewState: PullRequestReviewState | null;
	number: number;
	title: string;
	pullRequestUrl: string;
	/** The review's own link for `reviewed`, the pull request's otherwise. */
	url: string;
	occurredAt: string;
	repoFullName: string | null;
};

export const toApiAttachedPullRequest = (row: {
	id: string;
	kind: PullRequestActivityKind;
	reviewState: PullRequestReviewState | null;
	number: number;
	title: string;
	pullRequestUrl: string;
	url: string;
	occurredAt: Date;
	repo: { fullName: string } | null;
}): ApiAttachedPullRequest => ({
	id: row.id,
	kind: row.kind,
	reviewState: row.reviewState,
	number: row.number,
	title: row.title,
	pullRequestUrl: row.pullRequestUrl,
	url: row.url,
	occurredAt: row.occurredAt.toISOString(),
	repoFullName: row.repo?.fullName ?? null,
});

/** `GET /api/v1/orgs/$slug/projects/$id/repositories` — a repository linked
 *  to the project. */
export type ApiProjectRepository = {
	/** The link's id, for `DELETE …/repositories/$repositoryId`. */
	id: string;
	projectId: string;
	githubRepoId: number;
	/** Null for a link from before installations. */
	installationId: number | null;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	createdAt: string;
};

export const toApiProjectRepository = (row: {
	id: string;
	projectId: string;
	githubRepoId: number;
	installationId: number | null;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	createdAt: Date;
}): ApiProjectRepository => ({
	id: row.id,
	projectId: row.projectId,
	githubRepoId: row.githubRepoId,
	installationId: row.installationId,
	owner: row.owner,
	name: row.name,
	fullName: row.fullName,
	private: row.private,
	createdAt: row.createdAt.toISOString(),
});

/** A repository that a connected installation can read. */
export type ApiAvailableRepository = {
	githubRepoId: number;
	installationId: number;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	/** The project that holds it. A repository belongs to one project. */
	linkedTo: { projectId: string; projectName: string | null } | null;
};

/** `GET /api/v1/orgs/$slug/workspace-integrations/github/repositories` —
 *  the repositories an admin can link. */
export type ApiAvailableRepositories = {
	repositories: ApiAvailableRepository[];
	/** When the oldest list in the answer came from GitHub, or null. */
	fetchedAt: string | null;
};

export const toApiAvailableRepositories = (row: {
	repos: {
		githubRepoId: number;
		installationId: number;
		owner: string;
		name: string;
		fullName: string;
		private: boolean;
		linkedTo: { projectId: string; projectName: string | null } | null;
	}[];
	fetchedAt: Date | null;
}): ApiAvailableRepositories => ({
	repositories: row.repos.map((repo) => ({
		githubRepoId: repo.githubRepoId,
		installationId: repo.installationId,
		owner: repo.owner,
		name: repo.name,
		fullName: repo.fullName,
		private: repo.private,
		linkedTo: repo.linkedTo
			? {
					projectId: repo.linkedTo.projectId,
					projectName: repo.linkedTo.projectName,
				}
			: null,
	})),
	fetchedAt: row.fetchedAt?.toISOString() ?? null,
});
