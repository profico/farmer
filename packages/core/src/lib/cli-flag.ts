/**
 * The command-line tool's kill switch — one env var, default on.
 *
 * `CLI_ENABLED=false` takes the CLI's surface away: `/api/v1/orgs/*`, the
 * device authorization endpoints and the install script answer 404, `meta`
 * says `cliEnabled: false`, and the CLI section disappears from Settings →
 * Integrations.
 *
 * Deliberately independent of `MCP_ENABLED` and `ASSISTANT_ENABLED`. The CLI
 * shares services with both and a credential shape with neither: it holds a
 * better-auth session from the device flow, not an MCP access token, and it
 * calls no model. An operator who switched one of those off has said nothing
 * about this one.
 *
 * A plain env var rather than a `VITE_` one, for the same reason as
 * `MCP_ENABLED`: `VITE_` variables bake at build time and the Dockerfile builds
 * one image meant to run under several environments. The client learns the
 * flag from `getPublicAppConfig`.
 *
 * Read per call rather than captured at module scope, matching
 * `lib/mcp-flag.ts`.
 */
export const isCliEnabled = (): boolean =>
	(process.env.CLI_ENABLED ?? "true") === "true";
