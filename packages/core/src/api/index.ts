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
 * "Session only": better-auth makes the write and needs a session, so an
 * API token gets 403 there.
 *
 * Any failure answers `ApiError` with a status: 401 unauthorized, 403
 * forbidden, 404 not_found, 422 invalid_input, 426 cli_outdated, 429
 * rate_limited (with `Retry-After`), 500 server_error.
 */

export * from "./catalogue";
export * from "./errors";
export * from "./me";
export * from "./meta";
export * from "./people";
export * from "./project-admin";
export * from "./time-entries";
export * from "./timer";
export * from "./tokens";
export * from "./webhooks";
export * from "./workspace-admin";
