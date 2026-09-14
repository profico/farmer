import { z } from "zod";

import { isValidDayKey } from "../lib/time";

// The reminder settings (docs/plans/reminder-settings.md), and the limits that
// keep the reason they used to be constants: a reminder sent too often gets
// muted, and a muted reminder is worse than none. `reminder_settings` holds a
// database check for every limit here, so a write that skips this schema is
// refused there too.

/** The four reminder kinds, named as `services/notify.ts` names them. */
export const REMINDER_KINDS = [
	"log-reminder",
	"compliance-nudge",
	"month-end",
	"admin-digest",
] as const;
export const reminderKind = z.enum(REMINDER_KINDS);
export type ReminderKind = z.infer<typeof reminderKind>;

/** Nothing goes out between 20:00 and 07:00. */
export const REMINDER_EARLIEST_TIME = "07:00";
export const REMINDER_LATEST_TIME = "20:00";
/** The Slack nudge goes out on at most this many days a week. */
export const MAX_NUDGE_DAYS = 3;
export const MAX_MONTH_END_DAYS_BEFORE = 10;

// A quarter hour, because the Slack job ticks every 15 minutes: a 09:10 would
// promise an accuracy the scheduler does not have.
export const reminderTime = z
	.string()
	.regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Use HH:mm on a quarter hour")
	.refine(
		(time) => time >= REMINDER_EARLIEST_TIME && time <= REMINDER_LATEST_TIME,
		`Pick a time from ${REMINDER_EARLIEST_TIME} to ${REMINDER_LATEST_TIME}`,
	);

const weekday = z.number().int().min(0).max(6);
const percent = z.number().int().min(1).max(100);

// Overhead employees are never nagged about timesheets, so they are not a
// choice.
export const naggableMemberTypeEnum = z.enum([
	"employee_billable",
	"student_full_time",
	"student_hourly",
	"contractor_full_time",
	"contractor_hourly",
]);
export type NaggableMemberType = z.infer<typeof naggableMemberTypeEnum>;
const memberTypes = z
	.array(naggableMemberTypeEnum)
	.min(1, "Pick at least one person type")
	.refine((types) => new Set(types).size === types.length, "Pick each once");

export const reminderSettingsInput = z.object({
	logEnabled: z.boolean(),
	logMode: z.enum(["end_of_day", "fixed"]),
	logTime: reminderTime,
	logBelowPct: percent,

	nudgeEnabled: z.boolean(),
	nudgeWeekdays: z
		.array(weekday)
		.min(1, "Pick at least one day")
		.max(MAX_NUDGE_DAYS, `At most ${MAX_NUDGE_DAYS} days a week`)
		.refine((days) => new Set(days).size === days.length, "Pick each once"),
	nudgeTime: reminderTime,
	// Who the nudge reaches is the Tracking rule's verdict — "behind", beyond
	// the org's tolerance — so there are no conditions to set here; the
	// tolerance is on `orgSettings`, where the report reads it too.
	nudgeMemberTypes: memberTypes,

	monthEndEnabled: z.boolean(),
	monthEndDaysBefore: z.number().int().min(0).max(MAX_MONTH_END_DAYS_BEFORE),
	monthEndTime: reminderTime,
	monthEndOnlyBehind: z.boolean(),
	monthEndMemberTypes: memberTypes,

	digestEnabled: z.boolean(),
	digestWeekday: weekday,
	digestTime: reminderTime,

	includeNeverSignedIn: z.boolean(),
});
export type ReminderSettings = z.infer<typeof reminderSettingsInput>;

/** What a missing row means — the behaviour the jobs had before these were
 *  settings, except `includeNeverSignedIn`, which is new and off. The column
 *  defaults in `reminder_settings` say the same thing. */
export const REMINDER_SETTINGS_DEFAULTS: ReminderSettings = {
	logEnabled: true,
	logMode: "end_of_day",
	logTime: "17:00",
	logBelowPct: 100,
	nudgeEnabled: true,
	nudgeWeekdays: [2, 5],
	nudgeTime: "09:00",
	nudgeMemberTypes: naggableMemberTypeEnum.options,
	monthEndEnabled: true,
	monthEndDaysBefore: 0,
	monthEndTime: "09:00",
	monthEndOnlyBehind: false,
	monthEndMemberTypes: naggableMemberTypeEnum.options,
	digestEnabled: true,
	digestWeekday: 2,
	digestTime: "09:00",
	includeNeverSignedIn: false,
};

// A partial patch, so each card on the page saves its own fields without
// sending (and so without the power to clobber) another card's.
export const updateReminderSettingsInput = reminderSettingsInput.partial();
export type UpdateReminderSettingsInput = z.infer<
	typeof updateReminderSettingsInput
>;

export const reminderPreviewInput = z.object({
	kind: reminderKind,
	date: z.string().refine(isValidDayKey, "Use a real YYYY-MM-DD date"),
});
export type ReminderPreviewInput = z.infer<typeof reminderPreviewInput>;
