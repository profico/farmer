import { z } from "zod";

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

// The org's one behavioural knob (PRD §8). Everything else about compliance —
// the behind-pace threshold, the reminder weekdays, the 15-minute granularity —
// is deliberately hardcoded, so this schema stays a single field on purpose.
export const updateOrgSettingsInput = z.object({
	complianceMissingDays: z.number().int().min(1).max(30),
});
export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsInput>;
