// The projections of a person's own settings, for the reason
// `time-entries.test.ts` gives: a column added to a table must not become a
// field that the mobile app starts to depend on. An instant goes out as an ISO
// string, because that is what JSON carries.

import { describe, expect, test } from "bun:test";

import {
	toApiFilingRule,
	toApiIntegrationSettings,
	toApiNotificationSettings,
} from "./preferences";

describe("toApiNotificationSettings", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			logReminders: false,
			remindersChannel: "slack" as const,
			userId: "u-1",
		};
		expect(toApiNotificationSettings(row)).toStrictEqual({
			logReminders: false,
			remindersChannel: "slack",
		});
	});
});

describe("toApiFilingRule", () => {
	const row = {
		id: "r-1",
		title: "Standup",
		taskId: "t-1",
		taskName: "Meeting",
		targetTaskId: null,
		targetTaskName: null,
		projectId: "p-1",
		projectName: "Apollo",
		projectCode: "APL",
		createdAt: new Date("2026-09-14T08:00:00Z"),
		userId: "u-1",
		organizationId: "org-1",
	};

	test("keeps exactly the fields it names", () => {
		expect(toApiFilingRule(row)).toStrictEqual({
			id: "r-1",
			title: "Standup",
			task: { id: "t-1", name: "Meeting" },
			targetTask: null,
			project: { id: "p-1", name: "Apollo", code: "APL" },
			createdAt: "2026-09-14T08:00:00.000Z",
		});
	});

	test("names the target task when the rule changes it", () => {
		expect(
			toApiFilingRule({
				...row,
				targetTaskId: "t-2",
				targetTaskName: "Development",
			}).targetTask,
		).toStrictEqual({ id: "t-2", name: "Development" });
	});
});

describe("toApiIntegrationSettings", () => {
	test("keeps exactly the fields it names, with ISO instants", () => {
		const row = {
			googleAutoSyncMeetings: true,
			githubAutoLoadCommits: false,
			githubSyncCommitsAsWorkTime: false,
			googleAutoSyncMeetingsSince: new Date("2026-09-01T07:00:00Z"),
			githubSyncCommitsAsWorkTimeSince: null,
			organizationId: "org-1",
		};
		expect(toApiIntegrationSettings(row)).toStrictEqual({
			googleAutoSyncMeetings: true,
			githubAutoLoadCommits: false,
			githubSyncCommitsAsWorkTime: false,
			googleAutoSyncMeetingsSince: "2026-09-01T07:00:00.000Z",
			githubSyncCommitsAsWorkTimeSince: null,
		});
	});
});
