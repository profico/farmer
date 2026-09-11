import {
	reminderPreviewInput,
	updateReminderSettingsInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// Settings → Reminders. Admin-only, reads included: the page that edits them is
// the only place they appear, and the preview names people and what they are
// behind on.

export const getReminderSettings = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { reminderSettingsService } = await import("@farmer/core/services");
		return reminderSettingsService.get(context.ctx);
	});

export const updateReminderSettings = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateReminderSettingsInput)
	.handler(async ({ data, context }) => {
		const { reminderSettingsService } = await import("@farmer/core/services");
		return reminderSettingsService.update(context.ctx, data);
	});

// "Who gets this today" — by the rules the job sends by, not a copy of them.
export const previewReminder = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(reminderPreviewInput)
	.handler(async ({ data, context }) => {
		const { reminderSettingsService } = await import("@farmer/core/services");
		return reminderSettingsService.preview(context.ctx, data.kind, data.date);
	});
