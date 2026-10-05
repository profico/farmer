import type { ApiNotificationPreferences } from "@farmer/core/api";
import { updateNotificationSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `PATCH /api/v1/orgs/$orgSlug/notification-preferences` — the
 * caller's notification settings in one workspace: the log reminder, and
 * whether the Slack kinds go to the mobile app or to Slack (ADR 0006).
 *
 * In the workspace's path and not under `/me`, because the settings are kept
 * for each workspace: Slack is connected per workspace. The PATCH is a
 * partial patch, as the web app's Preferences send it.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/notification-preferences",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiNotificationPreferences> => {
					const { notificationsService } =
						await import("@farmer/core/services");
					return notificationsService.getSettings(ctx);
				},
			}),
			PATCH: apiRoute({
				input: updateNotificationSettingsInput,
				run: async (ctx, input): Promise<ApiNotificationPreferences> => {
					const { notificationsService } =
						await import("@farmer/core/services");
					return notificationsService.update(ctx, input);
				},
			}),
		},
	},
});
