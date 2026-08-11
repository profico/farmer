import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const suggestDayAssemblyInput = z.object({
	date: dateKey,
});
export type SuggestDayAssemblyInput = z.infer<typeof suggestDayAssemblyInput>;

// One accepted suggestion, shaped like a createTimeEntryInput plus the commits
// to attach as evidence once the entry exists. No start/end: under the
// duration-only entry model a suggestion proposes an AMOUNT of time, not a slot.
const assembledEntry = z.object({
	taskId: z.uuid(),
	projectId: z.uuid().optional(),
	description: z.string().optional(),
	durationSeconds: z.number().int().positive().optional(),
	fillsDay: z.boolean().optional(),
	overtime: z.boolean().optional(),
	meetingUrl: z.url().optional(),
	calendarEventId: z.string().optional(),
	commits: z
		.array(
			z.object({
				projectGithubRepoId: z.uuid(),
				sha: z.string(),
			}),
		)
		.optional(),
});

export const applyDayAssemblyInput = z.object({
	date: dateKey,
	entries: z.array(assembledEntry).min(1).max(50),
});
export type ApplyDayAssemblyInput = z.infer<typeof applyDayAssemblyInput>;
