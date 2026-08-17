/**
 * The assistant's kill switch — one env var, default on.
 *
 * `ASSISTANT_ENABLED=false` takes the whole feature away: the nav row, the
 * page, the streaming endpoint, the settings section, and every service call
 * behind them. It exists because the assistant is the one part of this app that
 * writes to a timesheet on somebody else's say-so and depends on a third party
 * to decide what to write — so it is the one part worth being able to switch off
 * from a deploy config at 2am, without a revert, a rebuild or a key rotation.
 *
 * Distinct from the two switches next to it, and all three can be off for
 * different reasons:
 *   - `assistantSettings.enabled` (per org, in the database) is an admin
 *     pausing it for their own workspace.
 *   - A missing `assistantSettings` row is "never connected".
 *   - This is the operator saying the feature itself is not to run here.
 *
 * A plain env var rather than a `VITE_` one, for the same reason as
 * `SINGLE_ORG_SLUG`: `VITE_` variables bake at build time and the Dockerfile
 * builds one image meant to run under several environments. The client learns
 * the flag from `getPublicAppConfig` instead.
 *
 * Read per call rather than captured at module scope, matching
 * `jobs/scheduler.ts` — it makes the flag testable, and it means a process that
 * reads it early doesn't pin the answer for one that reads it late.
 */
export const isAssistantEnabled = (): boolean =>
	(process.env.ASSISTANT_ENABLED ?? "true") === "true";
