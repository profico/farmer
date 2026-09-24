import { settingEnabled } from "./instance-settings";

/**
 * The command-line tool's kill switch — one instance setting, default on.
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
 * An instance setting with the default "true", for the same reasons as
 * `lib/assistant-flag.ts`. The client learns the flag from
 * `getPublicAppConfig`. Read per call, like the other two.
 */
export const isCliEnabled = (): boolean => settingEnabled("CLI_ENABLED");
