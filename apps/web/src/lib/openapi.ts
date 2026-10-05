import {
	type ApiAbsenceEntry,
	type ApiAbsenceReport,
	type ApiAbsenceResult,
	type ApiAssistantEvent,
	type ApiAssistantMessage,
	type ApiAssistantModel,
	type ApiAssistantSettings,
	type ApiAssistantThread,
	type ApiAssistantThreadDetail,
	type ApiAuditEvent,
	type ApiAuditExport,
	type ApiAuditPage,
	type ApiAuditRetention,
	type ApiGithubDisconnect,
	type ApiGithubInstallation,
	type ApiGithubWorkspace,
	type ApiInstallUrl,
	type ApiReminderPreview,
	type ApiReminderSettings,
	type ApiSlackMatch,
	type ApiSlackStatus,
	type ApiSlackTest,
	type ApiWebhookDelivery,
	type ApiWebhookEndpoint,
	type ApiWebhookEndpointCreated,
	type ApiWebhookResend,
	type ApiWebhookSecret,
	type ApiWebhookTest,
	type ApiArchiveResult,
	type ApiCopyResult,
	type ApiDeleted,
	type ApiClient,
	type ApiError,
	type ApiFileResult,
	type ApiFilingRule,
	type ApiHiddenTasks,
	type ApiHoliday,
	type ApiHolidayDay,
	type ApiHome,
	type ApiIntegrations,
	type ApiIntegrationSettingsResult,
	type ApiHourFundMonth,
	type ApiHourFundSuggestion,
	type ApiInvitation,
	type ApiManagedTask,
	type ApiMe,
	type ApiMeta,
	type ApiNotificationSettings,
	type ApiOvertimeReport,
	type ApiOrganizationSettings,
	type ApiMobileDevice,
	type ApiPeriod,
	type ApiPerson,
	type ApiPersonProfile,
	type ApiPersonRef,
	type ApiProject,
	type ApiProjectDetail,
	type ApiProjectMember,
	type ApiProjectOverview,
	type ApiProjectRef,
	type ApiRecurringBlock,
	type ApiRewind,
	type ApiSyncResult,
	type ApiTask,
	type ApiTaskList,
	type ApiTaskRef,
	type ApiTimeEntry,
	type ApiTimer,
	type ApiTimerSettings,
	type ApiTimerState,
	type ApiTimeReport,
	type ApiTimeReportDetail,
	type ApiTracking,
	type ApiTrackingReport,
	type ApiUnfiledEntry,
	type ApiWhoami,
	type ApiWorkingHoursDay,
	API_TOKEN_PREFIX,
	CLI_CLIENT_ID,
	CLI_VERSION_HEADER,
} from "@farmer/core/api";
import type { JsonValue } from "@farmer/core/lib/json";
import {
	absenceReportInput,
	assistantResolveInput,
	assistantSendInput,
	assignProjectMemberInput,
	changeProjectMemberRoleInput,
	confirmTimerInput,
	copyTimeEntriesInput,
	copyWeekEntriesInput,
	createRecurringBlockRuleInput,
	createConversationInput,
	createClientInput,
	createProjectInput,
	createTaskInput,
	createTimeEntryInput,
	createWebhookEndpointInput,
	exportAuditEventsInput,
	fileTimeEntriesInput,
	holidaysYearQueryInput,
	listHolidaysForRangeInput,
	listMyAbsenceInput,
	listAuditEventsInput,
	hourFundYearInput,
	inviteMemberInput,
	listClientsInput,
	listTimeEntriesRangeInput,
	listWebhookDeliveriesInput,
	logAbsenceRangeInput,
	monthReportInput,
	overtimeReportInput,
	reminderKind,
	reminderPreviewInput,
	reminderSettingsInput,
	renameConversationInput,
	memberTypeEnum,
	monthPeriodInput,
	projectRoleEnum,
	registerMobileDeviceInput,
	repositoryProjectsInput,
	rewindInput,
	setTaskHiddenInput,
	sendTestSlackMessageInput,
	setAssistantSettingsInput,
	setAuditRetentionInput,
	setMemberRoleInput,
	setMemberStartDateInput,
	setMemberTypeInput,
	setMonthlyHourFundInput,
	setTeamLeadPeopleInput,
	startTimerInput,
	timeReportDetailInput,
	timeReportSummaryInput,
	timerSettingsInput,
	updateFilingRuleInput,
	updateIntegrationSettingsInput,
	updateNotificationSettingsInput,
	updateRecurringBlockRuleInput,
	updateAssistantSettingsInput,
	updateReminderSettingsInput,
	updateClientInput,
	updateOrganizationSettingsInput,
	updateProjectInput,
	updateTaskInput,
	updateMobileDeviceInput,
	updateTimeEntryInput,
	upsertWorkingHoursDayInput,
	updateWebhookEndpointInput,
	webhookEventKind,
} from "@farmer/core/schema";
import { z } from "zod";

import { SESSION_REQUEST_HEADER } from "./api-session-header.ts";

/**
 * The OpenAPI 3.1 document for `/api/v1`, which `/api-docs` renders with
 * Scalar and `GET /api/v1/openapi.json` serves.
 *
 * Nothing here is written twice. A request body is the Zod schema from
 * `@farmer/core/schema` that the route itself parses, and a response is a
 * schema that must agree with its `@farmer/core/api` type (see `mirror`), so a
 * field added to either side without the other fails `typecheck`. A route
 * added under `routes/api/v1` without an entry in `OPERATIONS` fails
 * `openapi.test.ts`.
 *
 * Only the routes that take a bearer token are here. `api/v1/projects` and
 * `api/v1/time-entries` are the web app's own cookie-authed reads.
 */

/** True when each of `A` and `B` is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * A response schema that must describe exactly `T`, the type the route
 * answers. When the two drift apart, the argument's type becomes `never` and
 * the call stops compiling.
 */
const mirror =
	<T>() =>
	<S extends z.ZodType>(
		schema: S & (Same<T, z.output<S>> extends true ? S : never),
	): S =>
		schema;

/** Every named schema, so the document holds each one once, under
 *  `components.schemas`, and refers to it from each operation. */
const components = z.registry<{ id: string }>();

const named = <S extends z.ZodType>(id: string, schema: S): S => {
	components.add(schema, { id });
	return schema;
};

const uuid = z.string().describe("A UUID.");
const dayKey = z.string().describe("A day, yyyy-MM-dd.");
const iso = z.string().describe("An instant, ISO 8601 in UTC.");

const projectRole = z
	.enum(["member", "team_lead", "pm"])
	.describe("The role the caller holds on the project.");

const apiError = named(
	"Error",
	mirror<ApiError>()(
		z
			.object({
				error: z
					.string()
					.describe(
						"A sentence for a person. Its wording can change at any time.",
					),
				code: z
					.enum([
						"unauthorized",
						"forbidden",
						"not_found",
						"invalid_input",
						"rate_limited",
						"cli_outdated",
						"server_error",
					])
					.describe("What a client branches on. A new code is an addition."),
				issues: z
					.array(z.object({ path: z.string(), message: z.string() }))
					.optional()
					.describe("One item per invalid field, on `invalid_input`."),
			})
			.describe("The body of every error response."),
	),
);

const apiMeta = named(
	"Meta",
	mirror<ApiMeta>()(
		z.object({
			app: z.literal("farmer"),
			cliEnabled: z
				.boolean()
				.describe(
					"False when this deployment has the API switched off. Every other route then answers 404.",
				),
			minCliVersion: z.string(),
			apiVersion: z
				.number()
				.int()
				.describe(
					"The version of this contract. A server that sends no `apiVersion` is version 1.",
				),
			minMobileVersion: z
				.string()
				.describe("The oldest mobile app this server can serve."),
			signInMethods: z
				.array(
					z.object({
						id: z.string(),
						name: z.string(),
						kind: z
							.enum(["social", "oidc"])
							.describe(
								"`social` is Google. `oidc` is an OpenID Connect source.",
							),
					}),
				)
				.describe("The provider buttons, in the order of the login page."),
			passwordSignIn: z
				.boolean()
				.describe("True when this server offers an email and password form."),
			pushRelay: z
				.object({
					enabled: z.boolean(),
					url: z
						.string()
						.nullable()
						.describe("The relay's base URL, or null while push is off."),
				})
				.describe(
					"Whether this server sends native push to the mobile app, and through which relay. A server from before the mobile push sends no `pushRelay`: read its absence as off.",
				),
		}),
	),
);

const apiMe = named(
	"Me",
	mirror<ApiMe>()(
		z.object({
			user: z.object({ id: uuid, name: z.string(), email: z.string() }),
			organizations: z
				.array(z.object({ slug: z.string(), name: z.string() }))
				.describe("Each slug is the `orgSlug` of every other route."),
		}),
	),
);

const apiWhoami = named(
	"Whoami",
	mirror<ApiWhoami>()(
		z.object({
			userId: uuid,
			name: z.string().nullable(),
			email: z.string().nullable(),
			organization: z.object({ slug: z.string(), name: z.string() }),
			orgRole: z.string().nullable(),
			isAdmin: z.boolean(),
			capabilities: z
				.object({
					isAdmin: z.boolean(),
					canManageClients: z
						.boolean()
						.describe("Admin, or a PM or Team Lead on any project."),
					canManageProjects: z
						.boolean()
						.describe("Admin, or a PM or Team Lead on any project."),
					leadsPeople: z
						.boolean()
						.describe("The caller has people on a Team Lead list."),
					canSeeAllReports: z
						.boolean()
						.describe(
							"Reports for everybody, not only for the caller's own scope.",
						),
				})
				.describe(
					"What the caller may do here. Show a section only when its capability is true. The route still checks the permission.",
				),
			timezone: z.string().describe("The organization's IANA timezone."),
			today: dayKey.describe("Today, in `timezone`."),
			weekStartsOn: z
				.union([z.literal(0), z.literal(1)])
				.describe("1 is Monday, 0 is Sunday."),
			workingDays: z
				.array(
					z.object({
						dayOfWeek: z.number().int().describe("0 is Sunday."),
						startTime: z.string().describe("HH:mm."),
						endTime: z.string().describe("HH:mm."),
					}),
				)
				.describe("The enabled days only."),
			projects: z.array(
				z.object({ id: uuid, name: z.string(), role: projectRole.nullable() }),
			),
		}),
	),
);

const apiTaskRef = named(
	"TaskRef",
	mirror<ApiTaskRef>()(
		z.object({ id: uuid, name: z.string(), isAbsence: z.boolean() }),
	),
);

const client = z.object({ id: uuid, name: z.string() });

const apiProjectRef = named(
	"ProjectRef",
	mirror<ApiProjectRef>()(
		z.object({
			id: uuid,
			name: z.string(),
			code: z.string().nullable(),
			client,
		}),
	),
);

const apiTimeEntry = named(
	"TimeEntry",
	mirror<ApiTimeEntry>()(
		z.object({
			id: uuid,
			date: dayKey,
			durationSeconds: z.number().int(),
			description: z.string(),
			overtime: z.boolean(),
			fillsDay: z
				.boolean()
				.describe(
					"A rest-of-day block: its duration follows the day, nobody typed it.",
				),
			synced: z
				.boolean()
				.describe(
					"Mirrors a calendar event. Google still owns it unless it was filed.",
				),
			commitCount: z.number().int(),
			task: apiTaskRef,
			project: apiProjectRef
				.nullable()
				.describe("Null for time off, a Break, and anything not yet filed."),
		}),
	),
);

const apiUnfiledEntry = named(
	"UnfiledEntry",
	mirror<ApiUnfiledEntry>()(
		z.object({
			id: uuid,
			date: dayKey,
			durationSeconds: z.number().int(),
			description: z.string(),
			task: z.object({ id: uuid, name: z.string() }),
			meetingUrl: z.string().nullable(),
		}),
	),
);

const apiFileResult = named(
	"FileResult",
	mirror<ApiFileResult>()(
		z.object({
			filed: z.number().int(),
			failed: z.number().int(),
			firstError: z.string().nullable(),
		}),
	),
);

const apiCopyResult = named(
	"CopyResult",
	mirror<ApiCopyResult>()(
		z.object({
			copied: z.number().int(),
			skipped: z.number().int(),
			blockedDays: z
				.array(dayKey)
				.describe(
					"The days a week copy left alone because they would pass 24 hours. Always empty for a day copy.",
				),
		}),
	),
);

const apiAbsenceResult = named(
	"AbsenceResult",
	mirror<ApiAbsenceResult>()(
		z.object({
			booked: z.array(
				z.object({ date: dayKey, durationSeconds: z.number().int() }),
			),
			skipped: z
				.array(z.object({ date: dayKey, reason: z.string() }))
				.describe("A weekend, a public holiday or a day already off."),
		}),
	),
);

const apiDeleted = named(
	"Deleted",
	mirror<ApiDeleted>()(z.object({ id: uuid.describe("The id it removed.") })),
);

const apiProject = named(
	"Project",
	mirror<ApiProject>()(
		z.object({
			id: uuid,
			name: z.string(),
			code: z.string().nullable(),
			status: z.string(),
			client,
			role: projectRole.nullable(),
		}),
	),
);

const apiClient = named(
	"Client",
	mirror<ApiClient>()(
		z.object({
			id: uuid,
			name: z.string(),
			isInternal: z
				.boolean()
				.describe("True for the organization's own client."),
			archivedAt: iso.nullable().describe("Null for an active client."),
		}),
	),
);

const apiTask = named(
	"Task",
	mirror<ApiTask>()(
		z.object({
			id: uuid,
			name: z.string(),
			group: z.string(),
			isAbsence: z.boolean(),
			systemKey: z.string().nullable(),
		}),
	),
);

const apiTaskList = named(
	"TaskList",
	mirror<ApiTaskList>()(
		z.object({
			tasks: z.array(apiTask).describe("Work tasks, to log time against."),
			absenceTasks: z
				.array(apiTask)
				.describe("Absence tasks, for `POST /absences`."),
		}),
	),
);

const apiPeriod = named(
	"Period",
	mirror<ApiPeriod>()(
		z.object({
			from: dayKey,
			to: dayKey,
			workingDays: z.number().int(),
			workingDaysElapsed: z.number().int(),
			targetSeconds: z.number().int().nullable(),
			targetSoFarSeconds: z.number().int().nullable(),
			workSeconds: z.number().int(),
			timeOffSeconds: z.number().int(),
			totalSeconds: z.number().int(),
			totalSoFarSeconds: z.number().int(),
			status: z
				.enum(["on_track", "slightly_behind", "behind"])
				.nullable()
				.describe("Null when no target applies to the person."),
		}),
	),
);

const apiTracking = named(
	"Tracking",
	mirror<ApiTracking>()(
		z.object({
			today: dayKey,
			daySeconds: z.number().int(),
			tolerancePct: z.number(),
			week: apiPeriod,
			month: apiPeriod,
		}),
	),
);

const apiSyncResult = named(
	"SyncResult",
	mirror<ApiSyncResult>()(
		z.object({
			stillRunning: z
				.boolean()
				.describe(
					"The sync took longer than the request may stay open and continues on the server. The four lists are then empty.",
				),
			ran: z.array(z.string()),
			skipped: z.array(z.string()),
			failed: z.array(z.string()),
			off: z.array(z.string()),
		}),
	),
);

const apiTimer = named(
	"Timer",
	mirror<ApiTimer>()(
		z.object({
			id: uuid,
			startedAt: iso,
			droppedAt: iso
				.nullable()
				.describe(
					"Set when the timer passed the person's limit and was dropped. Nothing was logged. Null while it runs.",
				),
			paused: z.boolean(),
			elapsedSeconds: z.number().int(),
			snappedSeconds: z
				.number()
				.int()
				.describe(
					"What confirming would log: the elapsed time, snapped to the nearest quarter hour.",
				),
			serverNow: iso.describe(
				"The instant `elapsedSeconds` was measured at. Count from this, not from the local clock.",
			),
			description: z.string(),
			task: z.object({
				id: uuid,
				name: z.string(),
				needsDescription: z.boolean(),
			}),
			project: z.object({ id: uuid, name: z.string() }).nullable(),
			entry: z
				.object({ id: uuid, date: dayKey, durationSeconds: z.number().int() })
				.nullable()
				.describe(
					"The entry this timer continues, or null when confirming logs a new one.",
				),
			organization: z
				.object({ slug: z.string(), name: z.string(), here: z.boolean() })
				.describe(
					"A timer belongs to the person, not to an organization, so another organization can answer it. `here` says whether it runs in this one.",
				),
		}),
	),
);

const apiTimerState = named(
	"TimerState",
	mirror<ApiTimerState>()(
		z.object({
			timer: apiTimer.nullable().describe("Null when nothing is timing."),
		}),
	),
);

// ── The member screens: preferences, schedule, integrations, the project
// page, reports, Rewind and the home page. ─────────────────────────────────

const ref2 = z.object({ id: uuid, name: z.string() });

const apiNotificationSettings = named(
	"NotificationSettings",
	mirror<ApiNotificationSettings>()(
		z.object({
			logReminders: z
				.boolean()
				.describe("Reminders to log time, by push and by Slack."),
			remindersChannel: z
				.enum(["app", "slack"])
				.describe(
					"`app`: the compliance nudge, the month-end reminder and the admin digest go to the phone when it allows notifications, else to Slack. `slack`: always to Slack.",
				),
		}),
	),
);

const apiTimerSettings = named(
	"TimerSettings",
	mirror<ApiTimerSettings>()(
		z.object({
			maxSeconds: z
				.number()
				.int()
				.describe(
					"A timer that runs longer than this is dropped and logs nothing.",
				),
		}),
	),
);

const apiHiddenTasks = named(
	"HiddenTasks",
	mirror<ApiHiddenTasks>()(
		z.object({
			taskIds: z
				.array(uuid)
				.describe(
					"The tasks the person switched off. They only narrow the task picker.",
				),
		}),
	),
);

const apiFilingRule = named(
	"FilingRule",
	mirror<ApiFilingRule>()(
		z.object({
			id: uuid,
			title: z.string().describe("The meeting title the rule matches."),
			task: ref2.describe("The task the meeting arrives with."),
			targetTask: ref2
				.nullable()
				.describe("The task the meeting is filed under. Null keeps its own."),
			project: z.object({
				id: uuid,
				name: z.string(),
				code: z.string().nullable(),
			}),
			createdAt: iso,
		}),
	),
);

const apiWorkingHoursDay = named(
	"WorkingHoursDay",
	mirror<ApiWorkingHoursDay>()(
		z.object({
			dayOfWeek: z.number().int().describe("0 is Sunday."),
			enabled: z.boolean(),
			startTime: z.string().nullable().describe("HH:mm."),
			endTime: z.string().nullable().describe("HH:mm."),
		}),
	),
);

const apiRecurringBlock = named(
	"RecurringBlock",
	mirror<ApiRecurringBlock>()(
		z.object({
			id: uuid,
			task: ref2,
			project: z
				.object({ id: uuid, name: z.string(), code: z.string().nullable() })
				.nullable(),
			description: z.string(),
			daysOfWeek: z.array(z.number().int()).describe("0 is Sunday."),
			durationSeconds: z.number().int(),
			effectiveFrom: dayKey.nullable(),
			effectiveUntil: dayKey.nullable(),
			active: z.boolean().describe("False while the rule is paused."),
		}),
	),
);

const apiHoliday = named(
	"Holiday",
	mirror<ApiHoliday>()(
		z.object({
			date: dayKey,
			name: z.string(),
			disabled: z.boolean().describe("An admin made the day a working day."),
		}),
	),
);

const apiHolidayDay = named(
	"HolidayDay",
	mirror<ApiHolidayDay>()(z.object({ date: dayKey, name: z.string() })),
);

const integrationSettings = z.object({
	googleAutoSyncMeetings: z.boolean(),
	githubAutoLoadCommits: z.boolean(),
	githubSyncCommitsAsWorkTime: z.boolean(),
	googleAutoSyncMeetingsSince: iso
		.nullable()
		.describe("When the meeting sync went on: the first day it may write to."),
	githubSyncCommitsAsWorkTimeSince: iso
		.nullable()
		.describe("When the commit sync went on: the first day it may write to."),
});

const apiIntegrations = named(
	"Integrations",
	mirror<ApiIntegrations>()(
		z.object({
			github: z.object({
				connected: z.boolean(),
				login: z.string().nullable(),
				unreachable: z
					.boolean()
					.describe("GitHub did not answer. The account is still linked."),
				needsReconnect: z
					.boolean()
					.describe(
						"GitHub refuses the stored grant. Only a new connection in the web app fixes it.",
					),
			}),
			googleCalendar: z.object({
				connected: z.boolean(),
				email: z.string().nullable(),
				unreachable: z
					.boolean()
					.describe("Google did not answer. The account is still linked."),
			}),
			settings: integrationSettings,
		}),
	),
);

const apiIntegrationSettingsResult = named(
	"IntegrationSettings",
	mirror<ApiIntegrationSettingsResult>()(
		integrationSettings.extend({
			synced: z
				.boolean()
				.describe(
					"A sync went on and its first pass finished during the save. False when it continues on the server.",
				),
		}),
	),
);

const apiTimeReport = named(
	"TimeReport",
	mirror<ApiTimeReport>()(
		z.object({
			rows: z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					secondsTotal: z.number().int(),
					timeOffSeconds: z
						.number()
						.int()
						.describe("The teammates tab only. Zero on the others."),
					count: z
						.number()
						.int()
						.describe(
							"Clients: projects with time. Projects: people with time. Teammates: projects.",
						),
					clientName: z.string().nullable(),
					code: z.string().nullable(),
					archived: z.boolean(),
				}),
			),
			totalSeconds: z.number().int(),
			unfiledSeconds: z
				.number()
				.int()
				.describe(
					"Worked time with no project, which the rows leave out. Only for an unfiltered report over the whole organization.",
				),
		}),
	),
);

const apiTimeReportDetail = named(
	"TimeReportDetail",
	mirror<ApiTimeReportDetail>()(
		z.object({
			rows: z.array(
				z.object({
					id: uuid,
					date: dayKey,
					client: ref2,
					project: z.object({
						id: uuid,
						name: z.string(),
						code: z.string().nullable(),
					}),
					task: ref2,
					description: z.string(),
					user: z.object({ id: z.string(), name: z.string() }),
					overtime: z.boolean(),
					durationSeconds: z.number().int(),
				}),
			),
			totalRows: z.number().int(),
			totalSeconds: z.number().int(),
			truncated: z
				.boolean()
				.describe(
					"The rows stop at a cap. The two totals still count every matching entry.",
				),
		}),
	),
);

const apiOvertimeReport = named(
	"OvertimeReport",
	mirror<ApiOvertimeReport>()(
		z.object({
			rows: z.array(
				z.object({
					userId: z.string(),
					name: z.string(),
					count: z.number().int(),
					seconds: z.number().int(),
					entries: z.array(
						z.object({
							id: uuid,
							date: dayKey,
							projectName: z.string(),
							projectCode: z.string().nullable(),
							taskName: z.string(),
							description: z.string(),
							durationSeconds: z.number().int(),
						}),
					),
				}),
			),
			totalSeconds: z.number().int(),
			totalEntries: z.number().int(),
		}),
	),
);

const apiAbsenceReport = named(
	"AbsenceReport",
	mirror<ApiAbsenceReport>()(
		z.object({
			workingDaySeconds: z.number().int(),
			columns: z
				.array(z.object({ key: z.string(), label: z.string() }))
				.describe(
					"One for each absence task. `key` is the system key, or the task id.",
				),
			rows: z.array(
				z.object({
					userId: z.string(),
					name: z.string(),
					seconds: z.number().int(),
					byTask: z
						.record(z.string(), z.number())
						.describe("Seconds for each column, by `key`."),
					entries: z.array(
						z.object({
							id: uuid,
							date: dayKey,
							taskKey: z.string(),
							taskName: z.string(),
							description: z.string(),
							durationSeconds: z.number().int(),
						}),
					),
				}),
			),
		}),
	),
);

const apiTrackingReport = named(
	"TrackingReport",
	mirror<ApiTrackingReport>()(
		z.object({
			year: z.number().int(),
			month: z.number().int(),
			asOf: dayKey.describe("The last day the figures cover."),
			complete: z.boolean(),
			fundSeconds: z
				.number()
				.int()
				.nullable()
				.describe("The month's hour fund. Null when none is set."),
			workingDaysInMonth: z.number().int(),
			workingDaysElapsed: z.number().int(),
			targetSeconds: z.number().int().nullable(),
			tolerancePct: z.number(),
			rows: z.array(
				z.object({
					userId: z.string(),
					name: z.string(),
					email: z.string(),
					memberType: z.string(),
					workSeconds: z.number().int(),
					timeOffSeconds: z.number().int(),
					totalSeconds: z.number().int(),
					targetSeconds: z.number().int().nullable(),
					monthTargetSeconds: z.number().int().nullable(),
					deltaSeconds: z
						.number()
						.int()
						.nullable()
						.describe("Total minus target. Negative is short."),
					status: z
						.enum(["on_track", "slightly_behind", "behind"])
						.nullable()
						.describe("Null when no target applies to the person."),
				}),
			),
		}),
	),
);

const apiAbsenceEntry = named(
	"AbsenceEntry",
	mirror<ApiAbsenceEntry>()(
		z.object({
			id: uuid,
			date: dayKey,
			task: ref2,
			description: z.string(),
			durationSeconds: z.number().int(),
		}),
	),
);

const apiRewind = named(
	"Rewind",
	mirror<ApiRewind>()(
		z.object({
			year: z.number().int(),
			asOf: dayKey,
			complete: z.boolean(),
			workedSeconds: z.number().int(),
			projectedWorkedSeconds: z.number().int().nullable(),
			previousYearWorkedSeconds: z.number().int().nullable(),
			firstDay: dayKey.nullable(),
			daysWorked: z.number().int(),
			longestStreak: z
				.object({ days: z.number().int(), from: dayKey, to: dayKey })
				.nullable(),
			busiestDay: z
				.object({ date: dayKey, seconds: z.number().int() })
				.nullable(),
			months: z.array(
				z.object({
					month: z.number().int(),
					seconds: z.number().int(),
					projectedSeconds: z.number().int(),
				}),
			),
			weekdays: z
				.array(z.number().int())
				.describe("Worked seconds by weekday. Index 0 is Sunday."),
			weekendDaysWorked: z.number().int(),
			overtimeSeconds: z.number().int(),
			projects: z.array(
				z.object({
					id: uuid,
					name: z.string(),
					icon: z.string().nullable(),
					clientName: z.string(),
					seconds: z.number().int(),
				}),
			),
			projectCount: z.number().int(),
			clientCount: z.number().int(),
			tasks: z.array(
				z.object({ id: uuid, name: z.string(), seconds: z.number().int() }),
			),
			groups: z.array(
				z.object({ group: z.string(), seconds: z.number().int() }),
			),
			meetingSeconds: z.number().int(),
			codeReviewSeconds: z.number().int(),
			timeOff: z.object({
				vacationDays: z.number(),
				sickDays: z.number(),
				otherDays: z.number(),
				aheadDays: z.number(),
			}),
			commits: z.number().int(),
			pullRequests: z.object({
				opened: z.number().int(),
				merged: z.number().int(),
				reviewed: z.number().int(),
			}),
			words: z.array(z.object({ word: z.string(), count: z.number().int() })),
		}),
	),
);

const apiHome = named(
	"Home",
	mirror<ApiHome>()(
		z.object({
			today: dayKey,
			from: dayKey,
			to: dayKey,
			daySeconds: z
				.number()
				.int()
				.describe("What one working day is worth for the person this month."),
			days: z.array(
				z.object({
					date: dayKey,
					seconds: z.number().int(),
					holiday: z.string().nullable(),
					mark: z
						.enum(["done", "covered", "short"])
						.nullable()
						.describe(
							"Null for a weekend, a holiday or a day after today. `covered` is a short day that the rest of the week made up for.",
						),
				}),
			),
		}),
	),
);

// ── The workspace admin ──────────────────────────────────────────────────────

const apiReminderSettings = named(
	"ReminderSettings",
	mirror<ApiReminderSettings>()(reminderSettingsInput),
);

const reminderPerson = {
	userId: uuid,
	name: z.string(),
	email: z.string(),
	reason: z.string(),
};

const apiReminderPreview = named(
	"ReminderPreview",
	mirror<ApiReminderPreview>()(
		z.object({
			kind: reminderKind,
			date: dayKey,
			skipped: z
				.string()
				.nullable()
				.describe("Why nothing of this kind goes out on `date`, or null."),
			sendsAt: z
				.string()
				.nullable()
				.describe(
					"HH:mm in the organization's timezone, or null for the end of each person's own workday.",
				),
			recipients: z.array(z.object({ ...reminderPerson, message: z.string() })),
			heldBack: z
				.array(z.object(reminderPerson))
				.describe(
					"People the rules picked and a delivery rule holds back, with the reason.",
				),
		}),
	),
);

const apiInstallUrl = named(
	"InstallUrl",
	mirror<ApiInstallUrl>()(
		z.object({
			url: z
				.string()
				.describe(
					"Open it in the system browser. The provider's callback lands on the web app, which needs a signed-in session there.",
				),
		}),
	),
);

const apiGithubInstallation = named(
	"GithubInstallation",
	mirror<ApiGithubInstallation>()(
		z.object({
			id: uuid,
			installationId: z.number().int().describe("GitHub's own id."),
			accountLogin: z.string(),
			accountType: z.string().describe('"Organization" or "User".'),
			connectedAt: iso,
		}),
	),
);

const apiGithubWorkspace = named(
	"GithubWorkspace",
	mirror<ApiGithubWorkspace>()(
		z.object({
			appConfigured: z
				.boolean()
				.describe("False when the deployment has no GitHub App."),
			installations: z.array(apiGithubInstallation),
		}),
	),
);

const apiGithubDisconnect = named(
	"GithubDisconnect",
	mirror<ApiGithubDisconnect>()(
		z.object({
			uninstall: z
				.enum([
					"not-requested",
					"uninstalled",
					"already-gone",
					"shared",
					"not-configured",
					"failed",
				])
				.describe(
					"What happened to the App on GitHub. `shared`: another workspace still uses the installation, so it stays.",
				),
		}),
	),
);

const apiSlackStatus = named(
	"SlackStatus",
	mirror<ApiSlackStatus>()(
		z.object({
			appConfigured: z
				.boolean()
				.describe("False when the deployment has no Slack app."),
			connected: z.boolean(),
			needsReconnect: z
				.boolean()
				.describe(
					"An install is stored and cannot send. Install again to fix it.",
				),
			reason: z.enum(["rejected", "unreadable"]).nullable(),
			teamId: z.string().nullable(),
			teamName: z.string().nullable(),
			connectedAt: iso.nullable(),
			mappedPeople: z.number().int().nullable(),
		}),
	),
);

const apiSlackMatch = named(
	"SlackMatch",
	mirror<ApiSlackMatch>()(
		z.object({
			mapped: z.number().int().describe("People found in Slack by email."),
		}),
	),
);

const apiSlackTest = named(
	"SlackTest",
	mirror<ApiSlackTest>()(z.object({ sent: z.literal(true) })),
);

const apiWebhookEndpoint = named(
	"WebhookEndpoint",
	mirror<ApiWebhookEndpoint>()(
		z.object({
			id: uuid,
			url: z.string(),
			description: z.string().nullable(),
			enabledEvents: z.array(webhookEventKind),
			secretHint: z
				.string()
				.describe("The last four characters of the signing secret."),
			previousSecretExpiresAt: iso
				.nullable()
				.describe("Set while the secret before a roll still signs."),
			disabledAt: iso.nullable(),
			disabledReason: z.string().nullable(),
			lastSuccessAt: iso.nullable(),
			failingSince: iso.nullable(),
			createdAt: iso,
			createdByName: z.string().nullable(),
		}),
	),
);

const apiWebhookEndpointCreated = named(
	"WebhookEndpointCreated",
	mirror<ApiWebhookEndpointCreated>()(
		z.object({
			endpoint: apiWebhookEndpoint,
			secret: z
				.string()
				.describe("The signing secret. Readable only in this answer."),
		}),
	),
);

const apiWebhookSecret = named(
	"WebhookSecret",
	mirror<ApiWebhookSecret>()(
		z.object({
			secret: z
				.string()
				.describe("The new signing secret. Readable only in this answer."),
		}),
	),
);

const apiWebhookDelivery = named(
	"WebhookDelivery",
	mirror<ApiWebhookDelivery>()(
		z.object({
			id: uuid,
			eventId: uuid,
			kind: z.string(),
			attempt: z.number().int(),
			manual: z.boolean().describe("Queued by Resend, not by the schedule."),
			nextAttemptAt: iso
				.nullable()
				.describe("Set only while the attempt waits to be sent."),
			attemptedAt: iso.nullable(),
			statusCode: z.number().int().nullable(),
			error: z.string().nullable(),
			responseSample: z.string().nullable(),
			durationMs: z.number().int().nullable(),
			createdAt: iso,
			canResend: z
				.boolean()
				.describe("False once the payload was deleted, or before a send."),
		}),
	),
);

const apiWebhookTest = named(
	"WebhookTest",
	mirror<ApiWebhookTest>()(z.object({ eventId: uuid })),
);

const apiWebhookResend = named(
	"WebhookResend",
	mirror<ApiWebhookResend>()(
		z.object({ deliveryId: uuid.describe("The new attempt.") }),
	),
);

/** Any JSON value. Typed to `JsonValue`, so `mirror` can compare it. */
const jsonValue: z.ZodType<JsonValue> = named(
	"JsonValue",
	z.lazy(() =>
		z.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.null(),
			z.array(jsonValue),
			z.record(z.string(), jsonValue),
		]),
	),
);

const auditValue = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.array(z.string()),
]);

const apiAuditEvent = named(
	"AuditEvent",
	mirror<ApiAuditEvent>()(
		z.object({
			id: uuid,
			occurredAt: iso,
			kind: z.string(),
			category: z.string().describe("`change` or `security`."),
			summary: z.string().describe("The sentence the web app shows."),
			actorUserId: z.string().nullable(),
			actorName: z.string().nullable(),
			impersonatorName: z.string().nullable(),
			via: z.string(),
			ip: z.string().nullable(),
			userAgent: z.string().nullable(),
			targetType: z.string().nullable(),
			targetId: z.string().nullable(),
			targetLabel: z.string().nullable(),
			subjectUserId: z.string().nullable(),
			changes: z
				.record(z.string(), z.object({ from: auditValue, to: auditValue }))
				.nullable()
				.describe("Each changed field. A secret reads `[redacted]`."),
			details: z.record(z.string(), jsonValue).nullable(),
		}),
	),
);

const apiAuditPage = named(
	"AuditPage",
	mirror<ApiAuditPage>()(
		z.object({
			events: z.array(apiAuditEvent),
			nextCursor: z
				.string()
				.nullable()
				.describe("Send it as `cursor` for the next page. Null on the last."),
		}),
	),
);

const apiAuditExport = named(
	"AuditExport",
	mirror<ApiAuditExport>()(
		z.object({
			csv: z.string(),
			rows: z.number().int(),
			truncated: z
				.boolean()
				.describe("True when the range held more than 10,000 rows."),
		}),
	),
);

const apiAuditRetention = named(
	"AuditRetention",
	mirror<ApiAuditRetention>()(z.object({ days: z.number().int() })),
);

// ── The assistant ────────────────────────────────────────────────────────────

const apiAssistantSettings = named(
	"AssistantSettings",
	mirror<ApiAssistantSettings>()(
		z.object({
			available: z
				.boolean()
				.describe(
					"False when the deployment has the assistant switched off. The thread routes then answer 404.",
				),
			configured: z.boolean().describe("A usable key is stored."),
			keyUnreadable: z
				.boolean()
				.describe("A key is stored and does not decrypt. Paste it again."),
			enabled: z
				.boolean()
				.describe("False when an admin paused the assistant here."),
			defaultModel: z.string().nullable(),
			keyHint: z
				.string()
				.nullable()
				.describe("The first characters of the key. Never the key."),
			systemPrompt: z.string().nullable(),
			connectedAt: iso.nullable(),
		}),
	),
);

const apiAssistantModel = named(
	"AssistantModel",
	mirror<ApiAssistantModel>()(
		z.object({
			id: z.string(),
			name: z.string(),
			contextLength: z.number().int().nullable(),
			promptPrice: z
				.number()
				.nullable()
				.describe("USD per million prompt tokens."),
			supportsTools: z.boolean(),
		}),
	),
);

const apiAssistantThread = named(
	"AssistantThread",
	mirror<ApiAssistantThread>()(
		z.object({
			id: uuid,
			title: z.string(),
			model: z.string(),
			updatedAt: iso,
		}),
	),
);

const toolCall = z.object({
	id: z.string(),
	name: z.string(),
	arguments: z.string().describe("The raw JSON the model sent."),
});

const apiAssistantMessage = named(
	"AssistantMessage",
	mirror<ApiAssistantMessage>()(
		z.object({
			id: uuid,
			role: z.enum(["user", "assistant", "tool"]),
			content: z.string(),
			toolCalls: z.array(toolCall).nullable(),
			toolCallId: z
				.string()
				.nullable()
				.describe("On a `tool` row: the call it answers."),
			toolName: z.string().nullable(),
			pendingApproval: z
				.boolean()
				.describe(
					"A card waits for an answer. The waiting call is the one in `toolCalls` that no `tool` row answers.",
				),
			approvalDecision: z.enum(["approved", "rejected"]).nullable(),
			approvalSummary: z.string().nullable(),
			approvalPreview: z
				.object({
					columns: z.array(z.string()),
					rows: z.array(
						z.object({ id: z.string(), cells: z.array(z.string()) }),
					),
					note: z.string().nullable(),
					selectable: z.boolean(),
				})
				.nullable(),
			createdAt: iso,
		}),
	),
);

const apiAssistantThreadDetail = named(
	"AssistantThreadDetail",
	mirror<ApiAssistantThreadDetail>()(
		z.object({
			thread: apiAssistantThread,
			messages: z.array(apiAssistantMessage).describe("Oldest first."),
		}),
	),
);

const approvalPreview = z.object({
	columns: z.array(z.string()),
	rows: z.array(z.object({ id: z.string(), cells: z.array(z.string()) })),
	note: z.string().optional(),
});

const apiAssistantEvent = named(
	"AssistantEvent",
	mirror<ApiAssistantEvent>()(
		z
			.discriminatedUnion("type", [
				z.object({
					type: z.literal("message"),
					messageId: uuid,
					role: z.literal("user"),
				}),
				z.object({ type: z.literal("delta"), text: z.string() }),
				z.object({
					type: z.literal("tool_start"),
					toolCallId: z.string(),
					name: z.string(),
					arguments: z.string(),
				}),
				z.object({
					type: z.literal("tool_result"),
					toolCallId: z.string(),
					name: z.string(),
					ok: z.boolean(),
				}),
				z.object({
					type: z.literal("approval_required"),
					messageId: uuid,
					toolCallId: z.string(),
					name: z.string(),
					summary: z.string(),
					arguments: z.string(),
					preview: approvalPreview.nullable(),
					selectable: z.boolean(),
				}),
				z.object({ type: z.literal("title"), title: z.string() }),
				z.object({ type: z.literal("done") }),
				z.object({ type: z.literal("error"), message: z.string() }),
			])
			.describe(
				"One Server-Sent Event: each `data:` line is one of these, as JSON. The turn ends after `done` or `error`.",
			),
	),
);

// The PM, team lead and People screens. The service decides what each caller
// sees; these only describe it.

const apiProjectDetail = named(
	"ProjectDetail",
	mirror<ApiProjectDetail>()(
		apiProject.extend({
			type: z
				.string()
				.describe(
					"`product_team`, `fixed_scope`, `hourly`, `maintenance` or `internal`.",
				),
			icon: z
				.string()
				.nullable()
				.describe("An emoji, or the path of an uploaded image."),
			openToOrg: z
				.boolean()
				.describe("Every member may log time on it without an assignment."),
			budgetSeconds: z
				.number()
				.int()
				.nullable()
				.describe(
					"Fixed scope only. Null also for a caller who may not see money.",
				),
			budgetAmount: z
				.string()
				.nullable()
				.describe("A decimal. Null for a caller who may not see money."),
			hourlyPrice: z
				.string()
				.nullable()
				.describe("A decimal. Null for a caller who may not see money."),
			stats: z.object({
				scope: z
					.enum(["project", "own"])
					.describe(
						"`own` when the caller may not see the project's hours: the figures are the caller's own.",
					),
				monthSeconds: z.number().int(),
				allTimeSeconds: z.number().int(),
				contributorCount: z.number().int(),
				contributors: z
					.array(z.object({ id: uuid, name: z.string() }))
					.describe("At most five. Empty when `scope` is `own`."),
			}),
		}),
	),
);

const apiProjectOverview = named(
	"ProjectOverview",
	mirror<ApiProjectOverview>()(
		z.object({
			allTimeSeconds: z.number().int(),
			entryCount: z.number().int(),
			peopleCount: z
				.number()
				.int()
				.describe("The people who ever logged on it, not the team."),
			firstEntry: dayKey.nullable(),
			lastEntry: dayKey.nullable(),
			overtimeSeconds: z.number().int(),
			monthSeconds: z.number().int(),
			monthPeople: z.number().int(),
		}),
	),
);

const apiProjectMember = named(
	"ProjectMember",
	mirror<ApiProjectMember>()(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.string(),
			role: projectRoleEnum,
			active: z
				.boolean()
				.describe("False for a person who was removed. Their hours stay."),
			allTimeSeconds: z.number().int(),
			lastEntry: dayKey.nullable(),
		}),
	),
);

const apiPersonRef = named(
	"PersonRef",
	mirror<ApiPersonRef>()(
		z.object({ userId: z.string(), name: z.string(), email: z.string() }),
	),
);

const apiManagedTask = named(
	"ManagedTask",
	mirror<ApiManagedTask>()(
		apiTask.extend({
			scope: z
				.string()
				.describe("`site` for a built-in, which cannot be changed."),
			color: z.string().nullable(),
			description: z.string().nullable(),
			archivedAt: iso.nullable(),
			entryCount: z
				.number()
				.int()
				.describe("The organization's entries on the task."),
		}),
	),
);

const apiPerson = named(
	"Person",
	mirror<ApiPerson>()(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.string(),
			orgRole: z.string().describe("`owner`, `admin` or `member`."),
			type: memberTypeEnum,
			expectedSecondsOverride: z
				.number()
				.int()
				.nullable()
				.describe("The monthly target of an hourly person, or null."),
			startDate: dayKey.nullable(),
			archivedAt: iso.nullable().describe("Null for an active person."),
			emailUnconfirmed: z
				.boolean()
				.describe("Never signed in, and nobody confirmed the address."),
			claimPending: z
				.boolean()
				.describe("A Harvest import added them, and they have not joined."),
			leadsPeople: z
				.number()
				.int()
				.describe("The number of people on their team lead list."),
		}),
	),
);

const apiPersonProfile = named(
	"PersonProfile",
	mirror<ApiPersonProfile>()(
		z.object({
			person: apiPerson,
			typeHistory: z
				.array(
					z.object({
						type: memberTypeEnum,
						expectedSecondsOverride: z.number().int().nullable(),
						effectiveFrom: dayKey,
						effectiveUntil: dayKey
							.nullable()
							.describe("Exclusive. Null for the current type."),
					}),
				)
				.describe("Oldest first."),
			leads: z
				.array(apiPersonRef)
				.describe("The people on their team lead list."),
		}),
	),
);

const apiArchiveResult = named(
	"ArchiveResult",
	mirror<ApiArchiveResult>()(
		z.object({
			emailConfirmed: z
				.boolean()
				.describe("True when the call also confirmed the person's address."),
		}),
	),
);

const apiInvitation = named(
	"Invitation",
	mirror<ApiInvitation>()(
		z.object({
			id: z.string(),
			email: z.string(),
			role: z.string().nullable(),
			status: z.string(),
			expiresAt: iso,
			createdAt: iso,
			emailDelivery: z
				.object({
					status: z.enum(["sending", "sent", "failed"]),
					error: z.string().nullable(),
				})
				.nullable()
				.describe("Null for an invitation from before delivery was tracked."),
		}),
	),
);

const apiHourFundMonth = named(
	"HourFundMonth",
	mirror<ApiHourFundMonth>()(
		z.object({
			year: z.number().int(),
			month: z.number().int().describe("1 is January."),
			fundSeconds: z.number().int(),
		}),
	),
);

const apiHourFundSuggestion = named(
	"HourFundSuggestion",
	mirror<ApiHourFundSuggestion>()(
		z.object({
			workingDays: z.number().int(),
			fundSeconds: z.number().int(),
		}),
	),
);

const apiOrganizationSettings = named(
	"OrganizationSettings",
	mirror<ApiOrganizationSettings>()(
		z.object({
			name: z.string(),
			country: z.string().describe("ISO 3166-1 alpha-2."),
			timezone: z.string().describe("An IANA timezone."),
			weekStartsOn: z
				.union([z.literal(0), z.literal(1)])
				.describe("1 is Monday, 0 is Sunday."),
			logo: z.string().nullable(),
		}),
	),
);

const apiMobileDevice = named(
	"MobileDevice",
	mirror<ApiMobileDevice>()(
		z.object({
			installationId: z.string(),
			platform: z.enum(["ios", "android"]),
			appVersion: z.string(),
			notificationsAllowed: z.boolean(),
			liveActivity: z
				.boolean()
				.describe("True when the server holds a Live Activity token."),
			createdAt: iso,
			updatedAt: iso,
		}),
	),
);

// The request bodies the routes parse, under the names the document shows.
named("NewTimeEntry", createTimeEntryInput);
named("TimeEntryPatch", updateTimeEntryInput);
named("FileTimeEntries", fileTimeEntriesInput);
named("CopyDay", copyTimeEntriesInput);
named("CopyWeek", copyWeekEntriesInput);
named("AbsenceRange", logAbsenceRangeInput);
named("StartTimer", startTimerInput);
named("ConfirmTimer", confirmTimerInput);
named("NotificationSettingsPatch", updateNotificationSettingsInput);
named("TaskHidden", setTaskHiddenInput);
named("FilingRulePatch", updateFilingRuleInput);
named("TimerSettingsPatch", timerSettingsInput);
named("WorkingHoursDayPatch", upsertWorkingHoursDayInput);
named("NewRecurringBlock", createRecurringBlockRuleInput);
named("RecurringBlockPatch", updateRecurringBlockRuleInput);
named("IntegrationSettingsPatch", updateIntegrationSettingsInput);
named("ReminderSettingsPatch", updateReminderSettingsInput);
named("SlackTestMessage", sendTestSlackMessageInput);
named("NewWebhookEndpoint", createWebhookEndpointInput);
// The route takes the endpoint's id from the path.
const webhookEndpointPatch = named(
	"WebhookEndpointPatch",
	updateWebhookEndpointInput.omit({ endpointId: true }),
);
named("AuditExportRange", exportAuditEventsInput);
named("AuditRetentionChange", setAuditRetentionInput);
named("AssistantConnect", setAssistantSettingsInput);
named("AssistantSettingsPatch", updateAssistantSettingsInput);
named("NewAssistantThread", createConversationInput);
// The route takes the thread's id from the path.
const assistantThreadRename = named(
	"AssistantThreadRename",
	renameConversationInput.omit({ conversationId: true }),
);
named("AssistantSend", assistantSendInput);
named("AssistantApproval", assistantResolveInput);
named("NewClient", createClientInput);
named("ClientPatch", updateClientInput);
named("NewProject", createProjectInput);
named("ProjectPatch", updateProjectInput);
named("NewProjectMember", assignProjectMemberInput);
named("ProjectMemberRole", changeProjectMemberRoleInput);
named("NewTask", createTaskInput);
named("TaskPatch", updateTaskInput);
named("PersonType", setMemberTypeInput);
named("PersonStartDate", setMemberStartDateInput);
named("PersonRole", setMemberRoleInput);
named("TeamLeadPeople", setTeamLeadPeopleInput);
named("NewInvitation", inviteMemberInput);
named("HourFundEntry", setMonthlyHourFundInput);
named("HourFundMonthRef", monthPeriodInput);
named("HourFundYear", hourFundYearInput);
named("OrganizationPatch", updateOrganizationSettingsInput);

/**
 * The fields of a body that a route takes from its path, by the body's name.
 * The document leaves them out, because a value in the body is overwritten.
 */
const FROM_PATH = {
	TimeEntryPatch: ["timeEntryId"],
	FilingRulePatch: ["id"],
	RecurringBlockPatch: ["ruleId"],
	ClientPatch: ["clientId"],
	ProjectPatch: ["projectId"],
	NewProjectMember: ["projectId"],
	ProjectMemberRole: ["projectId", "userId"],
	TaskPatch: ["taskId"],
	PersonType: ["userId"],
	PersonStartDate: ["userId"],
	PersonRole: ["userId"],
	TeamLeadPeople: ["leadUserId"],
} satisfies { [id: string]: string[] };
named("NewMobileDevice", registerMobileDeviceInput);
named("MobileDevicePatch", updateMobileDeviceInput);

type JsonSchema = z.core.JSONSchema.JSONSchema;

/** `components.schemas`: each schema under the id it was registered with. */
type SchemaComponents = { [id: string]: JsonSchema };

/** The components, with the `$schema` and `$id` that `toJSONSchema` stamps on
 *  each. An OpenAPI document states its dialect once, at the top. */
const componentSchemas = () => {
	const { schemas } = z.toJSONSchema(components, {
		// `input`, because an output object is closed with
		// `additionalProperties: false`, and a response is not: a field can be
		// added to it at any time. A client must ignore the fields it does not
		// know.
		io: "input",
		// A `.refine` has no JSON Schema form. The operation's text says it.
		unrepresentable: "any",
		uri: (id) => `#/components/schemas/${id}`,
	});
	const clean: SchemaComponents = {};
	for (const [id, { $schema: _dialect, $id: _id, ...rest }] of Object.entries(
		schemas,
	)) {
		clean[id] = rest;
	}

	// A route takes these ids from its path, so the body leaves them out.
	for (const [id, fields] of Object.entries(FROM_PATH)) {
		const body = clean[id];
		if (!body?.properties) continue;
		const properties = Object.fromEntries(
			Object.entries(body.properties).filter(
				([name]) => !fields.includes(name),
			),
		);
		const required = body.required?.filter((name) => !fields.includes(name));
		clean[id] = {
			...body,
			properties,
			required: required?.length ? required : undefined,
		};
	}

	// A PATCH body is any subset of the fields, merged over the stored entry.
	const patch = clean.TimeEntryPatch;
	if (patch?.properties) {
		clean.TimeEntryPatch = {
			type: "object",
			properties: patch.properties,
			description:
				"Any subset of the entry's fields. Each one replaces the stored value; `null` clears an optional field.",
		};
	}
	// The same for a phone: the route takes the installation id from the path.
	const devicePatch = clean.MobileDevicePatch;
	if (devicePatch?.properties) {
		const { installationId: _fromPath, ...properties } = devicePatch.properties;
		clean.MobileDevicePatch = {
			type: "object",
			properties,
			description:
				"One or more of the fields. `null` clears the Live Activity token.",
		};
	}
	return clean;
};

type SchemaRef = { $ref: string };

const ref = (schema: z.ZodType): SchemaRef => {
	const id = components.get(schema)?.id;
	if (!id) throw new Error("A response schema is not registered.");
	return { $ref: `#/components/schemas/${id}` };
};

type Method = "get" | "post" | "patch" | "delete";

type Tag =
	| "Account"
	| "Time entries"
	| "Timer"
	| "Time off"
	| "Projects"
	| "Reports"
	| "Schedule"
	| "Preferences"
	| "Integrations"
	| "Reminders"
	| "Workspace integrations"
	| "Webhooks"
	| "Audit log"
	| "Assistant"
	| "People"
	| "Workspace";

type Operation = {
	method: Method;
	/** Relative to `/api/v1`, with `{orgSlug}` and `{id}` where the route has
	 *  them. */
	path: string;
	operationId: string;
	summary: string;
	description?: string;
	tag: Tag;
	/** False only for `GET /meta`. */
	auth?: false;
	/** Query parameters: the properties of this object schema. */
	query?: { schema: z.ZodType; optional: boolean };
	body?: z.ZodType;
	/** The 200 body, or `null` for a 204. */
	response: z.ZodType | null;
	list?: true;
	/** The 200 body is `text/event-stream`, one `response` per event. */
	stream?: true;
	/** Who may call it, when not every member may. It goes into the
	 *  description, and the operation gets a 403. */
	who?: string;
};

const rangeQuery = { schema: listTimeEntriesRangeInput, optional: true };

const REPORT_TEXT =
	"Limited to the caller's scope: an Admin sees everybody, a PM their projects, a Team Lead their people and their projects, and a member only their own time. `from` and `to` are required, and the range can span 366 days at most.";

const RANGE_TEXT =
	"`from` and `to` are optional and default to today in the organization's timezone. The range can span 62 days at most.";

export const OPERATIONS: Operation[] = [
	{
		method: "get",
		path: "/meta",
		operationId: "getMeta",
		summary: "Check the server",
		description:
			"Confirms that the URL is a Farmer server and that the API is switched on. Also gives the contract version, the oldest mobile app it serves and the sign-in methods. Takes no credential.",
		tag: "Account",
		auth: false,
		response: apiMeta,
	},
	{
		method: "get",
		path: "/me",
		operationId: "getMe",
		summary: "Get the signed-in person",
		description:
			"The person the token belongs to, and the organizations they can use.",
		tag: "Account",
		response: apiMe,
	},
	{
		method: "post",
		path: "/me/devices",
		operationId: "registerDevice",
		summary: "Register a phone for native push",
		description:
			"The mobile app sends its relay id and public key. Send it again each time the app comes to the foreground: it replaces the row of the installation. Needs a sign-in session token, not an API token; the row ends with that session.",
		tag: "Account",
		body: registerMobileDeviceInput,
		response: apiMobileDevice,
	},
	{
		method: "patch",
		path: "/me/devices/{installationId}",
		operationId: "updateDevice",
		summary: "Update a phone",
		description:
			"A new Live Activity token, a change of the notification permission or a new app version.",
		tag: "Account",
		body: updateMobileDeviceInput,
		response: apiMobileDevice,
	},
	{
		method: "delete",
		path: "/me/devices/{installationId}",
		operationId: "removeDevice",
		summary: "Forget a phone",
		description:
			"The phone gets no more pushes. A phone that is not registered is not an error.",
		tag: "Account",
		response: null,
	},
	{
		method: "delete",
		path: "/session",
		operationId: "signOut",
		summary: "Revoke the token",
		description:
			"Revokes the token the request sends: it ends a device-flow session, or deletes an API token. The token stops working at once. A read-only API token can revoke itself.",
		tag: "Account",
		response: null,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/whoami",
		operationId: "whoami",
		summary: "Get the person in an organization",
		description:
			"Their role and capabilities, the organization's timezone and first day of the week, their working days and their projects.",
		tag: "Account",
		response: apiWhoami,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/time-entries",
		operationId: "listTimeEntries",
		summary: "List time entries",
		description: RANGE_TEXT,
		tag: "Time entries",
		query: rangeQuery,
		response: apiTimeEntry,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries",
		operationId: "createTimeEntry",
		summary: "Log time",
		description:
			"`durationSeconds` is a multiple of 900 (a quarter hour), and a day holds 24 hours at most. Most tasks need a `description`; time off and a Break do not.",
		tag: "Time entries",
		body: createTimeEntryInput,
		response: apiTimeEntry,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/time-entries/{id}",
		operationId: "updateTimeEntry",
		summary: "Change a time entry",
		tag: "Time entries",
		body: updateTimeEntryInput,
		response: apiTimeEntry,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/time-entries/{id}",
		operationId: "deleteTimeEntry",
		summary: "Delete a time entry",
		tag: "Time entries",
		response: apiDeleted,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/unfiled",
		operationId: "listUnfiled",
		summary: "List unfiled time",
		description: `Worked time that has no project yet, such as a synced meeting. ${RANGE_TEXT}`,
		tag: "Time entries",
		query: rangeQuery,
		response: apiUnfiledEntry,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries/file",
		operationId: "fileTimeEntries",
		summary: "File entries to a project",
		description:
			"Moves up to 200 entries to one project. `remember` also adds a filing rule, so the same meeting goes to that project next time.",
		tag: "Time entries",
		body: fileTimeEntriesInput,
		response: apiFileResult,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries/copy-day",
		operationId: "copyDay",
		summary: "Copy a day",
		description:
			"Copies the entries of `fromDate` to `toDate`. Refuses with `invalid_input` when the copy would pass 24 hours.",
		tag: "Time entries",
		body: copyTimeEntriesInput,
		response: apiCopyResult,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/time-entries/copy-week",
		operationId: "copyWeek",
		summary: "Copy a week",
		description:
			"Copies each day of the week that starts on `fromWeekStart`. A day that would pass 24 hours is left alone and named in `blockedDays`.",
		tag: "Time entries",
		body: copyWeekEntriesInput,
		response: apiCopyResult,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/absences",
		operationId: "listAbsences",
		summary: "List time off in a month",
		description: "The caller's own absence entries in one month.",
		tag: "Time off",
		query: { schema: listMyAbsenceInput, optional: false },
		response: apiAbsenceEntry,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/absences",
		operationId: "logAbsence",
		summary: "Book time off",
		description:
			"Books an absence task on each day from `from` to `to` that the person works. The server skips weekends, public holidays and days already off. The range can span 62 days at most.",
		tag: "Time off",
		body: logAbsenceRangeInput,
		response: apiAbsenceResult,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/absences/{id}",
		operationId: "deleteAbsence",
		summary: "Delete time off",
		tag: "Time off",
		response: apiDeleted,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/home",
		operationId: "getHome",
		summary: "Get the week chart of the home page",
		description:
			"The time logged on each day of this week, the public holidays and the mark of each working day. The day totals are read like `GET /time-entries`, which also computes the fill blocks of the week again.",
		tag: "Time entries",
		response: apiHome,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/timer/settings",
		operationId: "getTimerSettings",
		summary: "Get the timer limit",
		tag: "Timer",
		response: apiTimerSettings,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/timer/settings",
		operationId: "updateTimerSettings",
		summary: "Change the timer limit",
		description: "From one hour (3600) to 24 hours (86400).",
		tag: "Timer",
		body: timerSettingsInput,
		response: apiTimerSettings,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/preferences/notifications",
		operationId: "getNotificationSettings",
		summary: "Get the reminder settings",
		tag: "Preferences",
		response: apiNotificationSettings,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/preferences/notifications",
		operationId: "updateNotificationSettings",
		summary: "Change the reminder settings",
		description: "A field that is not sent keeps its value.",
		tag: "Preferences",
		body: updateNotificationSettingsInput,
		response: apiNotificationSettings,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/preferences/hidden-tasks",
		operationId: "listHiddenTasks",
		summary: "List the switched-off tasks",
		tag: "Preferences",
		response: apiHiddenTasks,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/preferences/hidden-tasks",
		operationId: "setTaskHidden",
		summary: "Switch a task off or on",
		description:
			"`hidden: true` takes the task out of the person's task picker. Absence tasks cannot be switched off. Answers the list after the change.",
		tag: "Preferences",
		body: setTaskHiddenInput,
		response: apiHiddenTasks,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/preferences/hidden-tasks",
		operationId: "showAllTasks",
		summary: "Switch every task on",
		tag: "Preferences",
		response: apiHiddenTasks,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/filing-rules",
		operationId: "listFilingRules",
		summary: "List the filing rules",
		description:
			"Where the person's synced meetings go. A rule is made by filing a meeting with `remember`.",
		tag: "Preferences",
		response: apiFilingRule,
		list: true,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/filing-rules/{id}",
		operationId: "updateFilingRule",
		summary: "Change where a filing rule files",
		description:
			"Send both fields. The title and the task the rule matches cannot change.",
		tag: "Preferences",
		body: updateFilingRuleInput,
		response: apiFilingRule,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/filing-rules/{id}",
		operationId: "deleteFilingRule",
		summary: "Delete a filing rule",
		tag: "Preferences",
		response: apiDeleted,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/working-hours",
		operationId: "listWorkingHours",
		summary: "Get the working hours",
		description:
			"All seven days, 0 (Sunday) to 6. The hours shape the fill blocks and when a reminder comes. They are not a target.",
		tag: "Schedule",
		response: apiWorkingHoursDay,
		list: true,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/working-hours",
		operationId: "updateWorkingHoursDay",
		summary: "Change one day of the working hours",
		description:
			"The body replaces the whole day named by `dayOfWeek`. A time that is not sent is cleared, so send both times for an enabled day.",
		tag: "Schedule",
		body: upsertWorkingHoursDayInput,
		response: apiWorkingHoursDay,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/recurring-blocks",
		operationId: "listRecurringBlocks",
		summary: "List the recurring blocks",
		tag: "Schedule",
		response: apiRecurringBlock,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/recurring-blocks",
		operationId: "createRecurringBlock",
		summary: "Add a recurring block",
		description:
			"`duration` is text such as `30m` or `1h 30m`, at most 24 hours. The same checks as logging time by hand apply.",
		tag: "Schedule",
		body: createRecurringBlockRuleInput,
		response: apiRecurringBlock,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/recurring-blocks/break",
		operationId: "enableBreakBlock",
		summary: "Switch on the daily break",
		description:
			"30 minutes of Break, Monday to Friday. A break rule that exists is switched on again, never copied.",
		tag: "Schedule",
		response: apiRecurringBlock,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/recurring-blocks/{id}",
		operationId: "updateRecurringBlock",
		summary: "Change a recurring block",
		description:
			"Any subset of the fields. `projectId: null` takes the project off, and `active: false` pauses the rule. The blocks already written do not change.",
		tag: "Schedule",
		body: updateRecurringBlockRuleInput,
		response: apiRecurringBlock,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/recurring-blocks/{id}",
		operationId: "deleteRecurringBlock",
		summary: "Delete a recurring block",
		description: "The blocks the rule already wrote stay.",
		tag: "Schedule",
		response: apiDeleted,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/holidays",
		operationId: "listHolidays",
		summary: "List the public holidays of a year",
		description:
			"The holidays of the organization's country. `disabled` marks a day an admin made a working day.",
		tag: "Schedule",
		query: { schema: holidaysYearQueryInput, optional: false },
		response: apiHoliday,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/holidays/range",
		operationId: "listHolidaysInRange",
		summary: "List the holidays between two days",
		description:
			"Only the holidays that are days off. `from` and `to` are optional and default to today in the organization's timezone. The range can span 366 days at most.",
		tag: "Schedule",
		query: { schema: listHolidaysForRangeInput, optional: true },
		response: apiHolidayDay,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/integrations",
		operationId: "getIntegrations",
		summary: "Get the GitHub and Google Calendar connections",
		description:
			"To connect an account, open Settings → Integrations in the web app. That is an OAuth flow in the browser.",
		tag: "Integrations",
		response: apiIntegrations,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/integrations/settings",
		operationId: "updateIntegrationSettings",
		summary: "Change the integration switches",
		description:
			"A field that is not sent keeps its value. When a sync goes on, its first pass starts at once.",
		tag: "Integrations",
		body: updateIntegrationSettingsInput,
		response: apiIntegrationSettingsResult,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/integrations/github",
		operationId: "disconnectGithub",
		summary: "Disconnect GitHub",
		description:
			"404 when GitHub is not connected. Refused when the account is the person's only way to sign in.",
		tag: "Integrations",
		response: apiIntegrations,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/integrations/google-calendar",
		operationId: "disconnectGoogleCalendar",
		summary: "Disconnect Google Calendar",
		description:
			"404 when Google Calendar is not connected. Sign in with Google is a different connection and stays.",
		tag: "Integrations",
		response: apiIntegrations,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reports/time",
		operationId: "getTimeReport",
		summary: "Get the Time report",
		description: `Hours by client, project or person (\`tab\`). ${REPORT_TEXT}`,
		tag: "Reports",
		query: { schema: timeReportSummaryInput, optional: false },
		response: apiTimeReport,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reports/time/detail",
		operationId: "getTimeReportDetail",
		summary: "Get the entries behind the Time report",
		description: `The rows stop at a cap; \`truncated\` says so, and the totals count every entry. ${REPORT_TEXT}`,
		tag: "Reports",
		query: { schema: timeReportDetailInput, optional: false },
		response: apiTimeReportDetail,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reports/overtime",
		operationId: "getOvertimeReport",
		summary: "Get the Overtime report",
		description: REPORT_TEXT,
		tag: "Reports",
		query: { schema: overtimeReportInput, optional: false },
		response: apiOvertimeReport,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reports/tracking",
		operationId: "getTrackingReport",
		summary: "Get the Tracking report",
		description:
			"Work and time off against the month's hour fund, for each person the caller may see. A member sees only their own row.",
		tag: "Reports",
		query: { schema: monthReportInput, optional: false },
		response: apiTrackingReport,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reports/absence",
		operationId: "getAbsenceReport",
		summary: "Get the Absence report",
		description:
			"Time off by person and by absence task, for each person the caller may see. The range can span 366 days at most.",
		tag: "Reports",
		query: { schema: absenceReportInput, optional: false },
		response: apiAbsenceReport,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/rewind",
		operationId: "getRewind",
		summary: "Get the year in review",
		description:
			"The caller's own year. A year that has not opened yet gets `invalid_input`. `asOf` has an effect on a development server only.",
		tag: "Reports",
		query: { schema: rewindInput, optional: false },
		response: apiRewind,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects",
		operationId: "listProjects",
		summary: "List projects",
		description:
			"The projects the caller can open: every project for an admin, else the caller's own projects and the ones open to the organization. The money is null for a caller who may not see it, and `stats.scope` says whose hours the figures sum.",
		tag: "Projects",
		response: apiProjectDetail,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/clients",
		operationId: "listClients",
		summary: "List clients",
		description:
			"The active clients of the organization. Send `includeArchived=true` for the archived ones too.",
		tag: "Projects",
		query: { schema: listClientsInput, optional: true },
		response: apiClient,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/repository-projects",
		operationId: "listRepositoryProjects",
		summary: "List the projects of a repository",
		description:
			"The caller's projects that a GitHub repository (`owner/name`) is linked to.",
		tag: "Projects",
		query: { schema: repositoryProjectsInput, optional: false },
		response: apiProject,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/tasks",
		operationId: "listTasks",
		summary: "List tasks",
		tag: "Projects",
		response: apiTaskList,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/tracking",
		operationId: "getTracking",
		summary: "Get the week and month against target",
		description: "The same figures as the home page.",
		tag: "Time entries",
		response: apiTracking,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/sync",
		operationId: "sync",
		summary: "Sync now",
		description:
			"Runs the caller's automations, the same as Sync now in the web app.",
		tag: "Time entries",
		response: apiSyncResult,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/timer",
		operationId: "getTimer",
		summary: "Get the timer",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer",
		operationId: "startTimer",
		summary: "Start the timer",
		description:
			"Send `taskId`, or `timeEntryId` to continue an existing entry. `headStartSeconds` is time already worked before the start.",
		tag: "Timer",
		body: startTimerInput,
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer/pause",
		operationId: "pauseTimer",
		summary: "Pause the timer",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer/resume",
		operationId: "resumeTimer",
		summary: "Resume the timer",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/timer/confirm",
		operationId: "confirmTimer",
		summary: "Stop the timer and log the time",
		description:
			"Logs the entry and clears the timer. Send `snappedSeconds` from the timer as `durationSeconds`, or a figure the person corrected.",
		tag: "Timer",
		body: confirmTimerInput,
		response: apiTimeEntry,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/timer",
		operationId: "discardTimer",
		summary: "Discard the timer",
		description: "Clears the timer without logging anything.",
		tag: "Timer",
		response: apiTimerState,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reminders",
		operationId: "getReminderSettings",
		summary: "Get the reminder settings",
		description:
			"The defaults when the organization never saved any. Admin only.",
		tag: "Reminders",
		who: "An admin.",
		response: apiReminderSettings,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/reminders",
		operationId: "updateReminderSettings",
		summary: "Change the reminder settings",
		description:
			"Saves the fields it sends and leaves the others alone. Times are HH:mm on a quarter hour, from 07:00 to 20:00. Admin only.",
		tag: "Reminders",
		who: "An admin.",
		body: updateReminderSettingsInput,
		response: apiReminderSettings,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/reminders/preview",
		operationId: "previewReminder",
		summary: "Preview who gets a reminder",
		description:
			"Who gets one kind of reminder on one day, by the rules the job sends by, and who a delivery rule holds back. Admin only.",
		tag: "Reminders",
		who: "An admin.",
		query: { schema: reminderPreviewInput, optional: false },
		response: apiReminderPreview,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/workspace-integrations/github",
		operationId: "getGithubWorkspace",
		summary: "List the GitHub installations",
		description:
			"The GitHub App installations connected to this workspace. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		response: apiGithubWorkspace,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/workspace-integrations/github/install-url",
		operationId: "getGithubInstallUrl",
		summary: "Get the GitHub App install page",
		description:
			"Open the URL in the system browser. GitHub then sends the browser to the web app, which connects the installation. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		response: apiInstallUrl,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/workspace-integrations/github/installations/{id}",
		operationId: "disconnectGithubInstallation",
		summary: "Disconnect a GitHub installation",
		description:
			"`?uninstall=true` also removes the App from the GitHub account, unless another workspace still uses it. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		query: {
			schema: z.object({
				uninstall: z
					.boolean()
					.describe("Also remove the App from the GitHub account."),
			}),
			optional: true,
		},
		response: apiGithubDisconnect,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/workspace-integrations/slack",
		operationId: "getSlackStatus",
		summary: "Get the Slack connection",
		description: "The bot token is never in the answer. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		response: apiSlackStatus,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/workspace-integrations/slack",
		operationId: "disconnectSlack",
		summary: "Disconnect Slack",
		description:
			"Forgets the bot token and every Slack match. Answers the status after it. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		response: apiSlackStatus,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/workspace-integrations/slack/install-url",
		operationId: "getSlackInstallUrl",
		summary: "Get the Add to Slack page",
		description:
			"Open the URL in the system browser. Slack then sends the browser to the web app, which stores the install. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		response: apiInstallUrl,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/workspace-integrations/slack/match-people",
		operationId: "matchSlackPeople",
		summary: "Match people to Slack",
		description:
			"Finds the Slack account of each active member by email. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		response: apiSlackMatch,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/workspace-integrations/slack/test",
		operationId: "sendSlackTest",
		summary: "Send a test message on Slack",
		description:
			"Sends one member a test message, through the path the reminders take. Admin only.",
		tag: "Workspace integrations",
		who: "An admin.",
		body: sendTestSlackMessageInput,
		response: apiSlackTest,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/webhooks",
		operationId: "listWebhookEndpoints",
		summary: "List webhook endpoints",
		description: "Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		response: apiWebhookEndpoint,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/webhooks",
		operationId: "createWebhookEndpoint",
		summary: "Add a webhook endpoint",
		description:
			"The URL must be HTTPS and reach a public address. The answer holds the signing secret, and no later answer does. An organization can have five endpoints. Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		body: createWebhookEndpointInput,
		response: apiWebhookEndpointCreated,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/webhooks/{id}",
		operationId: "getWebhookEndpoint",
		summary: "Get a webhook endpoint",
		description: "Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		response: apiWebhookEndpoint,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/webhooks/{id}",
		operationId: "updateWebhookEndpoint",
		summary: "Change a webhook endpoint",
		description:
			"Changes the fields it sends. `disabled` switches the endpoint off and on. Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		body: webhookEndpointPatch,
		response: apiWebhookEndpoint,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/webhooks/{id}",
		operationId: "deleteWebhookEndpoint",
		summary: "Delete a webhook endpoint",
		description: "Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		response: apiDeleted,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/webhooks/{id}/roll-secret",
		operationId: "rollWebhookSecret",
		summary: "Roll the signing secret",
		description:
			"The answer holds the new secret, and no later answer does. The old secret also signs for 24 hours. Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		response: apiWebhookSecret,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/webhooks/{id}/test",
		operationId: "sendWebhookTest",
		summary: "Send a test event",
		description:
			"Queues a `webhook.test` event for this endpoint. The delivery job sends it; read the delivery log for the result. Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		response: apiWebhookTest,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/webhooks/{id}/deliveries",
		operationId: "listWebhookDeliveries",
		summary: "List the delivery log",
		description: "The attempts for one endpoint, newest first. Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		query: {
			schema: listWebhookDeliveriesInput.omit({ endpointId: true }),
			optional: true,
		},
		response: apiWebhookDelivery,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/webhooks/deliveries/{id}/resend",
		operationId: "resendWebhookDelivery",
		summary: "Send a delivery again",
		description:
			"Queues one more attempt at the event behind a logged delivery. Refused once the payload was deleted, after three days. Admin only.",
		tag: "Webhooks",
		who: "An admin.",
		response: apiWebhookResend,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/audit-log",
		operationId: "listAuditEvents",
		summary: "List the audit log",
		description:
			"One page of 50 events, newest first. `userId` matches the person who did it or the person it happened to. `from` and `to` are days in the organization's timezone. Admin only.",
		tag: "Audit log",
		who: "An admin.",
		query: { schema: listAuditEventsInput, optional: true },
		response: apiAuditPage,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/audit-log/export",
		operationId: "exportAuditEvents",
		summary: "Export the audit log",
		description:
			"The events as CSV, for at most a year and 10,000 rows. The export is itself recorded in the log. Admin only.",
		tag: "Audit log",
		who: "An admin.",
		body: exportAuditEventsInput,
		response: apiAuditExport,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/audit-log/retention",
		operationId: "getAuditRetention",
		summary: "Get how long the log is kept",
		description: "In days. Admin only.",
		tag: "Audit log",
		who: "An admin.",
		response: apiAuditRetention,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/audit-log/retention",
		operationId: "setAuditRetention",
		summary: "Change how long the log is kept",
		description: "90, 365, 730 or 2555 days. Admin only.",
		tag: "Audit log",
		who: "An admin.",
		body: setAuditRetentionInput,
		response: apiAuditRetention,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/assistant/settings",
		operationId: "getAssistantSettings",
		summary: "Get the assistant settings",
		description:
			"Any member. Show the chat only when `available`, `configured` and `enabled` are all true.",
		tag: "Assistant",
		response: apiAssistantSettings,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/assistant/settings",
		operationId: "connectAssistant",
		summary: "Connect the AI provider",
		description:
			"Stores an OpenRouter key and the default model. The server checks the key with OpenRouter first, and never sends it back. Admin only.",
		tag: "Assistant",
		who: "An admin.",
		body: setAssistantSettingsInput,
		response: apiAssistantSettings,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/assistant/settings",
		operationId: "updateAssistantSettings",
		summary: "Change the assistant settings",
		description:
			"The default model, the pause switch and the house rules. `systemPrompt: null` clears the rules. Admin only.",
		tag: "Assistant",
		who: "An admin.",
		body: updateAssistantSettingsInput,
		response: apiAssistantSettings,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/assistant/settings",
		operationId: "disconnectAssistant",
		summary: "Disconnect the AI provider",
		description:
			"Forgets the key. Threads stay. Works also when the deployment has the assistant switched off. Admin only.",
		tag: "Assistant",
		who: "An admin.",
		response: apiAssistantSettings,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/assistant/models",
		operationId: "listAssistantModels",
		summary: "List the models",
		description: "The OpenRouter models that can call tools. Admin only.",
		tag: "Assistant",
		who: "An admin.",
		response: apiAssistantModel,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/assistant/threads",
		operationId: "listAssistantThreads",
		summary: "List your threads",
		description: "The caller's own threads, newest first, at most 100.",
		tag: "Assistant",
		response: apiAssistantThread,
		list: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/assistant/threads",
		operationId: "createAssistantThread",
		summary: "Start a thread",
		description: "The thread uses the organization's default model.",
		tag: "Assistant",
		body: createConversationInput,
		response: apiAssistantThread,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/assistant/threads/{id}",
		operationId: "getAssistantThread",
		summary: "Read a thread",
		description: "Another person's thread is a 404.",
		tag: "Assistant",
		response: apiAssistantThreadDetail,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/assistant/threads/{id}",
		operationId: "renameAssistantThread",
		summary: "Rename a thread",
		tag: "Assistant",
		body: assistantThreadRename,
		response: apiAssistantThread,
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/assistant/threads/{id}",
		operationId: "deleteAssistantThread",
		summary: "Delete a thread",
		tag: "Assistant",
		response: apiDeleted,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/assistant/threads/{id}/messages",
		operationId: "sendAssistantMessage",
		summary: "Send a message",
		description:
			"Streams the answer as Server-Sent Events. A message sent while an approval waits declines it. Each person can start 20 turns a minute.",
		tag: "Assistant",
		body: assistantSendInput,
		response: apiAssistantEvent,
		stream: true,
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/assistant/threads/{id}/approvals",
		operationId: "answerAssistantApproval",
		summary: "Approve or reject a write",
		description:
			"Answers the call that `approval_required` named, and streams the rest of the turn. For a batch, `selectedRowIds` keeps only those rows; an empty list rejects. An approval counts as a turn.",
		tag: "Assistant",
		body: assistantResolveInput,
		response: apiAssistantEvent,
		stream: true,
	},
	// The PM, team lead and People screens.
	{
		method: "post",
		path: "/orgs/{orgSlug}/projects",
		operationId: "createProject",
		summary: "Create a project",
		description:
			"The caller becomes its PM. The type decides which of the budget and the hourly price it may carry.",
		tag: "Projects",
		body: createProjectInput,
		response: apiProjectDetail,
		who: "An admin, or a PM or team lead on any project.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects/{id}",
		operationId: "getProject",
		summary: "Get a project",
		description:
			"For an admin, a person on the project, or a project open to the organization. The money is null for a caller below PM, and below team lead `stats.scope` is `own`: the figures are the caller's own hours.",
		tag: "Projects",
		response: apiProjectDetail,
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/projects/{id}",
		operationId: "updateProject",
		summary: "Change a project",
		description:
			"A patch: a field that is not sent stays. Send `type` with its budget or price.",
		tag: "Projects",
		body: updateProjectInput,
		response: apiProjectDetail,
		who: "An admin, or a PM on the project.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/projects/{id}/archive",
		operationId: "archiveProject",
		summary: "Archive a project",
		description: "Its entries and reports stay.",
		tag: "Projects",
		response: apiProjectDetail,
		who: "An admin, or a PM on the project.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/projects/{id}/restore",
		operationId: "restoreProject",
		summary: "Restore a project",
		tag: "Projects",
		response: apiProjectDetail,
		who: "An admin, or a PM on the project.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects/{id}/overview",
		operationId: "getProjectOverview",
		summary: "Get a project's all-time figures",
		description:
			"A plain member gets 403. The entries of the project are `GET /orgs/{orgSlug}/reports/time/detail?projectId=`.",
		tag: "Projects",
		response: apiProjectOverview,
		who: "An admin, or a PM or team lead on the project.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects/{id}/tasks",
		operationId: "listProjectTasks",
		summary: "List the tasks of a project",
		description: "Every live task of the organization and the built-ins.",
		tag: "Projects",
		response: apiTask,
		list: true,
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects/{id}/assignable",
		operationId: "listAssignable",
		summary: "List the people who can join a project",
		description: "Every active member of the organization.",
		tag: "Projects",
		response: apiPersonRef,
		list: true,
		who: "An admin, or a PM or team lead on the project.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/projects/{id}/members",
		operationId: "listProjectMembers",
		summary: "List a project's team",
		description: "Removed people stay in the list with `active` false.",
		tag: "Projects",
		response: apiProjectMember,
		list: true,
		who: "An admin, or a PM or team lead on the project.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/projects/{id}/members",
		operationId: "addProjectMember",
		summary: "Add a person to a project",
		description:
			"A non-admin can give a role up to their own rank, never above it. An archived person is refused. Answers the team.",
		tag: "Projects",
		body: assignProjectMemberInput,
		response: apiProjectMember,
		list: true,
		who: "An admin, or a PM or team lead on the project.",
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/projects/{id}/members/{userId}",
		operationId: "changeProjectRole",
		summary: "Change a person's role on a project",
		description:
			"Capped at the caller's own rank, for the role the person has and the role they get. Answers the team.",
		tag: "Projects",
		body: changeProjectMemberRoleInput,
		response: apiProjectMember,
		list: true,
		who: "An admin, or a PM or team lead on the project.",
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/projects/{id}/members/{userId}",
		operationId: "removeProjectMember",
		summary: "Remove a person from a project",
		description:
			"The assignment becomes inactive and the person keeps their hours. Answers the team.",
		tag: "Projects",
		response: apiProjectMember,
		list: true,
		who: "An admin, or a PM or team lead on the project.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/clients",
		operationId: "createClient",
		summary: "Create a client",
		tag: "Projects",
		body: createClientInput,
		response: apiClient,
		who: "An admin, or a PM or team lead on any project.",
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/clients/{id}",
		operationId: "updateClient",
		summary: "Rename a client",
		tag: "Projects",
		body: updateClientInput,
		response: apiClient,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/clients/{id}/archive",
		operationId: "archiveClient",
		summary: "Archive a client",
		description: "Refused while the client has an active project.",
		tag: "Projects",
		response: apiClient,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/clients/{id}/restore",
		operationId: "restoreClient",
		summary: "Restore a client",
		tag: "Projects",
		response: apiClient,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/tasks/managed",
		operationId: "listManagedTasks",
		summary: "List the tasks to manage",
		description:
			"The built-ins and the organization's own tasks, archived ones too.",
		tag: "Workspace",
		response: apiManagedTask,
		list: true,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/tasks",
		operationId: "createTask",
		summary: "Create a task",
		tag: "Workspace",
		body: createTaskInput,
		response: apiManagedTask,
		who: "An admin.",
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/tasks/{id}",
		operationId: "updateTask",
		summary: "Change a task",
		description: "A built-in is refused.",
		tag: "Workspace",
		body: updateTaskInput,
		response: apiManagedTask,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/tasks/{id}/archive",
		operationId: "archiveTask",
		summary: "Archive a task",
		description: "A built-in is refused. The entries keep the task.",
		tag: "Workspace",
		response: apiManagedTask,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/tasks/{id}/restore",
		operationId: "restoreTask",
		summary: "Restore a task",
		description: "Refused while a live task has the same name.",
		tag: "Workspace",
		response: apiManagedTask,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/people",
		operationId: "listPeople",
		summary: "List the people",
		tag: "People",
		response: apiPerson,
		list: true,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/people/{userId}",
		operationId: "getPerson",
		summary: "Get a person",
		description:
			"Their row, the history of their type and their team lead list.",
		tag: "People",
		response: apiPersonProfile,
		who: "An admin.",
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/people/{userId}",
		operationId: "removePerson",
		summary: "Remove a person",
		description:
			"Ends the membership. Archive a person who has left instead; their history stays either way. Nobody removes themselves or the only owner.",
		tag: "People",
		response: apiDeleted,
		who: "An admin. A device-flow or browser session only: an API token gets 403, because better-auth makes the change.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/role",
		operationId: "setPersonRole",
		summary: "Change a person's role",
		description: "Nobody changes their own role or the owner's.",
		tag: "People",
		body: setMemberRoleInput,
		response: apiPerson,
		who: "An admin. A device-flow or browser session only: an API token gets 403, because better-auth makes the change.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/type",
		operationId: "setPersonType",
		summary: "Change a person's type",
		description:
			"From `effectiveFrom` on. Earlier months keep the type they had.",
		tag: "People",
		body: setMemberTypeInput,
		response: apiPersonProfile,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/start-date",
		operationId: "setPersonStartDate",
		summary: "Set a person's start date",
		description: "`null` clears it.",
		tag: "People",
		body: setMemberStartDateInput,
		response: apiPersonProfile,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/archive",
		operationId: "archivePerson",
		summary: "Archive a person",
		description:
			"They keep every entry and leave every team lead list. Nobody archives themselves.",
		tag: "People",
		response: apiArchiveResult,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/restore",
		operationId: "restorePerson",
		summary: "Restore a person",
		description:
			"For a person who never signed in, this also confirms the address.",
		tag: "People",
		response: apiArchiveResult,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/confirm-email",
		operationId: "confirmPersonEmail",
		summary: "Confirm a person's address",
		description:
			"Only for a person who never signed in and is in no other organization.",
		tag: "People",
		response: apiArchiveResult,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/people/{userId}/team",
		operationId: "listTeamLeadPeople",
		summary: "List a team lead's people",
		tag: "People",
		response: apiPersonRef,
		list: true,
		who: "An admin, or the team lead themselves.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/people/{userId}/team",
		operationId: "setTeamLeadPeople",
		summary: "Replace a team lead's people",
		description:
			"The whole list. An archived person is refused, and the lead is never on their own list.",
		tag: "People",
		body: setTeamLeadPeopleInput,
		response: apiPersonRef,
		list: true,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/invitations",
		operationId: "listInvitations",
		summary: "List the pending invitations",
		tag: "People",
		response: apiInvitation,
		list: true,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/invitations",
		operationId: "invite",
		summary: "Invite a person",
		description:
			"Sends the email, and a Slack message when the address is in the workspace's Slack.",
		tag: "People",
		body: inviteMemberInput,
		response: apiInvitation,
		who: "An admin. A device-flow or browser session only: an API token gets 403, because better-auth makes the change.",
	},
	{
		method: "delete",
		path: "/orgs/{orgSlug}/invitations/{id}",
		operationId: "cancelInvitation",
		summary: "Cancel an invitation",
		tag: "People",
		response: apiDeleted,
		who: "An admin. A device-flow or browser session only: an API token gets 403, because better-auth makes the change.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/invitations/{id}/resend",
		operationId: "resendInvitation",
		summary: "Send an invitation again",
		description: "Moves its expiry forward.",
		tag: "People",
		response: apiInvitation,
		who: "An admin. A device-flow or browser session only: an API token gets 403, because better-auth makes the change.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/hour-fund",
		operationId: "listHourFund",
		summary: "List the hour fund of a year",
		description:
			"A month with no row has no fund, which is not a fund of zero.",
		tag: "Workspace",
		query: { schema: hourFundYearInput, optional: false },
		response: apiHourFundMonth,
		list: true,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/hour-fund",
		operationId: "setHourFund",
		summary: "Set the fund of a month",
		description: "Answers the year.",
		tag: "Workspace",
		body: setMonthlyHourFundInput,
		response: apiHourFundMonth,
		list: true,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/hour-fund/clear",
		operationId: "clearHourFund",
		summary: "Clear the fund of a month",
		description: "The month has no fund again. Answers the year.",
		tag: "Workspace",
		body: monthPeriodInput,
		response: apiHourFundMonth,
		list: true,
		who: "An admin.",
	},
	{
		method: "post",
		path: "/orgs/{orgSlug}/hour-fund/prefill",
		operationId: "prefillHourFund",
		summary: "Fill a year from the holiday calendar",
		description: "Only the months with no fund. Answers the year.",
		tag: "Workspace",
		body: hourFundYearInput,
		response: apiHourFundMonth,
		list: true,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/hour-fund/suggestion",
		operationId: "suggestHourFund",
		summary: "Suggest the fund of a month",
		description:
			"The weekdays that are not public holidays, at 8 hours each. Nothing is stored.",
		tag: "Workspace",
		query: { schema: monthPeriodInput, optional: false },
		response: apiHourFundSuggestion,
		who: "An admin.",
	},
	{
		method: "get",
		path: "/orgs/{orgSlug}/organization",
		operationId: "getOrganization",
		summary: "Get the organization's settings",
		tag: "Workspace",
		response: apiOrganizationSettings,
		who: "An admin.",
	},
	{
		method: "patch",
		path: "/orgs/{orgSlug}/organization",
		operationId: "updateOrganization",
		summary: "Change the organization's settings",
		description: "A patch. A timezone that is not an IANA name is refused.",
		tag: "Workspace",
		body: updateOrganizationSettingsInput,
		response: apiOrganizationSettings,
		who: "An admin.",
	},
];

const TAG_TEXT = {
	Account: "The server, the token and the person it belongs to.",
	"Time entries": "The timesheet: read it, log time, file it and copy it.",
	Timer: "The stopwatch. One per person, across every organization.",
	"Time off": "Vacation, sick leave and the other absence tasks.",
	Reports:
		"The four Reports tabs and Rewind. Each report is limited to the people and the projects the caller may see.",
	Schedule:
		"The person's working hours, recurring blocks and the public holidays.",
	Preferences: "The person's own settings.",
	Integrations:
		"The person's GitHub and Google Calendar connections. Connecting is a browser flow in the web app.",
	Reminders: "When the reminders go out, and to whom. Admin only.",
	"Workspace integrations":
		"The workspace's GitHub App and Slack. Admin only. A secret is never in an answer.",
	Webhooks:
		"Outbound webhook endpoints and their delivery log. Admin only. A signing secret is readable only when it is made.",
	"Audit log":
		"Who changed what in the workspace, and every sign-in. Admin only.",
	Assistant:
		"The AI assistant: its provider settings, your threads, and a turn streamed as Server-Sent Events.",
	Projects:
		"What a person can log time against, a project's page, and, for a PM or a team lead, the projects, their teams and the clients.",
	People:
		"Settings → People: the people of the workspace, their invitations and the team lead lists.",
	Workspace:
		"The workspace settings an admin keeps: the task list, the hour fund and the organization.",
} satisfies Record<Tag, string>;

/** Preferences → API tokens in the reader's own workspace: `:org` is the
 *  placeholder the `/$orgSlug` guard resolves (lib/org-redirect.ts), and the
 *  chooser keeps the fragment when the reader has more than one. */
const API_TOKENS_PAGE = "/:org/settings/preferences#api-tokens";

const INTRO = `The REST API that the \`farmer\` CLI uses. Every call acts as one person and can do only what that person can do in the web app.

## Authentication

Send a token in the \`Authorization\` header:

\`\`\`sh
curl "$FARMER/api/v1/me" -H "Authorization: Bearer <token>"
\`\`\`

The examples set \`FARMER\` to your deployment's address. There are two kinds of token.

### API token (recommended)

Use an API token for a script, a scheduled job or an integration. Make one in Farmer at [Preferences → API tokens](${API_TOKENS_PAGE}). A token starts with \`${API_TOKEN_PREFIX}\`, and Farmer shows it only once.

- **Access.** A read-only token gets 403 \`forbidden\` on a request that changes data. Give the token write access only if the script needs it.
- **Workspaces.** A token can work in one workspace only, or in all the workspaces of its owner.
- **Expiry.** A token expires after 30 days, 90 days or one year, or never. Revoke a token [in Preferences](${API_TOKENS_PAGE}) at any time.

### Device flow

The \`farmer\` CLI uses the device flow ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), because a person approves each login in a browser. Use it for a tool that a person runs interactively. Do not use it for a script that runs without a person.

**1. Ask for a code.**

\`\`\`sh
curl -X POST "$FARMER/api/auth/device/code" \\
  -H "Content-Type: application/json" \\
  -d '{"client_id": "${CLI_CLIENT_ID}"}'
\`\`\`

The answer holds \`device_code\`, \`verification_uri_complete\` and \`interval\`.

**2. Approve it.** Open \`verification_uri_complete\` in a browser, sign in and approve the code.

**3. Collect the token.** Send this every \`interval\` seconds until the answer holds \`access_token\`:

\`\`\`sh
curl -X POST "$FARMER/api/auth/device/token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "<device_code>",
    "client_id": "${CLI_CLIENT_ID}"
  }'
\`\`\`

**4. Use it** as the bearer token.

\`DELETE /session\` revokes the token that the request sends, of either kind.

## Organizations

Most routes start with \`/orgs/{orgSlug}\`. \`GET /me\` lists the slugs the token can use. A token for one workspace lists only that workspace.

## Errors

An error answers the \`Error\` body. Branch on \`code\`, not on the \`error\` text.

| Status | \`code\` | Meaning |
| --- | --- | --- |
| 401 | \`unauthorized\` | No token, a token that is not valid or has expired, or an organization the person is not in or the token cannot use. |
| 403 | \`forbidden\` | The person may not do this, for example log time on a project they are not assigned to. A read-only API token also gets 403 on a request that changes data. |
| 404 | \`not_found\` | No such record. |
| 422 | \`invalid_input\` | The body or the query is not valid, or the values break a rule, such as a day over 24 hours. \`issues\` names each field. |
| 429 | \`rate_limited\` | Too many calls. Wait for \`Retry-After\` seconds. |
| 500 | \`server_error\` | Something failed on the server. |

The CLI also sends \`${CLI_VERSION_HEADER}\` and can get 426 \`cli_outdated\`. Other clients do not send the header, so they never get 426.

## Compatibility

A response can get new fields at any time. Ignore the fields you do not know.`;

type ResponseObject = {
	description: string;
	content?:
		| {
				"application/json": {
					schema: SchemaRef | { type: "array"; items: SchemaRef };
				};
		  }
		| { "text/event-stream": { schema: SchemaRef } };
};

/** An operation's responses, keyed by status code. */
type Responses = { [status: string]: ResponseObject };

const errorResponse = (description: string): ResponseObject => ({
	description,
	content: { "application/json": { schema: ref(apiError) } },
});

/** The parameters of a query schema, one per property. */
const queryParameters = (query: NonNullable<Operation["query"]>) => {
	const json = z.toJSONSchema(query.schema, {
		io: "input",
		unrepresentable: "any",
	});
	const required = new Set(query.optional ? [] : (json.required ?? []));
	return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
		name,
		in: "query",
		required: required.has(name),
		schema,
	}));
};

const pathParameters = (path: string, orgSlug: string | undefined) =>
	[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
		name,
		in: "path",
		required: true,
		schema: { type: "string" },
		description:
			name === "orgSlug"
				? "The organization's slug, from `GET /me`."
				: name === "userId"
					? "The person's user id."
					: name === "installationId"
						? "The id the app made for its installation."
						: "The row's id.",
		example: name === "orgSlug" ? orgSlug : undefined,
	}));

const operation = (op: Operation, orgSlug: string | undefined) => {
	const responses: Responses = {};
	if (op.response && op.stream) {
		responses["200"] = {
			description:
				"A stream of Server-Sent Events. Each `data:` line is one event, as JSON.",
			content: { "text/event-stream": { schema: ref(op.response) } },
		};
	} else if (op.response) {
		const body = ref(op.response);
		responses["200"] = {
			description: "OK",
			content: {
				"application/json": {
					schema: op.list ? { type: "array", items: body } : body,
				},
			},
		};
	} else {
		responses["204"] = { description: "No content" };
	}
	if (op.auth !== false) {
		responses["401"] = errorResponse("No token, or a bad or expired one.");
		responses["429"] = errorResponse("Too many requests.");
	}
	// Every write but revoking the token itself, which `userApiRoute` lets a
	// read-only token do (see `serve` in server/api-route.ts).
	if (op.method !== "get" && op.auth !== false && op.path !== "/session") {
		responses["403"] = errorResponse("Not allowed, or a read-only API token.");
	} else if (op.who) {
		responses["403"] = errorResponse("The caller's role does not allow this.");
	}
	if (op.body || op.query) {
		responses["422"] = errorResponse("The input is not valid.");
	}

	return {
		operationId: op.operationId,
		summary: op.summary,
		description: op.who
			? [op.description, `**Who:** ${op.who}`].filter(Boolean).join("\n\n")
			: op.description,
		tags: [op.tag],
		security: op.auth === false ? [] : undefined,
		parameters: [
			...pathParameters(op.path, orgSlug),
			...(op.query ? queryParameters(op.query) : []),
		],
		requestBody: op.body
			? {
					required: true,
					content: { "application/json": { schema: ref(op.body) } },
				}
			: undefined,
		responses,
	};
};

/**
 * The document.
 *
 * `orgSlug` is what `/api-docs` asks for when the reader is signed in. It
 * becomes the example of every `orgSlug` path parameter, which Scalar fills
 * in, and it adds the `session` scheme: the reader's own browser session,
 * picked in Scalar's Authentication menu beside the bearer token. The scheme
 * is a header only that page sends (`SESSION_REQUEST_HEADER`); what makes it
 * safe is `provesSameOrigin` in `server/api-route.ts`. The plain document
 * leaves it out, because no other client can use it.
 */
export const buildOpenApiDocument = ({
	orgSlug,
}: { orgSlug?: string } = {}) => {
	const paths: {
		[path: string]: Partial<Record<Method, ReturnType<typeof operation>>>;
	} = {};
	for (const op of OPERATIONS) {
		paths[op.path] ??= {};
		paths[op.path][op.method] = operation(op, orgSlug);
	}
	return {
		openapi: "3.1.0",
		info: { title: "Farmer API", version: "1", description: INTRO },
		servers: [{ url: "/api/v1" }],
		security: orgSlug ? [{ session: [] }, { bearer: [] }] : [{ bearer: [] }],
		tags: Object.entries(TAG_TEXT).map(([name, description]) => ({
			name,
			description,
		})),
		paths,
		components: {
			securitySchemes: {
				// Undefined drops out of the JSON, so the plain document has no key.
				session: orgSlug
					? {
							type: "apiKey",
							in: "header",
							name: SESSION_REQUEST_HEADER,
							description:
								"Your browser session, on this page only. Requests act as you and change your real data.",
						}
					: undefined,
				bearer: {
					type: "http",
					scheme: "bearer",
					description: `An API token from [Preferences → API tokens](${API_TOKENS_PAGE}) (recommended), or the \`access_token\` from the device flow.`,
				},
			},
			schemas: componentSchemas(),
		},
	};
};
