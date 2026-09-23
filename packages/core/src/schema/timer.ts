import { z } from "zod";

import { headStartTooLong, MAX_DAY_SECONDS } from "../lib/time";
import { QUARTER_HOUR_SECONDS } from "./time-entries";

// The stopwatch's inputs (issues #59 and #43). Confirming one is creating a time
// entry, so `confirmTimerInput` carries the entry's own rules — the 15-minute
// step above all. Nothing about a timer may write a duration a person could not
// have typed into the form.

// Two ways to begin that are not "from zero, on something new" (issue #107):
//
//   - `headStartSeconds`: time already worked before the timer was started. It
//     is measured time as far as the clock is concerned, so it counts towards
//     the person's cap. Seconds rather than quarter hours: it is added to a
//     measurement, and the sum is what gets snapped. Shorter than a day, as
//     `parseHeadStart` (`lib/time`) reads it in both clients; the service
//     refuses one that is not shorter than the person's own limit.
//   - `timeEntryId`: an entry to continue, the way Harvest restarts a row. The
//     project, task and note come from the entry, so the timer needs neither of
//     the other two, and stopping writes to that entry instead of a new one.
export const startTimerInput = z
	.object({
		projectId: z.uuid().optional(),
		taskId: z.uuid().optional(),
		description: z.string().max(10_000).optional(),
		timeEntryId: z.uuid().optional(),
		headStartSeconds: z
			.number()
			.int()
			.min(0)
			.lt(MAX_DAY_SECONDS, headStartTooLong(MAX_DAY_SECONDS))
			.optional(),
	})
	.refine((input) => input.taskId || input.timeEntryId, {
		message: "Pick a task, or an entry to continue",
		path: ["taskId"],
	});
export type StartTimerInput = z.infer<typeof startTimerInput>;

/** What may be changed while the clock runs. Every field is optional: the
 *  dialog sends only what the person touched. */
export const updateTimerInput = z.object({
	projectId: z.uuid().nullable().optional(),
	taskId: z.uuid().optional(),
	description: z.string().max(10_000).optional(),
});
export type UpdateTimerInput = z.infer<typeof updateTimerInput>;

export const confirmTimerInput = z.object({
	// The day the timer started, as the caller read it — or the day of the entry
	// it continues. Sent rather than derived so the person can move the entry in
	// the dialog that stopping opens — a timer run through midnight is the
	// ordinary case for it.
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd"),
	// For a timer that continues an entry, an ABSENT project or note keeps the
	// entry's own, so a caller that sends only the duration cannot unfile the
	// entry or wipe its note. `null` clears the project and "" clears the note.
	// For a new entry the two mean the same thing.
	projectId: z.uuid().nullable().optional(),
	taskId: z.uuid(),
	description: z.string().max(10_000).optional(),
	// The entry's new TOTAL. For a continued entry that includes what the entry
	// held before the clock began.
	durationSeconds: z
		.number()
		.int()
		.positive("Enter some time")
		.max(MAX_DAY_SECONDS, "A single entry cannot exceed 24 hours")
		.refine((value) => value % QUARTER_HOUR_SECONDS === 0, {
			message: "Time must be in 15-minute steps",
		}),
	overtime: z.boolean().default(false),
});
export type ConfirmTimerInput = z.infer<typeof confirmTimerInput>;

export const timerSettingsInput = z.object({
	// One hour is the shortest cap worth having; a day is the longest a timer
	// could honestly measure, since an entry cannot be longer than one.
	maxSeconds: z
		.number()
		.int()
		.min(3600, "One hour is the shortest limit")
		.max(MAX_DAY_SECONDS, "A day is the longest limit"),
});
export type TimerSettingsInput = z.infer<typeof timerSettingsInput>;
