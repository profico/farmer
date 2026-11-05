/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	activityDescription,
	activitySummary,
	groupAttachedPullRequests,
	nextNote,
	summarizeCommitMessages,
} from "./github";

describe("GitHub on an entry", () => {
	test("labels each different act once, in order", () => {
		expect(
			activitySummary([
				{ kind: "opened", reviewState: null },
				{ kind: "reviewed", reviewState: "approved" },
				{ kind: "reviewed", reviewState: "approved" },
			]),
		).toBe("Opened · Reviewed (approved)");
	});

	test("groups the attached events by pull request", () => {
		const row = (id: string, kind: string, url: string) => ({
			id,
			kind,
			reviewState: null,
			number: 4,
			title: "Login",
			pullRequestUrl: url,
			url,
			occurredAt: "2026-10-06T09:00:00Z",
			repoFullName: "a/x",
		});
		const groups = groupAttachedPullRequests([
			row("1", "opened", "u1"),
			row("2", "merged", "u1"),
			row("3", "opened", "u2"),
		]);
		expect(groups.map((g) => g.ids)).toEqual([["1", "2"], ["3"]]);
	});

	test("writes the note from the subjects and the acts", () => {
		expect(
			summarizeCommitMessages(["Fix login\n\nbody", " ", "Add test"]),
		).toBe("Fix login; Add test");
		expect(
			activityDescription(
				[
					{
						projectGithubRepoId: "r1",
						repoFullName: "a/x",
						sha: "abc",
						message: "Fix login",
						authorLogin: null,
						committedAt: "2026-10-06T09:00:00Z",
						url: "u",
					},
				],
				[
					{
						projectGithubRepoId: "r1",
						repoFullName: "a/x",
						number: 4,
						title: "Login",
						url: "u4",
						activity: [
							{ kind: "reviewed", reviewState: "approved", occurredAt: "" },
							{ kind: "reviewed", reviewState: "commented", occurredAt: "" },
						],
					},
				],
			),
		).toBe("Fix login; Reviewed #4: Login");
	});

	test("writes the note only while the person did not type in it", () => {
		expect(nextNote("", null, "Fix login")).toBe("Fix login");
		expect(nextNote("Fix login", "Fix login", "Fix; Add")).toBe("Fix; Add");
		expect(nextNote("My own words", "Fix login", "Fix; Add")).toBeNull();
	});
});
