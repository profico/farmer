/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import type { DaySuggestion } from "@farmer/api-client";

import {
	applyBody,
	assemblyMessage,
	defaultSelection,
	missingSources,
	suggestionSource,
	suggestionTitle,
} from "./assembly";

const suggestion = (fields: Partial<DaySuggestion>): DaySuggestion => ({
	key: "work:p1",
	kind: "work",
	taskId: "t1",
	taskName: "Development",
	projectId: "p1",
	projectName: "Atlas",
	description: "Fix login",
	durationSeconds: 7200,
	fillsDay: false,
	meetingUrl: null,
	calendarEventId: null,
	commits: [],
	pullRequests: [],
	dismissed: false,
	...fields,
});

const commit = (repoFullName: string, sha: string) => ({
	projectGithubRepoId: "r1",
	sha,
	message: "Fix",
	repoFullName,
});

describe("assemble my day", () => {
	test("names each kind of suggestion", () => {
		expect(suggestionTitle(suggestion({}))).toBe("Atlas");
		expect(
			suggestionTitle(suggestion({ kind: "meeting", description: "" })),
		).toBe("Meeting");
		expect(suggestionTitle(suggestion({ kind: "break" }))).toBe("Break");
		expect(suggestionTitle(suggestion({ kind: "fill" }))).toBe(
			"Work, rest of the day",
		);
	});

	test("names one repository only when all the evidence agrees", () => {
		expect(
			suggestionSource(
				suggestion({ commits: [commit("a/x", "1"), commit("a/x", "2")] }),
			),
		).toBe("From 2 commits in a/x");
		expect(
			suggestionSource(
				suggestion({
					commits: [commit("a/x", "1")],
					pullRequests: [
						{
							projectGithubRepoId: "r2",
							number: 4,
							title: "Login",
							repoFullName: "a/y",
							kinds: ["opened"],
						},
					],
				}),
			),
		).toBe("From 1 commit and 1 pull request");
		expect(suggestionSource(suggestion({ kind: "fill" }))).toBe(
			"Assumed from your working hours",
		);
	});

	test("ticks all but the suggestions deleted before", () => {
		expect(
			defaultSelection([
				suggestion({ key: "a" }),
				suggestion({ key: "b", dismissed: true }),
			]),
		).toEqual(new Set(["a"]));
	});

	test("sends no length for a rest-of-day block, and the person's pick", () => {
		const body = applyBody(
			"2026-10-06",
			[
				suggestion({ commits: [commit("a/x", "abc")] }),
				suggestion({ key: "fill", kind: "fill", fillsDay: true }),
			],
			(s) =>
				s.key === "fill"
					? { projectId: null, taskId: "t9" }
					: { projectId: s.projectId, taskId: s.taskId },
		);
		expect(body.entries).toEqual([
			{
				taskId: "t1",
				projectId: "p1",
				description: "Fix login",
				durationSeconds: 7200,
				fillsDay: undefined,
				meetingUrl: undefined,
				calendarEventId: undefined,
				commits: [{ projectGithubRepoId: "r1", sha: "abc" }],
				pullRequests: undefined,
			},
			{
				taskId: "t9",
				projectId: undefined,
				description: "Fix login",
				durationSeconds: undefined,
				fillsDay: true,
				meetingUrl: undefined,
				calendarEventId: undefined,
				commits: undefined,
				pullRequests: undefined,
			},
		]);
	});

	test("says what failed", () => {
		expect(assemblyMessage({ created: 1, errors: [] })).toEqual({
			message: "Added 1 block.",
			warning: false,
		});
		expect(assemblyMessage({ created: 2, errors: ["No note."] })).toEqual({
			message: "Added 2 blocks, 1 failed: No note.",
			warning: true,
		});
	});

	test("names the sources that are not connected", () => {
		expect(missingSources({ calendar: "unavailable", github: "ok" })).toEqual([
			"Google Calendar",
		]);
		expect(missingSources({ calendar: "ok", github: "ok" })).toEqual([]);
	});
});
