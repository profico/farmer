/**
 * The answers of the Day view's helpers that read other systems: "Assemble
 * my day", the calendar meetings, and the GitHub commits and pull requests on
 * an entry and on a project. The rules of `schemas.ts` apply: an unknown
 * field is dropped, and a value from an open set is read as a string.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const daySuggestionSchema = z.object({
	/** Stable in one answer: `meeting:<eventId>`, `work:<projectId>`,
	 *  `review:<url>`, `break` or `fill`. */
	key: z.string(),
	/** `meeting`, `work`, `review`, `break` or `fill`. */
	kind: z.string(),
	taskId: z.string(),
	taskName: z.string(),
	projectId: z.string().nullable(),
	projectName: z.string().nullable(),
	description: z.string(),
	durationSeconds: z.number(),
	fillsDay: z.boolean(),
	meetingUrl: z.string().nullable(),
	calendarEventId: z.string().nullable(),
	commits: z.array(
		z.object({
			projectGithubRepoId: z.string(),
			sha: z.string(),
			message: z.string(),
			repoFullName: z.string(),
		}),
	),
	pullRequests: z.array(
		z.object({
			projectGithubRepoId: z.string(),
			number: z.number(),
			title: z.string(),
			repoFullName: z.string(),
			/** What the person did on it that day, oldest first. */
			kinds: z.array(z.string()),
		}),
	),
	/** The person deleted it before. Show it, but not ticked. */
	dismissed: z.boolean(),
});
export type DaySuggestion = z.output<typeof daySuggestionSchema>;

export const dayAssemblySchema = z.object({
	/** A day, yyyy-MM-dd. */
	date: z.string(),
	targetSeconds: z.number(),
	loggedSeconds: z.number(),
	suggestions: z.array(daySuggestionSchema),
	/** `ok`, or `unavailable` when the account is not connected. */
	sources: z.object({ calendar: z.string(), github: z.string() }),
	/** How many suggestions `includeDismissed=true` adds. */
	dismissedCount: z.number(),
});
export type DayAssembly = z.output<typeof dayAssemblySchema>;

export const dayAssemblyResultSchema = z.object({
	created: z.number(),
	/** A sentence for each entry that was not made. */
	errors: z.array(z.string()),
});
export type DayAssemblyResult = z.output<typeof dayAssemblyResultSchema>;

export const calendarEventSchema = z.object({
	id: z.string(),
	title: z.string(),
	/** An instant, ISO 8601. */
	start: z.string(),
	/** An instant, ISO 8601. */
	end: z.string(),
	meetingUrl: z.string().nullable(),
	htmlLink: z.string().nullable(),
});
export type CalendarEvent = z.output<typeof calendarEventSchema>;

export const commitSuggestionSchema = z.object({
	projectGithubRepoId: z.string(),
	repoFullName: z.string(),
	sha: z.string(),
	message: z.string(),
	authorLogin: z.string().nullable(),
	/** An instant, ISO 8601. */
	committedAt: z.string(),
	url: z.string(),
});
export type CommitSuggestion = z.output<typeof commitSuggestionSchema>;

export const attachedCommitSchema = z.object({
	/** The attachment's id, for `detachCommit`. */
	id: z.string(),
	sha: z.string(),
	message: z.string(),
	authorLogin: z.string().nullable(),
	committedAt: z.string(),
	url: z.string(),
	/** Null when the repository was unlinked later. */
	repoFullName: z.string().nullable(),
});
export type AttachedCommit = z.output<typeof attachedCommitSchema>;

export const pullRequestSuggestionSchema = z.object({
	projectGithubRepoId: z.string(),
	repoFullName: z.string(),
	number: z.number(),
	title: z.string(),
	url: z.string(),
	activity: z.array(
		z.object({
			/** `opened`, `merged`, `closed` or `reviewed`. */
			kind: z.string(),
			/** Only on `reviewed`. */
			reviewState: z.string().nullable(),
			occurredAt: z.string(),
		}),
	),
});
export type PullRequestSuggestion = z.output<
	typeof pullRequestSuggestionSchema
>;

export const attachedPullRequestSchema = z.object({
	/** The attachment's id, for `detachPullRequest`. */
	id: z.string(),
	kind: z.string(),
	reviewState: z.string().nullable(),
	number: z.number(),
	title: z.string(),
	pullRequestUrl: z.string(),
	/** The review's own link for `reviewed`, the pull request's otherwise. */
	url: z.string(),
	occurredAt: z.string(),
	repoFullName: z.string().nullable(),
});
export type AttachedPullRequest = z.output<typeof attachedPullRequestSchema>;

export const projectRepositorySchema = z.object({
	/** The link's id, for `unlinkProjectRepository`. */
	id: z.string(),
	projectId: z.string(),
	githubRepoId: z.number(),
	installationId: z.number().nullable(),
	owner: z.string(),
	name: z.string(),
	fullName: z.string(),
	private: z.boolean(),
	createdAt: z.string(),
});
export type ProjectRepository = z.output<typeof projectRepositorySchema>;

export const availableRepositoriesSchema = z.object({
	repositories: z.array(
		z.object({
			githubRepoId: z.number(),
			installationId: z.number(),
			owner: z.string(),
			name: z.string(),
			fullName: z.string(),
			private: z.boolean(),
			/** The project that holds it. A repository belongs to one project. */
			linkedTo: z
				.object({
					projectId: z.string(),
					projectName: z.string().nullable(),
				})
				.nullable(),
		}),
	),
	/** When the oldest list in the answer came from GitHub, or null. */
	fetchedAt: z.string().nullable(),
});
export type AvailableRepositories = z.output<
	typeof availableRepositoriesSchema
>;
export type AvailableRepository = AvailableRepositories["repositories"][number];

// Each answer the document describes must parse with the schema above.
export type DayContractChecks = [
	Expect<Parses<Schemas["DayAssembly"], typeof dayAssemblySchema>>,
	Expect<Parses<Schemas["DayAssemblyResult"], typeof dayAssemblyResultSchema>>,
	Expect<Parses<Schemas["CalendarEvent"], typeof calendarEventSchema>>,
	Expect<Parses<Schemas["CommitSuggestion"], typeof commitSuggestionSchema>>,
	Expect<Parses<Schemas["AttachedCommit"], typeof attachedCommitSchema>>,
	Expect<
		Parses<Schemas["PullRequestSuggestion"], typeof pullRequestSuggestionSchema>
	>,
	Expect<
		Parses<Schemas["AttachedPullRequest"], typeof attachedPullRequestSchema>
	>,
	Expect<Parses<Schemas["ProjectRepository"], typeof projectRepositorySchema>>,
	Expect<
		Parses<Schemas["AvailableRepositories"], typeof availableRepositoriesSchema>
	>,
];
