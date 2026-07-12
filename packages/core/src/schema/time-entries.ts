import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const timeKey = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

const timeRangeRefine = <
	T extends { startTime: string; endTime: string; fillsDay?: boolean },
>(
	data: T,
	// A fill block carries no real time range — its duration is derived from the
	// day's remaining working hours — so the start<end check doesn't apply.
) => data.fillsDay === true || data.startTime < data.endTime;
const timeRangeRefineOptions = {
	message: "End time must be after start time",
	path: ["endTime"],
};

export const createTimeEntryInput = z
	.object({
		typeId: z.uuid(),
		projectId: z.uuid().optional(),
		taskId: z.uuid().optional(),
		description: z.string().optional(),
		date: dateKey,
		startTime: timeKey,
		endTime: timeKey,
		billable: z.boolean().optional(),
		// A "work time" block that auto-expands to fill the rest of the day's
		// working hours; its duration is computed, not taken from start/end.
		fillsDay: z.boolean().optional(),
		// Optional Google Calendar meeting captured when logging a "Meeting" block.
		meetingUrl: z.url().optional(),
		calendarEventId: z.string().optional(),
	})
	.refine(timeRangeRefine, timeRangeRefineOptions);
export type CreateTimeEntryInput = z.infer<typeof createTimeEntryInput>;

export const updateTimeEntryInput = z
	.object({
		timeEntryId: z.uuid(),
		typeId: z.uuid(),
		projectId: z.uuid().optional(),
		taskId: z.uuid().optional(),
		description: z.string().optional(),
		date: dateKey,
		startTime: timeKey,
		endTime: timeKey,
		billable: z.boolean().optional(),
		// A "work time" block that auto-expands to fill the rest of the day's
		// working hours; its duration is computed, not taken from start/end.
		fillsDay: z.boolean().optional(),
		// Absent means "leave the attached meeting unchanged" (see the service) —
		// only sent when the user picks a (new) calendar event while editing.
		meetingUrl: z.url().optional(),
		calendarEventId: z.string().optional(),
	})
	.refine(timeRangeRefine, timeRangeRefineOptions);
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntryInput>;

// Patches only the note/description of an entry — used by inline editing on the
// day view, so it deliberately touches nothing time/fill/meeting-related.
export const updateTimeEntryDescriptionInput = z.object({
	timeEntryId: z.uuid(),
	description: z.string().max(10_000),
});
export type UpdateTimeEntryDescriptionInput = z.infer<
	typeof updateTimeEntryDescriptionInput
>;

export const listTimeEntriesRangeInput = z
	.object({
		from: dateKey,
		to: dateKey,
	})
	.refine((data) => data.from <= data.to, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(
		(data) => {
			const from = new Date(`${data.from}T00:00:00Z`);
			const to = new Date(`${data.to}T00:00:00Z`);
			const days = (to.getTime() - from.getTime()) / 86_400_000;
			return days <= 62;
		},
		{ message: "Range too large (max 62 days)", path: ["to"] },
	);
export type ListTimeEntriesRangeInput = z.infer<
	typeof listTimeEntriesRangeInput
>;

export const deleteTimeEntryInput = z.uuid();
export type DeleteTimeEntryInput = z.infer<typeof deleteTimeEntryInput>;
