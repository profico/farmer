// What a pull request says a person did, and when.
//
// Pure, and apart from the client, because it is the one part of the PR
// evidence that has rules in it — and every one of them is a decision about
// which day a piece of work belongs to:
//
//   - `opened`   the person authored it; dated by `createdAt`.
//   - `merged`   the person authored it; dated by `mergedAt`. Whoever pressed
//                the merge button did not do the work, so a merge of somebody
//                else's PR is not an event for them.
//   - `closed`   the person authored it and it closed without a merge; dated by
//                `closedAt`. A merged PR is closed too, and saying so twice
//                would be two events for one act.
//   - `reviewed` one per submitted review; dated by `submittedAt`. A PENDING
//                review was never sent, so it is nobody's evidence yet.
//
// A "review" on your own PR is not counted. GitHub records every reply in a
// review thread as a COMMENTED review, so on the author's own PR it is the
// conversation after the work, and it already sits beside that PR's own events.

import type { GithubPullRequest } from "./github-client";

export type PullRequestActivityKind =
	| "opened"
	| "merged"
	| "closed"
	| "reviewed";

export type PullRequestReviewState =
	| "approved"
	| "changes_requested"
	| "commented"
	| "dismissed";

export type PullRequestActivity = {
	/** Stable per event — what a re-run de-duplicates on. */
	eventId: string;
	kind: PullRequestActivityKind;
	reviewState: PullRequestReviewState | null;
	number: number;
	title: string;
	pullRequestUrl: string;
	url: string;
	occurredAt: Date;
};

const REVIEW_STATES = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes_requested",
	COMMENTED: "commented",
	DISMISSED: "dismissed",
	PENDING: null,
} as const;

const sameLogin = (a: string | null | undefined, b: string): boolean =>
	!!a && a.toLowerCase() === b.toLowerCase();

/** The instant, when it falls in `[start, end)`. An unparseable timestamp is
 *  NaN, which fails both comparisons, so it is left out rather than misdated. */
const within = (
	iso: string | null,
	window: { start: Date; end: Date },
): Date | null => {
	if (!iso) return null;
	const at = new Date(iso);

	return at >= window.start && at < window.end ? at : null;
};

export const pullRequestActivity = (
	pr: GithubPullRequest,
	login: string,
	window: { start: Date; end: Date },
): PullRequestActivity[] => {
	const base = {
		number: pr.number,
		title: pr.title,
		pullRequestUrl: pr.url,
	};

	const events: PullRequestActivity[] = [];
	const authored = sameLogin(pr.author?.login, login);

	const openedAt = authored ? within(pr.createdAt, window) : null;

	if (openedAt) {
		events.push({
			...base,
			eventId: `${pr.id}:opened`,
			kind: "opened",
			reviewState: null,
			url: pr.url,
			occurredAt: openedAt,
		});
	}

	const mergedAt = authored && pr.merged ? within(pr.mergedAt, window) : null;

	if (mergedAt) {
		events.push({
			...base,
			eventId: `${pr.id}:merged`,
			kind: "merged",
			reviewState: null,
			url: pr.url,
			occurredAt: mergedAt,
		});
	}

	const closedAt =
		authored && !pr.merged && pr.state === "CLOSED"
			? within(pr.closedAt, window)
			: null;

	if (closedAt) {
		events.push({
			...base,
			eventId: `${pr.id}:closed`,
			kind: "closed",
			reviewState: null,
			url: pr.url,
			occurredAt: closedAt,
		});
	}

	if (!authored) {
		for (const review of pr.reviews?.nodes ?? []) {
			if (!review || !sameLogin(review.author?.login, login)) continue;
			const reviewState = REVIEW_STATES[review.state];
			const submittedAt = within(review.submittedAt, window);

			if (!reviewState || !submittedAt) continue;
			events.push({
				...base,
				eventId: review.id,
				kind: "reviewed",
				reviewState,
				url: review.url,
				occurredAt: submittedAt,
			});
		}
	}

	return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
};

const VERBS = {
	opened: "Opened",
	merged: "Merged",
	closed: "Closed",
	reviewed: "Reviewed",
} satisfies { [K in PullRequestActivityKind]: string };

/**
 * One line per distinct act, for an entry's description.
 *
 * De-duplicated because three review rounds on one PR are three events but one
 * thing to read: "Reviewed #12: Fix login" once, not three times over.
 */
export const describePullRequestActivity = (
	activity: Pick<PullRequestActivity, "kind" | "number" | "title">[],
): string[] => [
	...new Set(activity.map((a) => `${VERBS[a.kind]} #${a.number}: ${a.title}`)),
];
