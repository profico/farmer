import {
	type ApiNotificationSettings,
	toApiNotificationSettings,
} from "@farmer/core/api";
import { updateNotificationSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `PATCH /api/v1/orgs/$orgSlug/preferences/notifications` — the
 * caller's notification settings in one workspace: the log reminder switch,
 * as on Preferences in the web app, and `remindersChannel`. The channel tells
 * if the Slack kinds go to the mobile app or to Slack (ADR 0006). The PATCH is
 * a partial patch: a field that is not sent keeps its value.
 *
 * The resource is in the path of the workspace and not under `/me`, because
 * each workspace keeps its own settings: Slack is connected per workspace.
 *
 * Push subscriptions are not here. They belong to a browser and its service
 * worker.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/preferences/notifications",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiNotificationSettings> => {
					const { notificationsService } =
						await import("@farmer/core/services");
					return toApiNotificationSettings(
						await notificationsService.getSettings(ctx),
					);
				},
			}),
			PATCH: apiRoute({
				input: updateNotificationSettingsInput,
				run: async (ctx, input): Promise<ApiNotificationSettings> => {
					const { notificationsService } =
						await import("@farmer/core/services");
					return toApiNotificationSettings(
						await notificationsService.update(ctx, input),
					);
				},
			}),
		},
	},
});
