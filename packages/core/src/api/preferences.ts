/**
 * A person's own settings, as the REST API answers them: Preferences, the
 * timer limit and the switches on the Integrations page.
 *
 * Each value belongs to the caller and to nobody else, so the projections only
 * pick fields by name and turn each instant into an ISO string.
 */

/** "app": the compliance nudge, the month-end reminder and the admin digest
 *  go to the phone when it allows notifications, else to Slack. "slack":
 *  always to Slack (ADR 0006). */
export type ApiRemindersChannel = "app" | "slack";

/** `GET` and `PATCH …/preferences/notifications` — the caller's settings in
 *  one workspace. */
export type ApiNotificationSettings = {
	logReminders: boolean;
	remindersChannel: ApiRemindersChannel;
};

export const toApiNotificationSettings = (row: {
	logReminders: boolean;
	remindersChannel: ApiRemindersChannel;
}): ApiNotificationSettings => ({
	logReminders: row.logReminders,
	remindersChannel: row.remindersChannel,
});

/** `GET` and `PATCH …/timer/settings` — the longest a timer may run before
 *  the sweep drops it. */
export type ApiTimerSettings = { maxSeconds: number };

/** `…/preferences/hidden-tasks` — the tasks the caller switched off. They only
 *  narrow the task picker; a switched-off task can still be logged. */
export type ApiHiddenTasks = { taskIds: string[] };

/** `GET …/filing-rules` — where the caller's synced meetings go. */
export type ApiFilingRule = {
	id: string;
	/** The meeting title the rule matches. */
	title: string;
	/** The task the meeting arrives with. */
	task: { id: string; name: string };
	/** The task the meeting is filed under, or null to keep its own. */
	targetTask: { id: string; name: string } | null;
	project: { id: string; name: string; code: string | null };
	createdAt: string;
};

export const toApiFilingRule = (row: {
	id: string;
	title: string;
	taskId: string;
	taskName: string;
	targetTaskId: string | null;
	targetTaskName: string | null;
	projectId: string;
	projectName: string;
	projectCode: string | null;
	createdAt: Date;
}): ApiFilingRule => ({
	id: row.id,
	title: row.title,
	task: { id: row.taskId, name: row.taskName },
	targetTask:
		row.targetTaskId && row.targetTaskName
			? { id: row.targetTaskId, name: row.targetTaskName }
			: null,
	project: { id: row.projectId, name: row.projectName, code: row.projectCode },
	createdAt: row.createdAt.toISOString(),
});

/** The caller's switches on the Integrations page. */
export type ApiIntegrationSettings = {
	googleAutoSyncMeetings: boolean;
	githubAutoLoadCommits: boolean;
	githubSyncCommitsAsWorkTime: boolean;
	/** When the meeting sync was switched on: the first day it may write to. */
	googleAutoSyncMeetingsSince: string | null;
	/** When the commit sync was switched on: the first day it may write to. */
	githubSyncCommitsAsWorkTimeSince: string | null;
};

export const toApiIntegrationSettings = (row: {
	googleAutoSyncMeetings: boolean;
	githubAutoLoadCommits: boolean;
	githubSyncCommitsAsWorkTime: boolean;
	googleAutoSyncMeetingsSince: Date | null;
	githubSyncCommitsAsWorkTimeSince: Date | null;
}): ApiIntegrationSettings => ({
	googleAutoSyncMeetings: row.googleAutoSyncMeetings,
	githubAutoLoadCommits: row.githubAutoLoadCommits,
	githubSyncCommitsAsWorkTime: row.githubSyncCommitsAsWorkTime,
	googleAutoSyncMeetingsSince:
		row.googleAutoSyncMeetingsSince?.toISOString() ?? null,
	githubSyncCommitsAsWorkTimeSince:
		row.githubSyncCommitsAsWorkTimeSince?.toISOString() ?? null,
});

/** `PATCH …/integrations/settings`. `synced` is true when a switch went on
 *  and the first sync finished inside the save's short deadline. */
export type ApiIntegrationSettingsResult = ApiIntegrationSettings & {
	synced: boolean;
};

/** `GET …/integrations` — the caller's own GitHub and Google Calendar
 *  connections, and their switches. Connecting is a browser OAuth flow, so the
 *  app opens the web app's Integrations page for it. */
export type ApiIntegrations = {
	github: {
		connected: boolean;
		login: string | null;
		/** GitHub did not answer. The account is still linked. */
		unreachable: boolean;
		/** GitHub refuses the stored grant. Only a new connection fixes it. */
		needsReconnect: boolean;
	};
	googleCalendar: {
		connected: boolean;
		email: string | null;
		/** Google did not answer. The account is still linked. */
		unreachable: boolean;
	};
	settings: ApiIntegrationSettings;
};
