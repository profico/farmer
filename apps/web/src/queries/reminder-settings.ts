import type { ReminderKind } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";

import {
	getReminderSettings,
	previewReminder,
} from "#/server/reminder-settings.ts";

import { queryKeys } from "./keys.ts";

export const reminderSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).reminderSettings],
		queryFn: () => getReminderSettings(),
	});

// Under the settings root, so a save stales every open preview with it: the
// list of people is a function of the settings.
export const reminderPreviewQuery = (
	org: string,
	kind: ReminderKind,
	date: string,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).reminderSettings, "preview", kind, date],
		queryFn: () => previewReminder({ data: { kind, date } }),
	});
