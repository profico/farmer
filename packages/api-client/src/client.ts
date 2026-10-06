import type { z } from "zod";

import type {
	FileTimeEntries,
	CopyDay,
	CopyWeek,
	AbsenceRange,
	TimerSettingsPatch,
	NotificationSettingsPatch,
	TaskHidden,
	FilingRulePatch,
	WorkingHoursDayPatch,
	NewRecurringBlock,
	RecurringBlockPatch,
	IntegrationSettingsPatch,
	NewProject,
	NewClient,
	NewTask,
	ReminderSettingsPatch,
	SlackTestMessage,
	NewPersonalToken,
	NewWebhookEndpoint,
	WebhookEndpointPatch,
	AuditExportRange,
	AuditRetentionChange,
	AssistantConnect,
	AssistantSettingsPatch,
	NewAssistantThread,
	AssistantThreadRename,
	AssistantSend,
	AssistantApproval,
	ProjectPatch,
	NewProjectMember,
	ProjectMemberRole,
	ClientPatch,
	TaskPatch,
	PersonRole,
	PersonType,
	PersonStartDate,
	TeamLeadPeople,
	NewInvitation,
	HourFundEntry,
	HourFundMonthRef,
	HourFundYear,
	OrganizationPatch,
	ApplyDayAssembly,
	AttachCommits,
	AttachPullRequests,
	LinkRepository,
	ImageUpload,
	OrgPolicyPatch,
	HolidaySwitchChange,
	NewOrganization,
} from "./bodies";
import { ApiClientError } from "./errors";
import type { operations } from "./openapi.gen";
import {
	apiErrorSchema,
	type ConfirmTimer,
	deletedSchema,
	meSchema,
	type NewTimeEntry,
	projectSchema,
	type StartTimer,
	taskListSchema,
	taskSchema,
	timeEntrySchema,
	type TimeEntryPatch,
	timerStateSchema,
	trackingSchema,
	unfiledEntrySchema,
	whoamiSchema,
} from "./schemas";
import {
	personalTokenCreatedSchema,
	personalTokenSchema,
	revokedSchema,
	sessionSchema,
} from "./schemas-account";
import {
	auditExportSchema,
	auditPageSchema,
	auditRetentionSchema,
	githubDisconnectSchema,
	githubWorkspaceSchema,
	hourFundMonthSchema,
	holidaySwitchSchema,
	hourFundSuggestionSchema,
	installUrlSchema,
	managedTaskSchema,
	organizationSettingsSchema,
	orgPolicySchema,
	reminderPreviewSchema,
	reminderSettingsSchema,
	slackMatchSchema,
	slackStatusSchema,
	slackTestSchema,
	uploadedImageSchema,
	webhookDeliverySchema,
	webhookEndpointCreatedSchema,
	webhookEndpointSchema,
	webhookResendSchema,
	webhookSecretSchema,
	webhookTestSchema,
} from "./schemas-admin";
import {
	assistantModelSchema,
	assistantSettingsSchema,
	assistantThreadDetailSchema,
	assistantThreadSchema,
} from "./schemas-assistant";
import {
	attachedCommitSchema,
	attachedPullRequestSchema,
	availableRepositoriesSchema,
	calendarEventSchema,
	commitSuggestionSchema,
	dayAssemblyResultSchema,
	dayAssemblySchema,
	projectRepositorySchema,
	pullRequestSuggestionSchema,
} from "./schemas-day";
import {
	absenceEntrySchema,
	absenceReportSchema,
	absenceResultSchema,
	copyResultSchema,
	fileResultSchema,
	filingRuleSchema,
	hiddenTasksSchema,
	holidayDaySchema,
	holidaySchema,
	homeSchema,
	integrationSettingsSchema,
	integrationsSchema,
	notificationSettingsSchema,
	overtimeReportSchema,
	projectDetailSchema,
	projectOverviewSchema,
	recurringBlockSchema,
	rewindSchema,
	syncResultSchema,
	timeReportDetailSchema,
	timeReportSchema,
	timerSettingsSchema,
	trackingReportSchema,
	workingHoursDaySchema,
} from "./schemas-member";
import {
	createdOrganizationSchema,
	importClaimSchema,
	joinedOrganizationSchema,
	myInvitationSchema,
} from "./schemas-onboarding";
import {
	archiveResultSchema,
	clientSchema,
	invitationSchema,
	personProfileSchema,
	personRefSchema,
	personSchema,
	projectMemberSchema,
} from "./schemas-people";
import { readAssistantEvents } from "./sse";
import {
	type FetchResponse,
	type HttpMethod,
	openStream,
	readJson,
	send,
	type Transport,
} from "./transport";

const ORG_ROUTE_PREFIX = "/api/v1/orgs/";

const orgPath = (slug: string, suffix: string) =>
	`${ORG_ROUTE_PREFIX}${encodeURIComponent(slug)}${suffix}`;

const range = (from: string, to: string) =>
	`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/** The query parameters of an operation, as the OpenAPI document gives them. */
type QueryOf<Op extends keyof operations> = NonNullable<
	operations[Op]["parameters"]["query"]
>;

type QueryValue = string | number | boolean | undefined;

/** `?a=1&b=2` from the defined values, or nothing when there are none. */
const search = (query: { readonly [name: string]: QueryValue } = {}) => {
	const pairs = Object.entries(query).flatMap(([name, value]) =>
		value === undefined
			? []
			: [`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`],
	);
	return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
};

/**
 * A typed client for `/api/v1`. Every answer is parsed with its schema, and
 * every failure is an `ApiClientError`. The methods after the timer have the
 * name of their `operationId` in the OpenAPI document, so a route and its
 * method are easy to find from each other.
 */
export class FarmerClient {
	readonly #transport: Transport;
	readonly #token: string;

	constructor(transport: Transport, token: string) {
		this.#transport = transport;
		this.#token = token;
	}

	get origin(): string {
		return this.#transport.origin;
	}

	me() {
		return this.#request("GET", "/api/v1/me", meSchema);
	}

	/** Revokes the token this client holds, and no other. */
	async signOut(): Promise<void> {
		const response = await send(this.#transport, {
			method: "DELETE",
			path: "/api/v1/session",
			token: this.#token,
		});
		// A 401 means the token was already dead, which is the goal.
		if (response.ok || response.status === 401) return;
		throw await this.#failure(response, "/api/v1/session");
	}

	whoami(slug: string) {
		return this.#request("GET", orgPath(slug, "/whoami"), whoamiSchema);
	}

	projects(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/projects"),
			projectSchema.array(),
		);
	}

	tasks(slug: string) {
		return this.#request("GET", orgPath(slug, "/tasks"), taskListSchema);
	}

	tracking(slug: string) {
		return this.#request("GET", orgPath(slug, "/tracking"), trackingSchema);
	}

	/** Note: this read recomputes the fill blocks of the days it covers on the
	 *  server, so a caller must not ask it more often than a person would. */
	timeEntries(slug: string, from: string, to: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/time-entries${range(from, to)}`),
			timeEntrySchema.array(),
		);
	}

	unfiled(slug: string, from: string, to: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/unfiled${range(from, to)}`),
			unfiledEntrySchema.array(),
		);
	}

	createTimeEntry(slug: string, body: NewTimeEntry) {
		return this.#request(
			"POST",
			orgPath(slug, "/time-entries"),
			timeEntrySchema,
			body,
		);
	}

	updateTimeEntry(slug: string, id: string, patch: TimeEntryPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}`),
			timeEntrySchema,
			patch,
		);
	}

	deleteTimeEntry(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	timer(slug: string) {
		return this.#request("GET", orgPath(slug, "/timer"), timerStateSchema);
	}

	startTimer(slug: string, body: StartTimer) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer"),
			timerStateSchema,
			body,
		);
	}

	pauseTimer(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer/pause"),
			timerStateSchema,
		);
	}

	resumeTimer(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer/resume"),
			timerStateSchema,
		);
	}

	/** Discards a running timer, or clears the notice of a dropped one. */
	discardTimer(slug: string) {
		return this.#request("DELETE", orgPath(slug, "/timer"), timerStateSchema);
	}

	/** Stops the timer and logs the entry. Only after the person saw the
	 *  snapped figure in the confirm sheet (ADR 0003). */
	confirmTimer(slug: string, body: ConfirmTimer) {
		return this.#request(
			"POST",
			orgPath(slug, "/timer/confirm"),
			timeEntrySchema,
			body,
		);
	}

	// The member's own screens: the week, preferences, schedule,
	// integrations, time off, project detail, reports and Rewind.

	/** File entries to a project. */
	fileTimeEntries(slug: string, body: FileTimeEntries) {
		return this.#request(
			"POST",
			orgPath(slug, "/time-entries/file"),
			fileResultSchema,
			body,
		);
	}

	/** Copy a day. */
	copyDay(slug: string, body: CopyDay) {
		return this.#request(
			"POST",
			orgPath(slug, "/time-entries/copy-day"),
			copyResultSchema,
			body,
		);
	}

	/** Copy a week. */
	copyWeek(slug: string, body: CopyWeek) {
		return this.#request(
			"POST",
			orgPath(slug, "/time-entries/copy-week"),
			copyResultSchema,
			body,
		);
	}

	/** List time off in a month. */
	listAbsences(slug: string, query: QueryOf<"listAbsences">) {
		return this.#request(
			"GET",
			orgPath(slug, `/absences${search(query)}`),
			absenceEntrySchema.array(),
		);
	}

	/** Book time off. */
	logAbsence(slug: string, body: AbsenceRange) {
		return this.#request(
			"POST",
			orgPath(slug, "/absences"),
			absenceResultSchema,
			body,
		);
	}

	/** Delete time off. */
	deleteAbsence(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/absences/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	/** Get the week chart of the home page. */
	getHome(slug: string) {
		return this.#request("GET", orgPath(slug, "/home"), homeSchema);
	}

	/** Get the timer limit. */
	getTimerSettings(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/timer/settings"),
			timerSettingsSchema,
		);
	}

	/** Change the timer limit. */
	updateTimerSettings(slug: string, body: TimerSettingsPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/timer/settings"),
			timerSettingsSchema,
			body,
		);
	}

	/** Get the reminder settings. */
	getNotificationSettings(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/preferences/notifications"),
			notificationSettingsSchema,
		);
	}

	/** Change the reminder settings. */
	updateNotificationSettings(slug: string, body: NotificationSettingsPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/preferences/notifications"),
			notificationSettingsSchema,
			body,
		);
	}

	/** List the switched-off tasks. */
	listHiddenTasks(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/preferences/hidden-tasks"),
			hiddenTasksSchema,
		);
	}

	/** Switch a task off or on. */
	setTaskHidden(slug: string, body: TaskHidden) {
		return this.#request(
			"POST",
			orgPath(slug, "/preferences/hidden-tasks"),
			hiddenTasksSchema,
			body,
		);
	}

	/** Switch every task on. */
	showAllTasks(slug: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, "/preferences/hidden-tasks"),
			hiddenTasksSchema,
		);
	}

	/** List the filing rules. */
	listFilingRules(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/filing-rules"),
			filingRuleSchema.array(),
		);
	}

	/** Change where a filing rule files. */
	updateFilingRule(slug: string, id: string, body: FilingRulePatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/filing-rules/${encodeURIComponent(id)}`),
			filingRuleSchema,
			body,
		);
	}

	/** Delete a filing rule. */
	deleteFilingRule(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/filing-rules/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	/** Get the working hours. */
	listWorkingHours(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/working-hours"),
			workingHoursDaySchema.array(),
		);
	}

	/** Change one day of the working hours. */
	updateWorkingHoursDay(slug: string, body: WorkingHoursDayPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/working-hours"),
			workingHoursDaySchema,
			body,
		);
	}

	/** List the recurring blocks. */
	listRecurringBlocks(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/recurring-blocks"),
			recurringBlockSchema.array(),
		);
	}

	/** Add a recurring block. */
	createRecurringBlock(slug: string, body: NewRecurringBlock) {
		return this.#request(
			"POST",
			orgPath(slug, "/recurring-blocks"),
			recurringBlockSchema,
			body,
		);
	}

	/** Switch on the daily break. */
	enableBreakBlock(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/recurring-blocks/break"),
			recurringBlockSchema,
		);
	}

	/** Change a recurring block. */
	updateRecurringBlock(slug: string, id: string, body: RecurringBlockPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/recurring-blocks/${encodeURIComponent(id)}`),
			recurringBlockSchema,
			body,
		);
	}

	/** Delete a recurring block. */
	deleteRecurringBlock(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/recurring-blocks/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	/** List the public holidays of a year. */
	listHolidays(slug: string, query: QueryOf<"listHolidays">) {
		return this.#request(
			"GET",
			orgPath(slug, `/holidays${search(query)}`),
			holidaySchema.array(),
		);
	}

	/** List the holidays between two days. */
	listHolidaysInRange(slug: string, query?: QueryOf<"listHolidaysInRange">) {
		return this.#request(
			"GET",
			orgPath(slug, `/holidays/range${search(query)}`),
			holidayDaySchema.array(),
		);
	}

	/** Get the GitHub and Google Calendar connections. */
	getIntegrations(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/integrations"),
			integrationsSchema,
		);
	}

	/** Change the integration switches. */
	updateIntegrationSettings(slug: string, body: IntegrationSettingsPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/integrations/settings"),
			integrationSettingsSchema,
			body,
		);
	}

	/** Disconnect GitHub. */
	disconnectGithub(slug: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, "/integrations/github"),
			integrationsSchema,
		);
	}

	/** Disconnect Google Calendar. */
	disconnectGoogleCalendar(slug: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, "/integrations/google-calendar"),
			integrationsSchema,
		);
	}

	/** Get the Time report. */
	getTimeReport(slug: string, query: QueryOf<"getTimeReport">) {
		return this.#request(
			"GET",
			orgPath(slug, `/reports/time${search(query)}`),
			timeReportSchema,
		);
	}

	/** Get the entries behind the Time report. */
	getTimeReportDetail(slug: string, query: QueryOf<"getTimeReportDetail">) {
		return this.#request(
			"GET",
			orgPath(slug, `/reports/time/detail${search(query)}`),
			timeReportDetailSchema,
		);
	}

	/** Get the Overtime report. */
	getOvertimeReport(slug: string, query: QueryOf<"getOvertimeReport">) {
		return this.#request(
			"GET",
			orgPath(slug, `/reports/overtime${search(query)}`),
			overtimeReportSchema,
		);
	}

	/** Get the Tracking report. */
	getTrackingReport(slug: string, query: QueryOf<"getTrackingReport">) {
		return this.#request(
			"GET",
			orgPath(slug, `/reports/tracking${search(query)}`),
			trackingReportSchema,
		);
	}

	/** Get the Absence report. */
	getAbsenceReport(slug: string, query: QueryOf<"getAbsenceReport">) {
		return this.#request(
			"GET",
			orgPath(slug, `/reports/absence${search(query)}`),
			absenceReportSchema,
		);
	}

	/** Get the year in review. */
	getRewind(slug: string, query: QueryOf<"getRewind">) {
		return this.#request(
			"GET",
			orgPath(slug, `/rewind${search(query)}`),
			rewindSchema,
		);
	}

	/** List projects, with their stats, type, icon and money. `projects`
	 *  reads the same route with the short shape of API version 1. */
	listProjects(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/projects"),
			projectDetailSchema.array(),
		);
	}

	/** Create a project. */
	createProject(slug: string, body: NewProject) {
		return this.#request(
			"POST",
			orgPath(slug, "/projects"),
			projectDetailSchema,
			body,
		);
	}

	/** List the projects of a repository. */
	listRepositoryProjects(
		slug: string,
		query: QueryOf<"listRepositoryProjects">,
	) {
		return this.#request(
			"GET",
			orgPath(slug, `/repository-projects${search(query)}`),
			projectSchema.array(),
		);
	}

	/** Sync now. */
	sync(slug: string) {
		return this.#request("POST", orgPath(slug, "/sync"), syncResultSchema);
	}

	/** Get a project. */
	getProject(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/projects/${encodeURIComponent(id)}`),
			projectDetailSchema,
		);
	}

	/** Change a project. */
	updateProject(slug: string, id: string, body: ProjectPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/projects/${encodeURIComponent(id)}`),
			projectDetailSchema,
			body,
		);
	}

	/** Get a project's all-time figures. */
	getProjectOverview(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/overview`),
			projectOverviewSchema,
		);
	}

	// Project settings and the team, clients, people and invitations.

	/** List clients. */
	listClients(slug: string, query?: QueryOf<"listClients">) {
		return this.#request(
			"GET",
			orgPath(slug, `/clients${search(query)}`),
			clientSchema.array(),
		);
	}

	/** Create a client. */
	createClient(slug: string, body: NewClient) {
		return this.#request("POST", orgPath(slug, "/clients"), clientSchema, body);
	}

	/** Archive a project. */
	archiveProject(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/archive`),
			projectDetailSchema,
		);
	}

	/** Restore a project. */
	restoreProject(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/restore`),
			projectDetailSchema,
		);
	}

	/** List the people who can join a project. */
	listAssignable(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/assignable`),
			personRefSchema.array(),
		);
	}

	/** List a project's team. */
	listProjectMembers(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/members`),
			projectMemberSchema.array(),
		);
	}

	/** Add a person to a project. */
	addProjectMember(slug: string, id: string, body: NewProjectMember) {
		return this.#request(
			"POST",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/members`),
			projectMemberSchema.array(),
			body,
		);
	}

	/** Change a person's role on a project. */
	changeProjectRole(
		slug: string,
		id: string,
		userId: string,
		body: ProjectMemberRole,
	) {
		return this.#request(
			"PATCH",
			orgPath(
				slug,
				`/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
			),
			projectMemberSchema.array(),
			body,
		);
	}

	/** Remove a person from a project. */
	removeProjectMember(slug: string, id: string, userId: string) {
		return this.#request(
			"DELETE",
			orgPath(
				slug,
				`/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
			),
			projectMemberSchema.array(),
		);
	}

	/** Rename a client. */
	updateClient(slug: string, id: string, body: ClientPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/clients/${encodeURIComponent(id)}`),
			clientSchema,
			body,
		);
	}

	/** Archive a client. */
	archiveClient(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/clients/${encodeURIComponent(id)}/archive`),
			clientSchema,
		);
	}

	/** Restore a client. */
	restoreClient(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/clients/${encodeURIComponent(id)}/restore`),
			clientSchema,
		);
	}

	/** List the people. */
	listPeople(slug: string) {
		return this.#request("GET", orgPath(slug, "/people"), personSchema.array());
	}

	/** Get a person. */
	getPerson(slug: string, userId: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/people/${encodeURIComponent(userId)}`),
			personProfileSchema,
		);
	}

	/** Remove a person. */
	removePerson(slug: string, userId: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/people/${encodeURIComponent(userId)}`),
			deletedSchema,
		);
	}

	/** Change a person's role. */
	setPersonRole(slug: string, userId: string, body: PersonRole) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/role`),
			personSchema,
			body,
		);
	}

	/** Change a person's type. */
	setPersonType(slug: string, userId: string, body: PersonType) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/type`),
			personProfileSchema,
			body,
		);
	}

	/** Set a person's start date. */
	setPersonStartDate(slug: string, userId: string, body: PersonStartDate) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/start-date`),
			personProfileSchema,
			body,
		);
	}

	/** Archive a person. */
	archivePerson(slug: string, userId: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/archive`),
			archiveResultSchema,
		);
	}

	/** Restore a person. */
	restorePerson(slug: string, userId: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/restore`),
			archiveResultSchema,
		);
	}

	/** Confirm a person's address. */
	confirmPersonEmail(slug: string, userId: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/confirm-email`),
			archiveResultSchema,
		);
	}

	/** List a team lead's people. */
	listTeamLeadPeople(slug: string, userId: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/team`),
			personRefSchema.array(),
		);
	}

	/** Replace a team lead's people. */
	setTeamLeadPeople(slug: string, userId: string, body: TeamLeadPeople) {
		return this.#request(
			"POST",
			orgPath(slug, `/people/${encodeURIComponent(userId)}/team`),
			personRefSchema.array(),
			body,
		);
	}

	/** List the pending invitations. */
	listInvitations(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/invitations"),
			invitationSchema.array(),
		);
	}

	/** Invite a person. */
	invite(slug: string, body: NewInvitation) {
		return this.#request(
			"POST",
			orgPath(slug, "/invitations"),
			invitationSchema,
			body,
		);
	}

	/** Cancel an invitation. */
	cancelInvitation(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/invitations/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	/** Send an invitation again. */
	resendInvitation(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/invitations/${encodeURIComponent(id)}/resend`),
			invitationSchema,
		);
	}

	// The workspace admin: tasks, the hour fund, the organization,
	// reminders, workspace integrations, webhooks and the audit log.

	/** Create a task. */
	createTask(slug: string, body: NewTask) {
		return this.#request(
			"POST",
			orgPath(slug, "/tasks"),
			managedTaskSchema,
			body,
		);
	}

	/** Get the reminder settings. */
	getReminderSettings(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/reminders"),
			reminderSettingsSchema,
		);
	}

	/** Change the reminder settings. */
	updateReminderSettings(slug: string, body: ReminderSettingsPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/reminders"),
			reminderSettingsSchema,
			body,
		);
	}

	/** Preview who gets a reminder. */
	previewReminder(slug: string, query: QueryOf<"previewReminder">) {
		return this.#request(
			"GET",
			orgPath(slug, `/reminders/preview${search(query)}`),
			reminderPreviewSchema,
		);
	}

	/** List the GitHub installations. */
	getGithubWorkspace(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/workspace-integrations/github"),
			githubWorkspaceSchema,
		);
	}

	/** Get the GitHub App install page. */
	getGithubInstallUrl(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/workspace-integrations/github/install-url"),
			installUrlSchema,
		);
	}

	/** Disconnect a GitHub installation. */
	disconnectGithubInstallation(
		slug: string,
		id: string,
		query?: QueryOf<"disconnectGithubInstallation">,
	) {
		return this.#request(
			"DELETE",
			orgPath(
				slug,
				`/workspace-integrations/github/installations/${encodeURIComponent(id)}${search(query)}`,
			),
			githubDisconnectSchema,
		);
	}

	/** Get the Slack connection. */
	getSlackStatus(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/workspace-integrations/slack"),
			slackStatusSchema,
		);
	}

	/** Disconnect Slack. */
	disconnectSlack(slug: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, "/workspace-integrations/slack"),
			slackStatusSchema,
		);
	}

	/** Get the Add to Slack page. */
	getSlackInstallUrl(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/workspace-integrations/slack/install-url"),
			installUrlSchema,
		);
	}

	/** Match people to Slack. */
	matchSlackPeople(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/workspace-integrations/slack/match-people"),
			slackMatchSchema,
		);
	}

	/** Send a test message on Slack. */
	sendSlackTest(slug: string, body: SlackTestMessage) {
		return this.#request(
			"POST",
			orgPath(slug, "/workspace-integrations/slack/test"),
			slackTestSchema,
			body,
		);
	}

	/** The caller's sign-ins: browsers, terminals and phones. Needs a
	 *  sign-in session, not an API token. */
	listSessions() {
		return this.#request("GET", "/api/v1/me/sessions", sessionSchema.array());
	}

	/** Sign out another device. The session of this client is refused:
	 *  `signOut` ends it. */
	revokeSession(id: string) {
		return this.#request(
			"DELETE",
			`/api/v1/me/sessions/${encodeURIComponent(id)}`,
			revokedSchema,
		);
	}

	/** The caller's API tokens, in every workspace. */
	listApiTokens(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/api-tokens"),
			personalTokenSchema.array(),
		);
	}

	/** Make an API token. The answer holds the token, and no other call does. */
	createApiToken(slug: string, body: NewPersonalToken) {
		return this.#request(
			"POST",
			orgPath(slug, "/api-tokens"),
			personalTokenCreatedSchema,
			body,
		);
	}

	/** Revoke an API token. */
	revokeApiToken(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/api-tokens/${encodeURIComponent(id)}`),
			revokedSchema,
		);
	}

	/** List webhook endpoints. */
	listWebhookEndpoints(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/webhooks"),
			webhookEndpointSchema.array(),
		);
	}

	/** Add a webhook endpoint. */
	createWebhookEndpoint(slug: string, body: NewWebhookEndpoint) {
		return this.#request(
			"POST",
			orgPath(slug, "/webhooks"),
			webhookEndpointCreatedSchema,
			body,
		);
	}

	/** Get a webhook endpoint. */
	getWebhookEndpoint(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/webhooks/${encodeURIComponent(id)}`),
			webhookEndpointSchema,
		);
	}

	/** Change a webhook endpoint. */
	updateWebhookEndpoint(slug: string, id: string, body: WebhookEndpointPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/webhooks/${encodeURIComponent(id)}`),
			webhookEndpointSchema,
			body,
		);
	}

	/** Delete a webhook endpoint. */
	deleteWebhookEndpoint(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/webhooks/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	/** Roll the signing secret. */
	rollWebhookSecret(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/webhooks/${encodeURIComponent(id)}/roll-secret`),
			webhookSecretSchema,
		);
	}

	/** Send a test event. */
	sendWebhookTest(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/webhooks/${encodeURIComponent(id)}/test`),
			webhookTestSchema,
		);
	}

	/** List the delivery log. */
	listWebhookDeliveries(
		slug: string,
		id: string,
		query?: QueryOf<"listWebhookDeliveries">,
	) {
		return this.#request(
			"GET",
			orgPath(
				slug,
				`/webhooks/${encodeURIComponent(id)}/deliveries${search(query)}`,
			),
			webhookDeliverySchema.array(),
		);
	}

	/** Send a delivery again. */
	resendWebhookDelivery(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/webhooks/deliveries/${encodeURIComponent(id)}/resend`),
			webhookResendSchema,
		);
	}

	/** List the audit log. */
	listAuditEvents(slug: string, query?: QueryOf<"listAuditEvents">) {
		return this.#request(
			"GET",
			orgPath(slug, `/audit-log${search(query)}`),
			auditPageSchema,
		);
	}

	/** Export the audit log. */
	exportAuditEvents(slug: string, body: AuditExportRange) {
		return this.#request(
			"POST",
			orgPath(slug, "/audit-log/export"),
			auditExportSchema,
			body,
		);
	}

	/** Get how long the log is kept. */
	getAuditRetention(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/audit-log/retention"),
			auditRetentionSchema,
		);
	}

	/** Change how long the log is kept. */
	setAuditRetention(slug: string, body: AuditRetentionChange) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/audit-log/retention"),
			auditRetentionSchema,
			body,
		);
	}

	/** List the tasks of a project. */
	listProjectTasks(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/tasks`),
			taskSchema.array(),
		);
	}

	/** List the tasks to manage. */
	listManagedTasks(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/tasks/managed"),
			managedTaskSchema.array(),
		);
	}

	/** Change a task. */
	updateTask(slug: string, id: string, body: TaskPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/tasks/${encodeURIComponent(id)}`),
			managedTaskSchema,
			body,
		);
	}

	/** Archive a task. */
	archiveTask(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/tasks/${encodeURIComponent(id)}/archive`),
			managedTaskSchema,
		);
	}

	/** Restore a task. */
	restoreTask(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/tasks/${encodeURIComponent(id)}/restore`),
			managedTaskSchema,
		);
	}

	/** List the hour fund of a year. */
	listHourFund(slug: string, query: QueryOf<"listHourFund">) {
		return this.#request(
			"GET",
			orgPath(slug, `/hour-fund${search(query)}`),
			hourFundMonthSchema.array(),
		);
	}

	/** Set the fund of a month. */
	setHourFund(slug: string, body: HourFundEntry) {
		return this.#request(
			"POST",
			orgPath(slug, "/hour-fund"),
			hourFundMonthSchema.array(),
			body,
		);
	}

	/** Clear the fund of a month. */
	clearHourFund(slug: string, body: HourFundMonthRef) {
		return this.#request(
			"POST",
			orgPath(slug, "/hour-fund/clear"),
			hourFundMonthSchema.array(),
			body,
		);
	}

	/** Fill a year from the holiday calendar. */
	prefillHourFund(slug: string, body: HourFundYear) {
		return this.#request(
			"POST",
			orgPath(slug, "/hour-fund/prefill"),
			hourFundMonthSchema.array(),
			body,
		);
	}

	/** Suggest the fund of a month. */
	suggestHourFund(slug: string, query: QueryOf<"suggestHourFund">) {
		return this.#request(
			"GET",
			orgPath(slug, `/hour-fund/suggestion${search(query)}`),
			hourFundSuggestionSchema,
		);
	}

	/** Get the organization's settings. */
	getOrganization(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/organization"),
			organizationSettingsSchema,
		);
	}

	/** Change the organization's settings. */
	updateOrganization(slug: string, body: OrganizationPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/organization"),
			organizationSettingsSchema,
			body,
		);
	}

	// The assistant: its settings, the models, the threads and a turn.

	/** Get the assistant settings. */
	getAssistantSettings(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/assistant/settings"),
			assistantSettingsSchema,
		);
	}

	/** Connect the AI provider. */
	connectAssistant(slug: string, body: AssistantConnect) {
		return this.#request(
			"POST",
			orgPath(slug, "/assistant/settings"),
			assistantSettingsSchema,
			body,
		);
	}

	/** Change the assistant settings. */
	updateAssistantSettings(slug: string, body: AssistantSettingsPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/assistant/settings"),
			assistantSettingsSchema,
			body,
		);
	}

	/** Disconnect the AI provider. */
	disconnectAssistant(slug: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, "/assistant/settings"),
			assistantSettingsSchema,
		);
	}

	/** List the models. */
	listAssistantModels(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/assistant/models"),
			assistantModelSchema.array(),
		);
	}

	/** List your threads. */
	listAssistantThreads(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/assistant/threads"),
			assistantThreadSchema.array(),
		);
	}

	/** Start a thread. */
	createAssistantThread(slug: string, body: NewAssistantThread) {
		return this.#request(
			"POST",
			orgPath(slug, "/assistant/threads"),
			assistantThreadSchema,
			body,
		);
	}

	/** Read a thread. */
	getAssistantThread(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/assistant/threads/${encodeURIComponent(id)}`),
			assistantThreadDetailSchema,
		);
	}

	/** Rename a thread. */
	renameAssistantThread(slug: string, id: string, body: AssistantThreadRename) {
		return this.#request(
			"PATCH",
			orgPath(slug, `/assistant/threads/${encodeURIComponent(id)}`),
			assistantThreadSchema,
			body,
		);
	}

	/** Delete a thread. */
	deleteAssistantThread(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/assistant/threads/${encodeURIComponent(id)}`),
			deletedSchema,
		);
	}

	/** Send a message. */
	sendAssistantMessage(
		slug: string,
		id: string,
		body: AssistantSend,
		signal?: AbortSignal,
	) {
		return this.#stream(
			orgPath(slug, `/assistant/threads/${encodeURIComponent(id)}/messages`),
			body,
			signal,
		);
	}

	/** Approve or reject a write. */
	answerAssistantApproval(
		slug: string,
		id: string,
		body: AssistantApproval,
		signal?: AbortSignal,
	) {
		return this.#stream(
			orgPath(slug, `/assistant/threads/${encodeURIComponent(id)}/approvals`),
			body,
			signal,
		);
	}

	/** One assistant turn as a stream of events. A non-2xx answer throws
	 *  before the first event, as every other call does. */

	// API version 3: the Day view's helpers, GitHub on an entry and on a
	// project, images, the organization's policy, and the steps of a person
	// before a workspace.

	/** Suggest the entries that the day is missing, from the calendar and
	 *  GitHub. */
	suggestDayAssembly(slug: string, query: QueryOf<"suggestDayAssembly">) {
		return this.#request(
			"GET",
			orgPath(slug, `/day-assembly${search(query)}`),
			dayAssemblySchema,
		);
	}

	/** Make the chosen suggestions into entries. One that fails does not stop
	 *  the others. */
	applyDayAssembly(slug: string, body: ApplyDayAssembly) {
		return this.#request(
			"POST",
			orgPath(slug, "/day-assembly"),
			dayAssemblyResultSchema,
			body,
		);
	}

	/** List the timed meetings of a day from the person's Google Calendar. */
	listCalendarEvents(slug: string, query: QueryOf<"listCalendarEvents">) {
		return this.#request(
			"GET",
			orgPath(slug, `/calendar/events${search(query)}`),
			calendarEventSchema.array(),
		);
	}

	/** Replace the entry's values with what the calendar says now. */
	useCalendarValues(slug: string, id: string) {
		return this.#request(
			"POST",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}/calendar-values`),
			timeEntrySchema,
		);
	}

	/** Keep the entry as the person edited it, and clear the calendar
	 *  notice. */
	dismissCalendarChange(slug: string, id: string) {
		return this.#request(
			"DELETE",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}/calendar-change`),
			timeEntrySchema,
		);
	}

	/** List the person's commits of a day in the project's repositories. */
	suggestCommits(slug: string, query: QueryOf<"suggestCommits">) {
		return this.#request(
			"GET",
			orgPath(slug, `/github/commits${search(query)}`),
			commitSuggestionSchema.array(),
		);
	}

	/** List the pull requests the person worked on that day. */
	suggestPullRequests(slug: string, query: QueryOf<"suggestPullRequests">) {
		return this.#request(
			"GET",
			orgPath(slug, `/github/pull-requests${search(query)}`),
			pullRequestSuggestionSchema.array(),
		);
	}

	/** List the commits attached to an entry. */
	listAttachedCommits(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}/commits`),
			attachedCommitSchema.array(),
		);
	}

	/** Attach commits to an entry. Answers all the entry's commits. */
	attachCommits(slug: string, id: string, body: AttachCommits) {
		return this.#request(
			"POST",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}/commits`),
			attachedCommitSchema.array(),
			body,
		);
	}

	/** Remove one commit from an entry. Answers the commits that stay. */
	detachCommit(slug: string, id: string, commitId: string) {
		return this.#request(
			"DELETE",
			orgPath(
				slug,
				`/time-entries/${encodeURIComponent(id)}/commits/${encodeURIComponent(commitId)}`,
			),
			attachedCommitSchema.array(),
		);
	}

	/** List the pull request events attached to an entry. */
	listAttachedPullRequests(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}/pull-requests`),
			attachedPullRequestSchema.array(),
		);
	}

	/** Attach pull requests to an entry. Answers all the entry's events. */
	attachPullRequests(slug: string, id: string, body: AttachPullRequests) {
		return this.#request(
			"POST",
			orgPath(slug, `/time-entries/${encodeURIComponent(id)}/pull-requests`),
			attachedPullRequestSchema.array(),
			body,
		);
	}

	/** Remove one pull request event from an entry. */
	detachPullRequest(slug: string, id: string, activityId: string) {
		return this.#request(
			"DELETE",
			orgPath(
				slug,
				`/time-entries/${encodeURIComponent(id)}/pull-requests/${encodeURIComponent(activityId)}`,
			),
			attachedPullRequestSchema.array(),
		);
	}

	/** List the repositories linked to a project. */
	listProjectRepositories(slug: string, id: string) {
		return this.#request(
			"GET",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/repositories`),
			projectRepositorySchema.array(),
		);
	}

	/** Link a repository to a project. Admin only. */
	linkProjectRepository(slug: string, id: string, body: LinkRepository) {
		return this.#request(
			"POST",
			orgPath(slug, `/projects/${encodeURIComponent(id)}/repositories`),
			projectRepositorySchema.array(),
			body,
		);
	}

	/** Unlink a repository from a project. Admin only. */
	unlinkProjectRepository(slug: string, id: string, repositoryId: string) {
		return this.#request(
			"DELETE",
			orgPath(
				slug,
				`/projects/${encodeURIComponent(id)}/repositories/${encodeURIComponent(repositoryId)}`,
			),
			projectRepositorySchema.array(),
		);
	}

	/** List the repositories the GitHub installations can read. Admin
	 *  only. */
	listAvailableRepositories(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/workspace-integrations/github/repositories"),
			availableRepositoriesSchema,
		);
	}

	/** Read the repositories from GitHub again, past the cache. Admin only. */
	refreshAvailableRepositories(slug: string) {
		return this.#request(
			"POST",
			orgPath(slug, "/workspace-integrations/github/repositories/refresh"),
			availableRepositoriesSchema,
		);
	}

	/** Store an image as base64. Send the answer's `url` as the project's
	 *  `icon` or the organization's `logo`. Needs `meta.uploadsEnabled`. */
	uploadImage(slug: string, body: ImageUpload) {
		return this.#request(
			"POST",
			orgPath(slug, "/uploads"),
			uploadedImageSchema,
			body,
		);
	}

	/** Get the tracking tolerance and the automation lock. Admin only. */
	getOrgPolicy(slug: string) {
		return this.#request(
			"GET",
			orgPath(slug, "/organization/policy"),
			orgPolicySchema,
		);
	}

	/** Change the tracking tolerance or the automation lock. Admin only. */
	updateOrgPolicy(slug: string, body: OrgPolicyPatch) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/organization/policy"),
			orgPolicySchema,
			body,
		);
	}

	/** Make a public holiday a working day, or a holiday again. Admin
	 *  only. */
	setHolidayDisabled(slug: string, body: HolidaySwitchChange) {
		return this.#request(
			"PATCH",
			orgPath(slug, "/holidays"),
			holidaySwitchSchema,
			body,
		);
	}

	/** List the live invitations to the person's address. */
	listMyInvitations() {
		return this.#request(
			"GET",
			"/api/v1/me/invitations",
			myInvitationSchema.array(),
		);
	}

	/** Join a workspace through an invitation. Answers the workspace to
	 *  open. Needs a session, not an API token. */
	acceptInvitation(id: string) {
		return this.#request(
			"POST",
			`/api/v1/me/invitations/${encodeURIComponent(id)}/accept`,
			joinedOrganizationSchema,
		);
	}

	/** Say no to an invitation. Needs a session, not an API token. */
	declineInvitation(id: string) {
		return this.#request(
			"POST",
			`/api/v1/me/invitations/${encodeURIComponent(id)}/decline`,
			deletedSchema,
		);
	}

	/** List the workspaces whose Harvest import waits for the person's
	 *  answer. */
	listMyImportClaims() {
		return this.#request(
			"GET",
			"/api/v1/me/import-claims",
			importClaimSchema.array(),
		);
	}

	/** Take the membership a Harvest import made. Needs a session. */
	acceptImportClaim(organizationId: string) {
		return this.#request(
			"POST",
			`/api/v1/me/import-claims/${encodeURIComponent(organizationId)}/accept`,
			joinedOrganizationSchema,
		);
	}

	/** Refuse the membership a Harvest import made. Needs a session. */
	declineImportClaim(organizationId: string) {
		return this.#request(
			"POST",
			`/api/v1/me/import-claims/${encodeURIComponent(organizationId)}/decline`,
			deletedSchema,
		);
	}

	/** Make a workspace that the person owns. Needs a session and
	 *  `meta.organizationCreation`. */
	createOrganization(body: NewOrganization) {
		return this.#request(
			"POST",
			"/api/v1/me/organizations",
			createdOrganizationSchema,
			body,
		);
	}

	async *#stream<Body>(
		path: string,
		body: Body,
		signal: AbortSignal | undefined,
	) {
		const response = await openStream(this.#transport, {
			method: "POST",
			path,
			token: this.#token,
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok) throw await this.#failure(response, path);
		yield* readAssistantEvents(response);
	}

	async #request<S extends z.ZodType, Body = never>(
		method: HttpMethod,
		path: string,
		schema: S,
		body?: Body,
	): Promise<z.output<S>> {
		const response = await send(this.#transport, {
			method,
			path,
			token: this.#token,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) throw await this.#failure(response, path);
		const parsed = schema.safeParse(await readJson(response));
		if (!parsed.success) {
			throw new ApiClientError(
				"invalid_response",
				`${this.origin} sent an answer this app cannot read. The server may be newer than the app: update the app.`,
				{ status: response.status },
			);
		}
		return parsed.data;
	}

	async #failure(
		response: FetchResponse,
		path: string,
	): Promise<ApiClientError> {
		const body = apiErrorSchema.safeParse(await readJson(response));
		const details = body.success
			? {
					status: response.status,
					code: body.data.code,
					issues: body.data.issues,
				}
			: { status: response.status };

		if (response.status === 401) {
			// An org route answers 401 for a workspace the person is not in as
			// well as for a dead token. `/me` tells the two apart.
			if (path.startsWith(ORG_ROUTE_PREFIX) && (await this.#tokenWorks())) {
				return new ApiClientError(
					"no_access",
					"You no longer have access to this workspace.",
					details,
				);
			}
			return new ApiClientError(
				"unauthorized",
				"Your session has ended. Sign in again.",
				details,
			);
		}
		if (body.success) {
			const issues = (body.data.issues ?? []).map((issue) => issue.message);
			return new ApiClientError(
				"http",
				[body.data.error, ...issues].join("\n"),
				details,
			);
		}
		return new ApiClientError(
			"http",
			`${this.origin} answered ${response.status}. Try again.`,
			details,
		);
	}

	async #tokenWorks(): Promise<boolean> {
		const response = await send(this.#transport, {
			method: "GET",
			path: "/api/v1/me",
			token: this.#token,
		});
		return response.ok;
	}
}
