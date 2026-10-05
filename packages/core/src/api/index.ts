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
 *   DELETE session                               204 (revokes the token, either kind)
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
 *   GET    orgs/$slug/projects                   ApiProject[]
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
 *   GET    orgs/$slug/projects/$id               ApiProjectDetail
 *   GET    orgs/$slug/projects/$id/overview      ApiProjectOverview
 *   GET    orgs/$slug/reports/time               ApiTimeReport
 *   GET    orgs/$slug/reports/time/detail        ApiTimeReportDetail
 *   GET    orgs/$slug/reports/overtime           ApiOvertimeReport
 *   GET    orgs/$slug/reports/tracking           ApiTrackingReport
 *   GET    orgs/$slug/reports/absence            ApiAbsenceReport
 *   GET    orgs/$slug/absences?year&month        ApiAbsenceEntry[]
 *   GET    orgs/$slug/rewind?year                ApiRewind
 *
 * Any failure answers `ApiError` with a status: 401 unauthorized, 403
 * forbidden, 404 not_found, 422 invalid_input, 426 cli_outdated, 429
 * rate_limited (with `Retry-After`), 500 server_error.
 */

export * from "./catalogue";
export * from "./errors";
export * from "./home";
export * from "./me";
export * from "./meta";
export * from "./preferences";
export * from "./project-detail";
export * from "./reports";
export * from "./rewind";
export * from "./schedule";
export * from "./time-entries";
export * from "./timer";
export * from "./tokens";
export * from "./webhooks";
