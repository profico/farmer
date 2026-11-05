import {
	type ApiReminderPreview,
	toApiReminderPreview,
} from "@farmer/core/api";
import { reminderPreviewInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/reminders/preview?kind&date` — who gets one kind
 * of reminder on one day, by the rules the job sends by. Admin only.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/reminders/preview")(
	{
		server: {
			handlers: {
				GET: apiRoute({
					input: reminderPreviewInput,
					run: async (ctx, { kind, date }): Promise<ApiReminderPreview> => {
						const { reminderSettingsService } =
							await import("@farmer/core/services");
						return toApiReminderPreview(
							await reminderSettingsService.preview(ctx, kind, date),
						);
					},
				}),
			},
		},
	},
);
