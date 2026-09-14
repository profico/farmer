// Substitutable sources for the two external signals the write-on-read engines
// consume: calendar events and commits.
//
// Both engines previously reached the network through a static ESM import of a
// module of free functions, each calling the global `fetch` against a literal
// base URL. There was no parameter, no interface and no registry — so the
// densest logic in the codebase (reissued-event dedup, tombstones,
// delete-by-absence with its empty-set guard) could not be exercised at all
// without standing up Google.
//
// The seam is at the SERVICE, not at the http client, because that is what the
// engines actually call and because the service is where "the account isn't
// connected" is turned into `null` — a distinction the engines branch on and
// therefore need to be able to reproduce.
//
// Two adapters justify it: the real service in production, an in-memory one in
// tests. A single-adapter port would just be indirection.

import { githubService } from "./github.service";
import { googleCalendarService } from "./google-calendar.service";

export type CalendarSource = Pick<
	typeof googleCalendarService,
	"listEventsForDay" | "listEventsForRange"
>;

export type CommitSource = Pick<
	typeof githubService,
	"listUserCommitsForDay" | "listUserCommitsByDay"
>;

// Its own port rather than two more methods on CommitSource: a test that fakes
// commits then reads no pull requests unless it says so, because the real
// service answers [] for a person with no linked GitHub account.
export type PullRequestSource = Pick<
	typeof githubService,
	"listUserPullRequestActivityForDay" | "listUserPullRequestActivityByDay"
>;

let calendarOverride: CalendarSource | null = null;
let commitOverride: CommitSource | null = null;
let pullRequestOverride: PullRequestSource | null = null;

/** The pull request activity the engines should read. */
export const pullRequestSource = (): PullRequestSource =>
	pullRequestOverride ?? githubService;

/** Test-only: substitute an in-memory adapter. Pass null to restore. */
export const setPullRequestSourceForTests = (
	source: PullRequestSource | null,
): void => {
	pullRequestOverride = source;
};

/** The calendar the engines should read. */
export const calendarSource = (): CalendarSource =>
	calendarOverride ?? googleCalendarService;

/** The commit log the engines should read. */
export const commitSource = (): CommitSource => commitOverride ?? githubService;

/** Test-only: substitute an in-memory adapter. Pass null to restore. */
export const setCalendarSourceForTests = (
	source: CalendarSource | null,
): void => {
	calendarOverride = source;
};

/** Test-only: substitute an in-memory adapter. Pass null to restore. */
export const setCommitSourceForTests = (source: CommitSource | null): void => {
	commitOverride = source;
};
