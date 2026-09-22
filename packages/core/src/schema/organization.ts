import { z } from "zod";

import { dayKeySchema } from "./day-key";
import { uploadedFilePath } from "./uploads";

export const setActiveOrgBySlugInput = z.string().min(1);
export type SetActiveOrgBySlugInput = z.infer<typeof setActiveOrgBySlugInput>;

export const updateOrganizationSettingsInput = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	country: z.string().length(2).optional(),
	// A raw IANA zone identifier (e.g. "Europe/Sarajevo"); re-validated
	// server-side in organization.service.ts before being written.
	timezone: z.string().trim().min(1).max(100).optional(),
	// The day weeks start on, as Date#getDay() numbers it: 1 = Monday, 0 =
	// Sunday. Every week the app draws starts on it — the timesheet, the home
	// page, the week report, the date pickers and the CLI's `--week`.
	weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
	// The org's own logo, shown in the app chrome in place of the Profico
	// fallback: a URL somebody pasted, or the path of an uploaded image. An
	// empty string clears it (→ null).
	logo: z.url().max(2048).or(uploadedFilePath).or(z.literal("")).nullish(),
});
export type UpdateOrganizationSettingsInput = z.infer<
	typeof updateOrganizationSettingsInput
>;

// The reminder days and times are in schema/reminder-settings; the 15-minute
// granularity is deliberately hardcoded. So this stays a very short list on
// purpose.
//
// Both fields are optional so each form section can save its own field without
// having to send (and therefore be able to clobber) the other.
export const updateOrgSettingsInput = z.object({
	// The Tracking rule's tolerance, in percent of the target so far.
	trackingTolerancePct: z.number().int().min(0).max(50).optional(),
	// yyyy-MM-dd; null clears the lock. Explicitly nullable rather than
	// "" -> null, so "clear it" is something the caller has to actually say.
	//
	// Checked as a real DAY, not just the shape: "2026-13-45" matches the regex,
	// and every consumer compares day keys as strings, so an impossible date
	// throws nowhere — it just sorts after every real one and silently locks
	// every automation forever.
	automationLockedThrough: dayKeySchema.nullable().optional(),
});
export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsInput>;
