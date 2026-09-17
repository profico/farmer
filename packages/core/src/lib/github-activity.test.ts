// Which day a pull request event belongs to, and whose it is.
//
// Every rule in `pullRequestActivity` decides what evidence lands on which
// person's day, and a wrong one is invisible in the UI: a review filed on the
// wrong day just makes that day look worked.

import { describe, expect, test } from "bun:test";

import {
	describePullRequestActivity,
	pullRequestActivity,
} from "./github-activity";
import type {
	GithubPullRequest,
	GithubPullRequestReview,
} from "./github-client";

const WINDOW = {
	start: new Date("2026-09-01T00:00:00Z"),
	end: new Date("2026-09-02T00:00:00Z"),
};

const INSIDE = "2026-09-01T10:00:00Z";

const BEFORE = "2026-08-31T23:59:59Z";

/** The first instant of the NEXT day — outside, since the window is half-open. */
const AT_END = "2026-09-02T00:00:00Z";

const review = (
	fields: Partial<GithubPullRequestReview> = {},
): GithubPullRequestReview => ({
	id: "PRR_1",
	state: "APPROVED",
	submittedAt: INSIDE,
	url: "https://github.com/acme/api/pull/7#pullrequestreview-1",
	author: { login: "me" },
	...fields,
});

const pullRequest = (
	fields: Partial<GithubPullRequest> = {},
): GithubPullRequest => ({
	id: "PR_1",
	number: 7,
	title: "Fix login",
	url: "https://github.com/acme/api/pull/7",
	createdAt: BEFORE,
	closedAt: null,
	mergedAt: null,
	merged: false,
	state: "OPEN",
	author: { login: "someone" },
	reviews: { nodes: [] },
	...fields,
});

const kindsFor = (pr: GithubPullRequest, login = "me") =>
	pullRequestActivity(pr, login, WINDOW).map((event) => event.kind);

describe("pullRequestActivity", () => {
	test("dates each of the author's events by its own timestamp", () => {
		const mine = {
			author: { login: "me" },
			merged: true,
			state: "MERGED" as const,
		};

		expect(
			kindsFor(pullRequest({ ...mine, createdAt: INSIDE, mergedAt: AT_END })),
		).toEqual(["opened"]);
		expect(
			kindsFor(pullRequest({ ...mine, createdAt: BEFORE, mergedAt: INSIDE })),
		).toEqual(["merged"]);
	});

	test("a merged pull request is merged, not closed as well", () => {
		expect(
			kindsFor(
				pullRequest({
					author: { login: "me" },
					merged: true,
					state: "MERGED",
					mergedAt: INSIDE,
					closedAt: INSIDE,
				}),
			),
		).toEqual(["merged"]);
	});

	test("closing without a merge is the author's event only", () => {
		const closed = { state: "CLOSED" as const, closedAt: INSIDE };
		expect(
			kindsFor(pullRequest({ ...closed, author: { login: "me" } })),
		).toEqual(["closed"]);
		expect(kindsFor(pullRequest(closed))).toEqual([]);
	});

	test("a merge is the author's event, not the event of whoever merged it", () => {
		expect(
			kindsFor(
				pullRequest({
					merged: true,
					state: "MERGED",
					mergedAt: INSIDE,
				}),
			),
		).toEqual([]);
	});

	test("one event per submitted review, and a pending review was never submitted", () => {
		const events = pullRequestActivity(
			pullRequest({
				reviews: {
					nodes: [
						review({ id: "PRR_1", state: "CHANGES_REQUESTED" }),
						review({ id: "PRR_2", state: "APPROVED" }),
						review({ id: "PRR_3", state: "PENDING" }),
						null,
					],
				},
			}),
			"me",
			WINDOW,
		);

		expect(events.map((event) => [event.eventId, event.reviewState])).toEqual([
			["PRR_1", "changes_requested"],
			["PRR_2", "approved"],
		]);
	});

	test("a reply on your own pull request is not a review", () => {
		expect(
			kindsFor(
				pullRequest({
					author: { login: "me" },
					reviews: { nodes: [review({ state: "COMMENTED" })] },
				}),
			),
		).toEqual([]);
	});

	test("somebody else's review is not yours, and logins compare without case", () => {
		const reviewedBySomeoneElse = pullRequest({
			reviews: { nodes: [review({ author: { login: "other" } })] },
		});

		expect(kindsFor(reviewedBySomeoneElse)).toEqual([]);

		const reviewedByMe = pullRequest({ reviews: { nodes: [review()] } });
		expect(kindsFor(reviewedByMe, "ME")).toEqual(["reviewed"]);
	});

	test("the window is half-open: its end belongs to the next day", () => {
		expect(
			kindsFor(pullRequest({ author: { login: "me" }, createdAt: AT_END })),
		).toEqual([]);
		expect(
			kindsFor(
				pullRequest({ reviews: { nodes: [review({ submittedAt: AT_END })] } }),
			),
		).toEqual([]);
	});

	test("event ids are stable across reads, so a re-run adds nothing", () => {
		const pr = pullRequest({
			author: { login: "me" },
			createdAt: INSIDE,
			merged: true,
			state: "MERGED",
			mergedAt: INSIDE,
		});

		expect(
			pullRequestActivity(pr, "me", WINDOW).map((event) => event.eventId),
		).toEqual(["PR_1:opened", "PR_1:merged"]);
	});
});

describe("describePullRequestActivity", () => {
	test("says each act once, however many review rounds it took", () => {
		expect(
			describePullRequestActivity([
				{ kind: "reviewed", number: 7, title: "Fix login" },
				{ kind: "reviewed", number: 7, title: "Fix login" },
				{ kind: "opened", number: 9, title: "Add export" },
			]),
		).toEqual(["Reviewed #7: Fix login", "Opened #9: Add export"]);
	});
});
