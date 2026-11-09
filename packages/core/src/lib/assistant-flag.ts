import { settingEnabled } from "./instance-settings";

/**
 * The assistant's kill switch: one instance setting, default on.
 *
 * `ASSISTANT_ENABLED=false` removes the whole feature: the nav row, the page,
 * the streaming endpoint, the settings section, and every service call behind
 * them. The assistant writes to a timesheet and depends on a third party, so an
 * operator must be able to switch it off from the deploy config, with no
 * revert, rebuild or key rotation.
 *
 * It differs from the two switches next to it:
 *   - `assistantSettings.enabled` (per org) is an admin pausing it for their
 *     own workspace.
 *   - A missing `assistantSettings` row means "never connected".
 *   - This switch is the operator saying the feature does not run here.
 *
 * An instance setting (`lib/instance-settings.ts`). It is never a `VITE_`
 * variable, because those bake at build time and one image runs under several
 * environments. The client learns the flag from `getPublicAppConfig`.
 *
 * Read per call, not at module scope, so a change on the page reaches a
 * running process and a test can flip it.
 */
export const isAssistantEnabled = (): boolean =>
	settingEnabled("ASSISTANT_ENABLED");
