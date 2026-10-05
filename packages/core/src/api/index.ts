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
 * Any failure answers `ApiError` with a status: 401 unauthorized, 403
 * forbidden, 404 not_found, 422 invalid_input, 426 cli_outdated, 429
 * rate_limited (with `Retry-After`), 500 server_error.
 */

export * from "./admin";
export * from "./assistant";
export * from "./catalogue";
export * from "./errors";
export * from "./me";
export * from "./meta";
export * from "./time-entries";
export * from "./timer";
export * from "./tokens";
export * from "./webhooks";
