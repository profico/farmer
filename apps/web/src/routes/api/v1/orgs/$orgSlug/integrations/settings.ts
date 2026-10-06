import {
	type ApiIntegrationSettingsResult,
	toApiIntegrationSettings,
} from "@farmer/core/api";
import { updateIntegrationSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/** The same short deadline as the save on the web page
 *  (`server/integration-settings.ts`). */
const FIRST_SYNC_TIMEOUT_MS = 5_000;

/**
 * `PATCH /api/v1/orgs/$orgSlug/integrations/settings` — the caller's switches
 * on Settings → Integrations. A partial patch: a switch that is not sent keeps
 * its value.
 *
 * The same steps as the web page's save. When the meeting sync or the commit
 * sync goes on, the caller's sync starts at once, because the worker runs on
 * an interval and a switch that does nothing for twenty minutes looks broken.
 * The save waits for the sync for a short time only. After that the sync
 * continues on the server and `synced` is false. A sync never makes the save
 * fail.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/integrations/settings",
)({
	server: {
		handlers: {
			PATCH: apiRoute({
				signInOnly: true,
				input: updateIntegrationSettingsInput,
				run: async (ctx, input): Promise<ApiIntegrationSettingsResult> => {
					const { integrationSettingsService } =
						await import("@farmer/core/services");
					const before = await integrationSettingsService.get(ctx);
					const after = await integrationSettingsService.update(ctx, input);
					const settings = toApiIntegrationSettings(after);

					const switchedOn =
						(!before.googleAutoSyncMeetings && after.googleAutoSyncMeetings) ||
						(!before.githubSyncCommitsAsWorkTime &&
							after.githubSyncCommitsAsWorkTime);
					if (!switchedOn) return { ...settings, synced: false };

					const { runAutomationSyncForCtx } = await import("@farmer/core/jobs");
					const { withTimeout } = await import("@farmer/core/lib/http");
					const synced = await withTimeout(
						runAutomationSyncForCtx(ctx).then(() => true),
						FIRST_SYNC_TIMEOUT_MS,
						() => new Error("still-syncing"),
					).catch(() => false);
					return { ...settings, synced };
				},
			}),
		},
	},
});
