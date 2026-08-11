import { z } from "zod";

const year = z.number().int().min(2000).max(2100);
const month = z.number().int().min(1).max(12);

export const closePeriodInput = z.object({ year, month });
export type ClosePeriodInput = z.infer<typeof closePeriodInput>;

export const closeSheetInput = z.object({
	projectId: z.uuid(),
	year,
	month,
});
export type CloseSheetInput = z.infer<typeof closeSheetInput>;

// Hours are stored in seconds like everywhere else. Null clears the override and
// falls back to the computed default (Adjusted -> Reported, Final -> Adjusted),
// which is what keeps an untouched row tracking late entries.
const overrideSeconds = z
	.number()
	.int()
	.min(0)
	.max(1000 * 3600)
	.nullable();

// The PM's half of the sheet: reconcile the number, correct the absence day
// count, leave a note. Deliberately NO "snap to expected" shortcut — the owner
// wants PMs consciously checking and typing each number (PRD 5.1).
export const saveCloseRowInput = z.object({
	projectId: z.uuid(),
	year,
	month,
	userId: z.string().min(1),
	adjustedSeconds: overrideSeconds.optional(),
	absenceDaysOverride: z.number().int().min(0).max(31).nullable().optional(),
	comment: z.string().max(2000).nullable().optional(),
});
export type SaveCloseRowInput = z.infer<typeof saveCloseRowInput>;

// The Final column is Admin-only — it is the number that gets invoiced.
export const setCloseRowFinalInput = z.object({
	projectId: z.uuid(),
	year,
	month,
	userId: z.string().min(1),
	finalSeconds: overrideSeconds,
});
export type SetCloseRowFinalInput = z.infer<typeof setCloseRowFinalInput>;

export const closeTransitionInput = z.object({
	projectId: z.uuid(),
	year,
	month,
});
export type CloseTransitionInput = z.infer<typeof closeTransitionInput>;
