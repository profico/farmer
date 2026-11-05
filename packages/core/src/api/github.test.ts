// The GitHub projections: each one keeps the fields it names, turns each
// instant into ISO text, and nothing that the row carries beside them.

import { describe, expect, test } from "bun:test";

import {
	toApiAttachedCommit,
	toApiAttachedPullRequest,
	toApiAvailableRepositories,
	toApiCommitSuggestion,
	toApiProjectRepository,
	toApiPullRequestSuggestion,
} from "./github";

const at = new Date("2026-10-06T09:15:00Z");
const ISO = "2026-10-06T09:15:00.000Z";

/** A `project_github_repo` row with each column. */
const repoRow = {
	id: "r-1",
	organizationId: "org-1",
	projectId: "p-1",
	githubRepoId: 42,
	installationId: 7,
	owner: "profico",
	name: "farmer",
	fullName: "profico/farmer",
	private: true,
	linkedByUserId: "u-1",
	createdAt: at,
	updatedAt: at,
};

describe("the commits", () => {
	test("a suggestion keeps the commit and its repository", () => {
		expect(
			toApiCommitSuggestion({
				projectGithubRepoId: "r-1",
				repoFullName: "profico/farmer",
				sha: "abc1234",
				message: "Fix login",
				authorLogin: "ana",
				committedAt: at,
				url: "https://github.com/profico/farmer/commit/abc1234",
			}),
		).toStrictEqual({
			projectGithubRepoId: "r-1",
			repoFullName: "profico/farmer",
			sha: "abc1234",
			message: "Fix login",
			authorLogin: "ana",
			committedAt: ISO,
			url: "https://github.com/profico/farmer/commit/abc1234",
		});
	});

	test("an attached commit names its repository, and not the link row", () => {
		const row = {
			id: "c-1",
			timeEntryId: "e-1",
			projectGithubRepoId: "r-1",
			sha: "abc1234",
			message: "Fix login",
			authorLogin: null,
			committedAt: at,
			url: "https://github.com/x",
			createdAt: at,
			repo: repoRow,
		};
		expect(toApiAttachedCommit(row)).toStrictEqual({
			id: "c-1",
			sha: "abc1234",
			message: "Fix login",
			authorLogin: null,
			committedAt: ISO,
			url: "https://github.com/x",
			repoFullName: "profico/farmer",
		});
		expect(toApiAttachedCommit({ ...row, repo: null }).repoFullName).toBeNull();
	});
});

describe("the pull requests", () => {
	test("a suggestion keeps each event, with its instant as text", () => {
		expect(
			toApiPullRequestSuggestion({
				projectGithubRepoId: "r-1",
				repoFullName: "profico/farmer",
				number: 12,
				title: "Add the API",
				url: "https://github.com/profico/farmer/pull/12",
				activity: [
					{ kind: "reviewed", reviewState: "approved", occurredAt: at },
				],
			}),
		).toStrictEqual({
			projectGithubRepoId: "r-1",
			repoFullName: "profico/farmer",
			number: 12,
			title: "Add the API",
			url: "https://github.com/profico/farmer/pull/12",
			activity: [
				{ kind: "reviewed", reviewState: "approved", occurredAt: ISO },
			],
		});
	});

	test("an attached event leaves out its event id and its entry", () => {
		const row = {
			id: "a-1",
			timeEntryId: "e-1",
			projectGithubRepoId: "r-1",
			eventId: "PR_kw:merged",
			kind: "merged" as const,
			reviewState: null,
			number: 12,
			title: "Add the API",
			pullRequestUrl: "https://github.com/profico/farmer/pull/12",
			url: "https://github.com/profico/farmer/pull/12",
			occurredAt: at,
			createdAt: at,
			repo: repoRow,
		};
		expect(toApiAttachedPullRequest(row)).toStrictEqual({
			id: "a-1",
			kind: "merged",
			reviewState: null,
			number: 12,
			title: "Add the API",
			pullRequestUrl: "https://github.com/profico/farmer/pull/12",
			url: "https://github.com/profico/farmer/pull/12",
			occurredAt: ISO,
			repoFullName: "profico/farmer",
		});
	});
});

describe("the repositories", () => {
	test("a linked repository leaves out who linked it and the organization", () => {
		expect(toApiProjectRepository(repoRow)).toStrictEqual({
			id: "r-1",
			projectId: "p-1",
			githubRepoId: 42,
			installationId: 7,
			owner: "profico",
			name: "farmer",
			fullName: "profico/farmer",
			private: true,
			createdAt: ISO,
		});
	});

	test("the list to link from names the project that holds a repository", () => {
		const projected = toApiAvailableRepositories({
			repos: [
				{
					githubRepoId: 42,
					installationId: 7,
					owner: "profico",
					name: "farmer",
					fullName: "profico/farmer",
					private: true,
					linkedTo: { projectId: "p-1", projectName: "Farmer" },
				},
			],
			fetchedAt: null,
		});
		expect(projected).toStrictEqual({
			repositories: [
				{
					githubRepoId: 42,
					installationId: 7,
					owner: "profico",
					name: "farmer",
					fullName: "profico/farmer",
					private: true,
					linkedTo: { projectId: "p-1", projectName: "Farmer" },
				},
			],
			fetchedAt: null,
		});
	});
});
