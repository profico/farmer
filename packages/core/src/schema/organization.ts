import { z } from "zod";

import { isValidDayKey } from "../lib/time";

export const setActiveOrgBySlugInput = z.string().min(1);
export type SetActiveOrgBySlugInput = z.infer<typeof setActiveOrgBySlugInput>;

export const updateOrganizationSettingsInput = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	country: z.string().length(2).optional(),
	// A raw IANA zone identifier (e.g. "Europe/Sarajevo"); re-validated
	// server-side in organization.service.ts before being written.
	timezone: z.string().trim().min(1).max(100).optional(),
	// A URL to the org's own logo, shown in the app chrome in place of the
	// Profico fallback. An empty string clears it (→ null).
	logo: z.url().max(2048).or(z.literal("")).nullish(),
});
export type UpdateOrganizationSettingsInput = z.infer<
	typeof updateOrganizationSettingsInput
>;

// Everything else about compliance — the behind-pace threshold, the reminder
// weekdays, the 15-minute granularity — is deliberately hardcoded, so this stays
// a very short list on purpose.
//
// Both fields are optional so each form section can save its own field without
// having to send (and therefore be able to clobber) the other.
export const updateOrgSettingsInput = z.object({
	complianceMissingDays: z.number().int().min(1).max(30).optional(),
	// yyyy-MM-dd; null clears the lock. Explicitly nullable rather than
	// "" -> null, so "clear it" is something the caller has to actually say.
	//
	// Checked as a real DAY, not just the shape: "2026-13-45" matches the regex,
	// and every consumer compares day keys as strings, so an impossible date
	// throws nowhere — it just sorts after every real one and silently locks
	// every automation forever.
	automationLockedThrough: z
		.string()
		.refine(isValidDayKey, "Use a real YYYY-MM-DD date")
		.nullable()
		.optional(),
});
export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsInput>;
