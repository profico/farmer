/**
 * The Day view's helpers that read other systems: "Assemble my day" and the
 * calendar meeting picker. Each route acts as the caller on their own day,
 * as in the web app.
 */

import type { PullRequestActivityKind } from "../lib/github-activity";

/** A commit that a suggestion attaches when it is applied. */
export type ApiDaySuggestionCommit = {
	projectGithubRepoId: string;
	sha: string;
	message: string;
	repoFullName: string;
};

/** A pull request that a suggestion attaches when it is applied. */
export type ApiDaySuggestionPullRequest = {
	projectGithubRepoId: string;
	number: number;
	title: string;
	repoFullName: string;
	/** What the person did on it that day, oldest first. */
	kinds: PullRequestActivityKind[];
};

/** One proposed entry. Send it back in `POST …/day-assembly` to make it. */
export type ApiDaySuggestion = {
	/** Stable in one answer: `meeting:<eventId>`, `work:<projectId>`,
	 *  `review:<url>`, `break` or `fill`. */
	key: string;
	kind: "meeting" | "work" | "review" | "break" | "fill";
	taskId: string;
	taskName: string;
	projectId: string | null;
	projectName: string | null;
	description: string;
	durationSeconds: number;
	fillsDay: boolean;
	meetingUrl: string | null;
	calendarEventId: string | null;
	commits: ApiDaySuggestionCommit[];
	pullRequests: ApiDaySuggestionPullRequest[];
	/** The person deleted it before. Show it, but not ticked. */
	dismissed: boolean;
};

/** `GET /api/v1/orgs/$slug/day-assembly?date` — what the day is missing. */
export type ApiDayAssembly = {
	date: string;
	targetSeconds: number;
	loggedSeconds: number;
	suggestions: ApiDaySuggestion[];
	/** `unavailable`: the account is not connected, so that source said
	 *  nothing. */
	sources: {
		calendar: "ok" | "unavailable";
		github: "ok" | "unavailable";
	};
	/** How many suggestions `includeDismissed=true` adds. */
	dismissedCount: number;
};

export const toApiDayAssembly = (row: ApiDayAssembly): ApiDayAssembly => ({
	date: row.date,
	targetSeconds: row.targetSeconds,
	loggedSeconds: row.loggedSeconds,
	suggestions: row.suggestions.map((suggestion) => ({
		key: suggestion.key,
		kind: suggestion.kind,
		taskId: suggestion.taskId,
		taskName: suggestion.taskName,
		projectId: suggestion.projectId,
		projectName: suggestion.projectName,
		description: suggestion.description,
		durationSeconds: suggestion.durationSeconds,
		fillsDay: suggestion.fillsDay,
		meetingUrl: suggestion.meetingUrl,
		calendarEventId: suggestion.calendarEventId,
		commits: suggestion.commits.map((commit) => ({
			projectGithubRepoId: commit.projectGithubRepoId,
			sha: commit.sha,
			message: commit.message,
			repoFullName: commit.repoFullName,
		})),
		pullRequests: suggestion.pullRequests.map((pr) => ({
			projectGithubRepoId: pr.projectGithubRepoId,
			number: pr.number,
			title: pr.title,
			repoFullName: pr.repoFullName,
			kinds: [...pr.kinds],
		})),
		dismissed: suggestion.dismissed,
	})),
	sources: { calendar: row.sources.calendar, github: row.sources.github },
	dismissedCount: row.dismissedCount,
});

/** `POST /api/v1/orgs/$slug/day-assembly` — best effort for each entry:
 *  one that fails does not stop the others. */
export type ApiDayAssemblyResult = {
	created: number;
	/** A sentence for each entry that was not made. */
	errors: string[];
};

export const toApiDayAssemblyResult = (
	row: ApiDayAssemblyResult,
): ApiDayAssemblyResult => ({ created: row.created, errors: [...row.errors] });

/** `GET /api/v1/orgs/$slug/calendar/events?date` — one timed meeting from
 *  the person's Google Calendar, for the entry picker. */
export type ApiCalendarEvent = {
	id: string;
	title: string;
	/** An instant, ISO 8601. */
	start: string;
	/** An instant, ISO 8601. */
	end: string;
	meetingUrl: string | null;
	htmlLink: string | null;
};

export const toApiCalendarEvent = (
	row: ApiCalendarEvent,
): ApiCalendarEvent => ({
	id: row.id,
	title: row.title,
	start: row.start,
	end: row.end,
	meetingUrl: row.meetingUrl,
	htmlLink: row.htmlLink,
});
