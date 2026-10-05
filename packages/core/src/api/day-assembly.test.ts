// The Day view's helpers: the projection keeps each field of the service's
// answer that the app reads, and copies its lists.

import { describe, expect, test } from "bun:test";

import { toApiCalendarEvent, toApiDayAssembly } from "./day-assembly";

describe("toApiDayAssembly", () => {
	test("keeps the suggestions with their evidence", () => {
		const assembly = {
			date: "2026-10-06",
			targetSeconds: 28_800,
			loggedSeconds: 3600,
			suggestions: [
				{
					key: "work:p-1",
					kind: "work" as const,
					taskId: "t-1",
					taskName: "Development",
					projectId: "p-1",
					projectName: "Farmer",
					description: "Fix login",
					durationSeconds: 7200,
					fillsDay: false,
					meetingUrl: null,
					calendarEventId: null,
					commits: [
						{
							projectGithubRepoId: "r-1",
							sha: "abc1234",
							message: "Fix login",
							repoFullName: "profico/farmer",
						},
					],
					pullRequests: [
						{
							projectGithubRepoId: "r-1",
							number: 12,
							title: "Add the API",
							repoFullName: "profico/farmer",
							kinds: ["opened" as const],
						},
					],
					dismissed: false,
				},
			],
			sources: { calendar: "unavailable" as const, github: "ok" as const },
			dismissedCount: 2,
		};
		const projected = toApiDayAssembly(assembly);
		expect(projected).toStrictEqual(assembly);
		expect(projected.suggestions).not.toBe(assembly.suggestions);
	});
});

describe("toApiCalendarEvent", () => {
	test("keeps the six fields of a meeting", () => {
		const event = {
			id: "evt-1",
			title: "Stand-up",
			start: "2026-10-06T08:00:00Z",
			end: "2026-10-06T08:15:00Z",
			meetingUrl: "https://meet.example.com/abc",
			htmlLink: null,
		};
		expect(toApiCalendarEvent({ ...event, ...{ extra: 1 } })).toStrictEqual(
			event,
		);
	});
});
