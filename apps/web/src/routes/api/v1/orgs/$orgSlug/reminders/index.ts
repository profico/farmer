import {
	type ApiReminderSettings,
	toApiReminderSettings,
} from "@farmer/core/api";
import { updateReminderSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `PATCH /api/v1/orgs/$orgSlug/reminders` — Settings → Reminders.
 *
 * Admin only, reads included, as in the web app: the service asserts it. A
 * PATCH saves the fields it sends and leaves the others alone, so each card on
 * a screen can save on its own.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/reminders/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiReminderSettings> => {
					const { reminderSettingsService } =
						await import("@farmer/core/services");
					return toApiReminderSettings(
						await reminderSettingsService.getForAdmin(ctx),
					);
				},
			}),
			PATCH: apiRoute({
				input: updateReminderSettingsInput,
				run: async (ctx, patch): Promise<ApiReminderSettings> => {
					const { reminderSettingsService } =
						await import("@farmer/core/services");
					return toApiReminderSettings(
						await reminderSettingsService.update(ctx, patch),
					);
				},
			}),
		},
	},
});
