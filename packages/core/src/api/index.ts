/**
 * The REST API's response shapes — what `/api/v1` answers and what the CLI
 * reads.
 *
 * Its own export (`@farmer/core/api`) rather than part of the services barrel,
 * because the CLI imports it at runtime and must not reach the database: every
 * module here imports nothing but types. A future `apps/api` uses the same
 * modules, so the two cannot drift.
 *
 * The routes are all under `/api/v1`. The route files in
 * `apps/web/src/routes/api/v1/` and the served `/api/v1/openapi.json` list
 * them. Admin-only shapes are in `admin.ts`, and the assistant shapes are in
 * `assistant.ts`.
 *
 * "Session only" (in a route file) means that better-auth makes the write and
 * needs a session, so an API token gets 403. The `/me` writes need a session
 * for the same reason as the web app's `sessionMiddleware`.
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
