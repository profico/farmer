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
 *   DELETE session                               204 (revokes the token)
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
 *   GET    orgs/$slug/tasks                      ApiTaskList
 *   GET    orgs/$slug/tracking                   ApiTracking
 *   POST   orgs/$slug/sync                       ApiSyncResult
 *
 * Any failure answers `ApiError` with a status: 401 unauthorized, 403
 * forbidden, 404 not_found, 422 invalid_input, 426 cli_outdated, 429
 * rate_limited (with `Retry-After`), 500 server_error.
 */

export * from "./catalogue";
export * from "./errors";
export * from "./me";
export * from "./meta";
export * from "./time-entries";
