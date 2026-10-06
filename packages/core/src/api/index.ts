/**
 * The REST API's response shapes — what `/api/v1` answers and what the CLI
 * reads.
 *
 * Its own export (`@farmer/core/api`) rather than part of the services barrel,
 * because the CLI imports it at runtime and must not reach the database: every
 * module here imports nothing but types. A future `apps/api` uses the same
 * modules, so the two cannot drift.
 *
 * The routes, all under `/api/v1`:
 *
 *   GET    meta                                  ApiMeta (no auth)
 *   GET    me                                    ApiMe
 *   POST   me/devices                            ApiMobileDevice (register a phone)
 *   PATCH  me/devices/$installationId            ApiMobileDevice
 *   DELETE me/devices/$installationId            204
 *   DELETE session                               204 (revokes the token, either kind)
 *   GET    me/sessions                           ApiSession[] (signed-in devices)
 *   DELETE me/sessions/$id                       ApiRevoked (session only)
 *   GET    orgs/$slug/api-tokens                 ApiPersonalToken[]
 *   POST   orgs/$slug/api-tokens                 ApiPersonalTokenCreated (session only)
 *   DELETE orgs/$slug/api-tokens/$id             ApiRevoked (session only)
 *   GET    orgs/$slug/whoami                     ApiWhoami
 *   GET    orgs/$slug/time-entries?from&to       ApiTimeEntry[]
 *   POST   orgs/$slug/time-entries               ApiTimeEntry
 *   PATCH  orgs/$slug/time-entries/$id           ApiTimeEntry
 *   DELETE orgs/$slug/time-entries/$id           ApiDeleted
 *   POST   orgs/$slug/time-entries/file          ApiFileResult
 *   POST   orgs/$slug/time-entries/copy-day      ApiCopyResult
 *   POST   orgs/$slug/time-entries/copy-week     ApiCopyResult
 *   GET    orgs/$slug/unfiled?from&to            ApiUnfiledEntry[]
 *   POST   orgs/$slug/absences                   ApiAbsenceResult
 *   DELETE orgs/$slug/absences/$id               ApiDeleted
 *   GET    orgs/$slug/projects                   ApiProjectDetail[]
 *   GET    orgs/$slug/clients                    ApiClient[]
 *   GET    orgs/$slug/tasks                      ApiTaskList
 *   GET    orgs/$slug/tracking                   ApiTracking
 *   POST   orgs/$slug/sync                       ApiSyncResult
 *   GET    orgs/$slug/timer                      ApiTimerState
 *   POST   orgs/$slug/timer                      ApiTimerState (start)
 *   POST   orgs/$slug/timer/pause                ApiTimerState (hold the clock)
 *   POST   orgs/$slug/timer/resume               ApiTimerState
 *   POST   orgs/$slug/timer/confirm              ApiTimeEntry (stop and log)
 *   DELETE orgs/$slug/timer                      ApiTimerState (discard or dismiss)
 *   GET    orgs/$slug/timer/settings             ApiTimerSettings
 *   PATCH  orgs/$slug/timer/settings             ApiTimerSettings
 *   GET    orgs/$slug/home                       ApiHome
 *   GET    orgs/$slug/preferences/notifications  ApiNotificationSettings
 *   PATCH  orgs/$slug/preferences/notifications  ApiNotificationSettings
 *   GET    orgs/$slug/preferences/hidden-tasks   ApiHiddenTasks
 *   POST   orgs/$slug/preferences/hidden-tasks   ApiHiddenTasks (hide or show one)
 *   DELETE orgs/$slug/preferences/hidden-tasks   ApiHiddenTasks (show all)
 *   GET    orgs/$slug/filing-rules               ApiFilingRule[]
 *   PATCH  orgs/$slug/filing-rules/$id           ApiFilingRule
 *   DELETE orgs/$slug/filing-rules/$id           ApiDeleted
 *   GET    orgs/$slug/working-hours              ApiWorkingHoursDay[]
 *   PATCH  orgs/$slug/working-hours              ApiWorkingHoursDay (one day)
 *   GET    orgs/$slug/recurring-blocks           ApiRecurringBlock[]
 *   POST   orgs/$slug/recurring-blocks           ApiRecurringBlock
 *   POST   orgs/$slug/recurring-blocks/break     ApiRecurringBlock
 *   PATCH  orgs/$slug/recurring-blocks/$id       ApiRecurringBlock
 *   DELETE orgs/$slug/recurring-blocks/$id       ApiDeleted
 *   GET    orgs/$slug/holidays?year              ApiHoliday[]
 *   GET    orgs/$slug/holidays/range?from&to     ApiHolidayDay[]
 *   GET    orgs/$slug/integrations               ApiIntegrations
 *   PATCH  orgs/$slug/integrations/settings      ApiIntegrationSettingsResult
 *   DELETE orgs/$slug/integrations/github        ApiIntegrations
 *   DELETE orgs/$slug/integrations/google-calendar ApiIntegrations
 *   GET    orgs/$slug/reports/time               ApiTimeReport
 *   GET    orgs/$slug/reports/time/detail        ApiTimeReportDetail
 *   GET    orgs/$slug/reports/overtime           ApiOvertimeReport
 *   GET    orgs/$slug/reports/tracking           ApiTrackingReport
 *   GET    orgs/$slug/reports/absence            ApiAbsenceReport
 *   GET    orgs/$slug/absences?year&month        ApiAbsenceEntry[]
 *   GET    orgs/$slug/rewind?year                ApiRewind
 *
 * The workspace admin (admin only, see `admin.ts`):
 *
 *   GET    orgs/$slug/reminders                  ApiReminderSettings
 *   PATCH  orgs/$slug/reminders                  ApiReminderSettings
 *   GET    orgs/$slug/reminders/preview          ApiReminderPreview
 *   GET    orgs/$slug/workspace-integrations/github        ApiGithubWorkspace
 *   GET    orgs/$slug/workspace-integrations/github/install-url              ApiInstallUrl
 *   DELETE orgs/$slug/workspace-integrations/github/installations/$id        ApiGithubDisconnect
 *   GET    orgs/$slug/workspace-integrations/slack         ApiSlackStatus
 *   DELETE orgs/$slug/workspace-integrations/slack         ApiSlackStatus
 *   GET    orgs/$slug/workspace-integrations/slack/install-url               ApiInstallUrl
 *   POST   orgs/$slug/workspace-integrations/slack/match-people              ApiSlackMatch
 *   POST   orgs/$slug/workspace-integrations/slack/test    ApiSlackTest
 *   GET    orgs/$slug/webhooks                   ApiWebhookEndpoint[]
 *   POST   orgs/$slug/webhooks                   ApiWebhookEndpointCreated
 *   GET    orgs/$slug/webhooks/$id               ApiWebhookEndpoint
 *   PATCH  orgs/$slug/webhooks/$id               ApiWebhookEndpoint
 *   DELETE orgs/$slug/webhooks/$id               ApiDeleted
 *   POST   orgs/$slug/webhooks/$id/roll-secret   ApiWebhookSecret
 *   POST   orgs/$slug/webhooks/$id/test          ApiWebhookTest
 *   GET    orgs/$slug/webhooks/$id/deliveries    ApiWebhookDelivery[]
 *   POST   orgs/$slug/webhooks/deliveries/$id/resend               ApiWebhookResend
 *   GET    orgs/$slug/audit-log                  ApiAuditPage
 *   POST   orgs/$slug/audit-log/export           ApiAuditExport
 *   GET    orgs/$slug/audit-log/retention        ApiAuditRetention
 *   PATCH  orgs/$slug/audit-log/retention        ApiAuditRetention
 *
 * The assistant (see `assistant.ts`):
 *
 *   GET    orgs/$slug/assistant/settings         ApiAssistantSettings (any member)
 *   POST   orgs/$slug/assistant/settings         ApiAssistantSettings (admin: the key)
 *   PATCH  orgs/$slug/assistant/settings         ApiAssistantSettings (admin)
 *   DELETE orgs/$slug/assistant/settings         ApiAssistantSettings (admin)
 *   GET    orgs/$slug/assistant/models           ApiAssistantModel[] (admin)
 *   GET    orgs/$slug/assistant/threads          ApiAssistantThread[]
 *   POST   orgs/$slug/assistant/threads          ApiAssistantThread
 *   GET    orgs/$slug/assistant/threads/$id      ApiAssistantThreadDetail
 *   PATCH  orgs/$slug/assistant/threads/$id      ApiAssistantThread
 *   DELETE orgs/$slug/assistant/threads/$id      ApiDeleted
 *   POST   orgs/$slug/assistant/threads/$id/messages               text/event-stream
 *   POST   orgs/$slug/assistant/threads/$id/approvals              text/event-stream
 *
 * The PM, team lead and People screens (admins, unless a line says more):
 *
 *   POST   orgs/$slug/projects                   ApiProjectDetail (admin, PM, TL)
 *   GET    orgs/$slug/projects/$id               ApiProjectDetail
 *   PATCH  orgs/$slug/projects/$id               ApiProjectDetail (PM)
 *   POST   orgs/$slug/projects/$id/archive       ApiProjectDetail (PM)
 *   POST   orgs/$slug/projects/$id/restore       ApiProjectDetail (PM)
 *   GET    orgs/$slug/projects/$id/overview      ApiProjectOverview (TL)
 *   GET    orgs/$slug/projects/$id/tasks         ApiTask[]
 *   GET    orgs/$slug/projects/$id/assignable    ApiPersonRef[] (TL)
 *   GET    orgs/$slug/projects/$id/members       ApiProjectMember[] (TL)
 *   POST   orgs/$slug/projects/$id/members       ApiProjectMember[] (TL)
 *   PATCH  orgs/$slug/projects/$id/members/$uid  ApiProjectMember[] (TL)
 *   DELETE orgs/$slug/projects/$id/members/$uid  ApiProjectMember[] (TL)
 *   POST   orgs/$slug/clients                    ApiClient (admin, PM, TL)
 *   PATCH  orgs/$slug/clients/$id                ApiClient
 *   POST   orgs/$slug/clients/$id/archive        ApiClient
 *   POST   orgs/$slug/clients/$id/restore        ApiClient
 *   GET    orgs/$slug/tasks/managed              ApiManagedTask[]
 *   POST   orgs/$slug/tasks                      ApiManagedTask
 *   PATCH  orgs/$slug/tasks/$id                  ApiManagedTask
 *   POST   orgs/$slug/tasks/$id/archive          ApiManagedTask
 *   POST   orgs/$slug/tasks/$id/restore          ApiManagedTask
 *   GET    orgs/$slug/people                     ApiPerson[]
 *   GET    orgs/$slug/people/$uid                ApiPersonProfile
 *   DELETE orgs/$slug/people/$uid                ApiDeleted (session only)
 *   POST   orgs/$slug/people/$uid/role           ApiPerson (session only)
 *   POST   orgs/$slug/people/$uid/type           ApiPersonProfile
 *   POST   orgs/$slug/people/$uid/start-date     ApiPersonProfile
 *   POST   orgs/$slug/people/$uid/archive        ApiArchiveResult
 *   POST   orgs/$slug/people/$uid/restore        ApiArchiveResult
 *   POST   orgs/$slug/people/$uid/confirm-email  ApiArchiveResult
 *   GET    orgs/$slug/people/$uid/team           ApiPersonRef[] (the lead too)
 *   POST   orgs/$slug/people/$uid/team           ApiPersonRef[]
 *   GET    orgs/$slug/invitations                ApiInvitation[]
 *   POST   orgs/$slug/invitations                ApiInvitation (session only)
 *   DELETE orgs/$slug/invitations/$id            ApiDeleted (session only)
 *   POST   orgs/$slug/invitations/$id/resend     ApiInvitation (session only)
 *   GET    orgs/$slug/hour-fund?year             ApiHourFundMonth[]
 *   POST   orgs/$slug/hour-fund                  ApiHourFundMonth[]
 *   POST   orgs/$slug/hour-fund/clear            ApiHourFundMonth[]
 *   POST   orgs/$slug/hour-fund/prefill          ApiHourFundMonth[]
 *   GET    orgs/$slug/hour-fund/suggestion       ApiHourFundSuggestion
 *   GET    orgs/$slug/organization               ApiOrganizationSettings
 *   PATCH  orgs/$slug/organization               ApiOrganizationSettings
 *
 * The last screens of the web app (API version 3). `TL` and `PM` as above;
 * "own" is the caller's own entries only:
 *
 *   GET    orgs/$slug/day-assembly?date          ApiDayAssembly
 *   POST   orgs/$slug/day-assembly               ApiDayAssemblyResult
 *   GET    orgs/$slug/calendar/events?date       ApiCalendarEvent[]
 *   POST   orgs/$slug/time-entries/$id/calendar-values      ApiTimeEntry (own)
 *   DELETE orgs/$slug/time-entries/$id/calendar-change      ApiTimeEntry (own)
 *   GET    orgs/$slug/github/commits?projectId&date         ApiCommitSuggestion[]
 *   GET    orgs/$slug/github/pull-requests?projectId&date   ApiPullRequestSuggestion[]
 *   GET    orgs/$slug/time-entries/$id/commits   ApiAttachedCommit[] (own)
 *   POST   orgs/$slug/time-entries/$id/commits   ApiAttachedCommit[] (own)
 *   DELETE orgs/$slug/time-entries/$id/commits/$commitId    ApiAttachedCommit[] (own)
 *   GET    orgs/$slug/time-entries/$id/pull-requests        ApiAttachedPullRequest[] (own)
 *   POST   orgs/$slug/time-entries/$id/pull-requests        ApiAttachedPullRequest[] (own)
 *   DELETE orgs/$slug/time-entries/$id/pull-requests/$activityId  ApiAttachedPullRequest[] (own)
 *   GET    orgs/$slug/projects/$id/repositories  ApiProjectRepository[]
 *   POST   orgs/$slug/projects/$id/repositories  ApiProjectRepository[] (admin)
 *   DELETE orgs/$slug/projects/$id/repositories/$repositoryId  ApiProjectRepository[] (admin)
 *   GET    orgs/$slug/workspace-integrations/github/repositories          ApiAvailableRepositories (admin)
 *   POST   orgs/$slug/workspace-integrations/github/repositories/refresh  ApiAvailableRepositories (admin)
 *   POST   orgs/$slug/uploads                    ApiUploadedImage (admin: a logo, TL: an icon)
 *   GET    orgs/$slug/organization/policy        ApiOrgPolicy (admin)
 *   PATCH  orgs/$slug/organization/policy        ApiOrgPolicy (admin)
 *   PATCH  orgs/$slug/holidays                   ApiHolidaySwitch (admin)
 *   GET    me/invitations                        ApiMyInvitation[]
 *   POST   me/invitations/$id/accept             ApiJoinedOrganization (session only)
 *   POST   me/invitations/$id/decline            ApiDeleted (session only)
 *   GET    me/import-claims                      ApiImportClaim[]
 *   POST   me/import-claims/$organizationId/accept   ApiJoinedOrganization (session only)
 *   POST   me/import-claims/$organizationId/decline  ApiDeleted (session only)
 *   POST   me/organizations                      ApiCreatedOrganization (session only)
 *
 * "Session only": better-auth makes the write and needs a session, so an
 * API token gets 403 there. The `/me` writes ask for a session for the same
 * reason as the web app's `sessionMiddleware`: a person who joins or makes a
 * workspace signs in to do it.
 *
 * Any failure answers `ApiError` with a status: 401 unauthorized, 403
 * forbidden, 404 not_found, 422 invalid_input, 426 cli_outdated, 429
 * rate_limited (with `Retry-After`), 500 server_error.
 */

export * from "./account";
export * from "./admin";
export * from "./assistant";
export * from "./catalogue";
export * from "./day-assembly";
export * from "./errors";
export * from "./github";
export * from "./home";
export * from "./me";
export * from "./meta";
export * from "./onboarding";
export * from "./preferences";
export * from "./reports";
export * from "./rewind";
export * from "./schedule";
export * from "./people";
export * from "./project-admin";
export * from "./mobile";
export * from "./time-entries";
export * from "./timer";
export * from "./tokens";
export * from "./webhooks";
export * from "./workspace-admin";
