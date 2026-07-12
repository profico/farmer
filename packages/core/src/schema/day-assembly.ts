import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const timeKey = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

export const suggestDayAssemblyInput = z.object({
	date: dateKey,
});
export type SuggestDayAssemblyInput = z.infer<typeof suggestDayAssemblyInput>;

// One accepted suggestion, shaped like a createTimeEntryInput plus the
// commits to attach as evidence once the entry exists.
const assembledEntry = z
	.object({
		typeId: z.uuid(),
		projectId: z.uuid().optional(),
		description: z.string().optional(),
		startTime: timeKey,
		endTime: timeKey,
		billable: z.boolean().optional(),
		fillsDay: z.boolean().optional(),
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
	})
	.refine((data) => data.fillsDay === true || data.startTime < data.endTime, {
		message: "End time must be after start time",
		path: ["endTime"],
	});

export const applyDayAssemblyInput = z.object({
	date: dateKey,
	entries: z.array(assembledEntry).min(1).max(50),
});
export type ApplyDayAssemblyInput = z.infer<typeof applyDayAssemblyInput>;
