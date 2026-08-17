import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

/** 15-minute granularity (PRD 3.6): 0.25, 0.5, 0.75... No timer, no clock — an
 *  entry is a date and an amount of time. */
export const QUARTER_HOUR_SECONDS = 900;

const duration = z
	.number()
	.int()
	.positive("Enter some time")
	.max(24 * 3600, "A single entry cannot exceed 24 hours")
	.refine((value) => value % QUARTER_HOUR_SECONDS === 0, {
		message: "Time must be in 15-minute steps",
	});

// A fill block's duration is derived from the day's remaining working hours
// rather than entered, so it is neither supplied nor granularity-checked.
const entryBody = {
	date: dateKey,
	// Absent for Vacation / Sick Leave, which carry no client and no project.
	projectId: z.uuid().optional(),
	// Required on every entry — the structural half of the answer to
	// "descriptions vary wildly"; the mandatory description below is the other.
	taskId: z.uuid(),
	description: z.string().max(10_000).optional(),
	durationSeconds: duration.optional(),
	// Purely manual: no weekend automation, no rules. The person flags it.
	overtime: z.boolean().default(false),
	fillsDay: z.boolean().default(false),
	meetingUrl: z.url().optional(),
	calendarEventId: z.string().optional(),
};

// A description is mandatory on worked time. It is NOT required for absence
// entries (which carry no project — "Vacation" needs no elaboration) or for
// auto-derived fill blocks, since neither is the free-text chaos the rule exists
// to fix. The project/absence distinction is re-checked in the service against
// the task's actual `isAbsence` flag; here we can only see whether a project was
// supplied, which is the same thing from the client's side.
const entryRefinement = <
	T extends {
		projectId?: string;
		description?: string;
		durationSeconds?: number;
		fillsDay: boolean;
	},
>(
	data: T,
	ctx: z.RefinementCtx,
) => {
	if (data.projectId && !data.fillsDay && !data.description?.trim()) {
		ctx.addIssue({
			code: "custom",
			path: ["description"],
			message: "Describe what you worked on",
		});
	}
	if (!data.fillsDay && data.durationSeconds == null) {
		ctx.addIssue({
			code: "custom",
			path: ["durationSeconds"],
			message: "Enter some time",
		});
	}
};

export const createTimeEntryInput = z
	.object(entryBody)
	.superRefine(entryRefinement);
export type CreateTimeEntryInput = z.infer<typeof createTimeEntryInput>;

export const updateTimeEntryInput = z
	.object({ timeEntryId: z.uuid(), ...entryBody })
	.superRefine(entryRefinement);
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntryInput>;

// Patches only the note of an entry — used by inline editing, so it deliberately
// touches nothing duration/day/meeting-related.
export const updateTimeEntryDescriptionInput = z.object({
	timeEntryId: z.uuid(),
	description: z.string().max(10_000),
});
export type UpdateTimeEntryDescriptionInput = z.infer<
	typeof updateTimeEntryDescriptionInput
>;

// Attributing an already-existing entry to a project. Carries only the project,
// because everything else about the entry is already right — a synced meeting
// has its date, duration and task; what it lacks is where the time went.
export const fileTimeEntryInput = z.object({
	timeEntryId: z.uuid(),
	projectId: z.uuid(),
});
export type FileTimeEntryInput = z.infer<typeof fileTimeEntryInput>;

// Filing several entries at once. The calendar sync imports one unfiled entry
// per meeting, so the backlog is measured in dozens — a recurring stand-up alone
// is forty rows of the same answer. Bounded rather than unbounded: a request
// that files more than a couple of hundred entries is a mistake, not a workflow.
export const fileTimeEntriesInput = z.object({
	timeEntryIds: z.array(z.uuid()).min(1).max(200),
	projectId: z.uuid(),
});
export type FileTimeEntriesInput = z.infer<typeof fileTimeEntriesInput>;

// Toggling overtime is a one-field mutation from the week grid.
export const setTimeEntryOvertimeInput = z.object({
	timeEntryId: z.uuid(),
	overtime: z.boolean(),
});
export type SetTimeEntryOvertimeInput = z.infer<
	typeof setTimeEntryOvertimeInput
>;

export const listTimeEntriesRangeInput = z
	.object({ from: dateKey, to: dateKey })
	.refine((data) => data.from <= data.to, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(
		(data) => {
			const from = new Date(`${data.from}T00:00:00Z`);
			const to = new Date(`${data.to}T00:00:00Z`);
			return (to.getTime() - from.getTime()) / 86_400_000 <= 62;
		},
		{ message: "Range too large (max 62 days)", path: ["to"] },
	);
export type ListTimeEntriesRangeInput = z.infer<
	typeof listTimeEntriesRangeInput
>;

// The week grid writes a whole cell at once: "this project+task, on this day,
// is now N hours". Zero clears the cell, which is why this duration allows 0
// where every other one demands a positive value — in a grid, emptying a box IS
// the delete gesture, and routing it through a separate call would make the two
// racy against each other.
export const setWeekCellInput = z.object({
	date: dateKey,
	projectId: z.uuid().optional(),
	taskId: z.uuid(),
	durationSeconds: z
		.number()
		.int()
		.min(0)
		.max(24 * 3600, "A single entry cannot exceed 24 hours")
		.refine((value) => value % QUARTER_HOUR_SECONDS === 0, {
			message: "Time must be in 15-minute steps",
		}),
	// Optional, and the grid never sends it: a cell write says how long you
	// worked, not what you did. Absent means "leave the note alone", which is
	// what makes correcting hours safe for a day that already has a note. Notes
	// are written per day through the row's note button instead, so worked time
	// logged from the grid may legitimately start out with none — the
	// mandatory-description rule holds where it can be answered (the Day
	// dialog's createTimeEntry), not on a spreadsheet cell.
	description: z.string().max(10_000).optional(),
});
export type SetWeekCellInput = z.infer<typeof setWeekCellInput>;

export const deleteTimeEntryInput = z.uuid();
export type DeleteTimeEntryInput = z.infer<typeof deleteTimeEntryInput>;

// Copy a whole day's entries onto another day — the backfill affordance that
// replaces a running timer for people who work a similar shape most days.
export const copyTimeEntriesInput = z.object({
	fromDate: dateKey,
	toDate: dateKey,
});
export type CopyTimeEntriesInput = z.infer<typeof copyTimeEntriesInput>;

// The same affordance a week at a time, which is how Harvest offers it and how
// anyone whose week is shaped like the last one actually works. Takes the two
// week STARTS rather than a range: the seven days are paired up by offset, so
// last Tuesday's entries land on this Tuesday.
export const copyWeekEntriesInput = z.object({
	fromWeekStart: dateKey,
	toWeekStart: dateKey,
});
export type CopyWeekEntriesInput = z.infer<typeof copyWeekEntriesInput>;

// PMs may correct the Vacation/Sick entries of people on their projects, and
// only those. Worked-time corrections live in the close sheet's Adjusted column.
export const overrideAbsenceEntryInput = z.object({
	timeEntryId: z.uuid(),
	durationSeconds: duration,
	description: z.string().max(10_000).optional(),
});
export type OverrideAbsenceEntryInput = z.infer<
	typeof overrideAbsenceEntryInput
>;

// Absence is asked for as a SPAN, never as a list of days: "I'm off from the
// 4th to the 15th" is one sentence, and through `create` it is ten separate
// calls — most of an assistant turn's step budget spent restating the same
// request, with a half-booked holiday as the failure mode if it runs out.
//
// The span is expanded server-side rather than by the caller because the
// expansion needs two things a caller cannot see: the person's own working-hours
// schedule (someone who does not work Wednesdays takes no Wednesday off) and the
// org's holiday calendar. A client that guessed at either would book vacation on
// days nobody was going to work anyway, which quietly inflates every absence
// figure the close sheet subtracts from Expected.
export const logAbsenceRangeInput = z
	.object({
		taskId: z.uuid(),
		from: dateKey,
		to: dateKey,
		description: z.string().max(10_000).optional(),
	})
	.refine((data) => data.from <= data.to, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(
		(data) => {
			const from = new Date(`${data.from}T00:00:00Z`).getTime();
			const to = new Date(`${data.to}T00:00:00Z`).getTime();
			return (to - from) / 86_400_000 <= 62;
		},
		{ message: "Range too large (max 62 days)", path: ["to"] },
	);
export type LogAbsenceRangeInput = z.infer<typeof logAbsenceRangeInput>;

export const listAbsenceForUserInput = z.object({
	userId: z.string().min(1),
	year: z.number().int().min(2000).max(2100),
	month: z.number().int().min(1).max(12),
});
export type ListAbsenceForUserInput = z.infer<typeof listAbsenceForUserInput>;

// "How much vacation have I taken this year" — a whole year, grouped by task,
// which is the question people actually ask and which the month-shaped read
// above answers only twelve calls at a time. `userId` defaults to the caller.
export const absenceTotalsInput = z.object({
	userId: z.string().min(1).optional(),
	year: z.number().int().min(2000).max(2100),
});
export type AbsenceTotalsInput = z.infer<typeof absenceTotalsInput>;

export const createAbsenceForUserInput = z.object({
	userId: z.string().min(1),
	taskId: z.uuid(),
	date: dateKey,
	durationSeconds: duration,
	description: z.string().max(10_000).optional(),
});
export type CreateAbsenceForUserInput = z.infer<
	typeof createAbsenceForUserInput
>;
