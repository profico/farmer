import type { CalendarEvent, TimeEntry } from "@farmer/api-client";

import { weekdayOf } from "../lib/days";
import { formatHours, QUARTER_HOUR_SECONDS, toQuarter } from "../lib/duration";

/** The first values of the entry form. A new entry starts at one hour. */
export const startOf = (entry: TimeEntry | null) => ({
	taskId: entry?.task.id ?? null,
	absence: entry?.task.isAbsence ?? false,
	seconds: entry ? toQuarter(entry.durationSeconds) : 4 * QUARTER_HOUR_SECONDS,
	note: entry?.description ?? "",
	overtime: entry?.overtime ?? false,
	// A new entry only: an entry keeps what it is.
	fillsDay: entry?.fillsDay ?? false,
});

type DeriveInput = {
	entry: TimeEntry | null;
	read: readonly TimeEntry[];
	date: string;
	absence: boolean;
	repeating: boolean;
	fillsDay: boolean;
	repeatDays: number[] | null;
};

/** What the form shows and sends, from the values that the person set. */
export const deriveForm = (input: DeriveInput) => {
	const { entry, read, date, absence } = input;
	// The server keeps one rest-of-day block on a day, so a second one is
	// refused before it is sent. Only the week behind the form is known.
	const dayHasFill =
		!entry && read.some((row) => row.date === date && row.fillsDay);
	// A switch that the form hides has no effect. Time off has no rest-of-day
	// block and does not repeat, and a repeat is not a rest-of-day block.
	const repeats = input.repeating && !entry && !absence;
	const isFill = entry
		? entry.fillsDay
		: input.fillsDay && !dayHasFill && !absence && !repeats;
	// The repeat days follow the day of the form until the person picks
	// them.
	const days = input.repeatDays ?? [weekdayOf(date)];
	return {
		dayHasFill,
		repeats,
		isFill,
		days,
		showRepeat: !entry && !absence && !isFill,
		showFill: !entry && !absence && !repeats,
		repeatInvalid: repeats && days.length === 0,
	};
};

export type EntryDerived = ReturnType<typeof deriveForm>;

type TaskList = {
	tasks: readonly { id: string; systemKey?: string | null }[];
	absenceTasks: readonly { id: string; systemKey?: string | null }[];
};

/** The task with `id`, from the tasks and the time-off tasks. */
export const findTask = (data: TaskList | undefined, id: string | null) =>
	[...(data?.tasks ?? []), ...(data?.absenceTasks ?? [])].find(
		(row) => row.id === id,
	);

/** The link of the picked meeting, when the form shows it. */
export const meetingLinkOf = (
	picked: CalendarEvent | null,
	derived: EntryDerived,
	absence: boolean,
) => (derived.isFill || absence ? null : (picked?.meetingUrl ?? null));

/** The meeting picker is for the Meeting task, found by its system key:
 *  a workspace may rename the task. */
export const showsCalendarPicker = (
	derived: EntryDerived,
	absence: boolean,
	systemKey: string | null | undefined,
	calendarConnected: boolean,
) =>
	!derived.repeats &&
	!derived.isFill &&
	!absence &&
	systemKey === "meeting" &&
	calendarConnected;

export type EntryValues = {
	date: string;
	taskId: string;
	projectId: string | null;
	absence: boolean;
	seconds: number;
	note: string;
	overtime: boolean;
	until: string | null;
};

const meetingFieldsOf = (
	derived: EntryDerived,
	absence: boolean,
	picked: CalendarEvent | null,
) =>
	derived.isFill || absence
		? {}
		: {
				meetingUrl: picked?.meetingUrl ?? undefined,
				calendarEventId: picked?.id ?? undefined,
			};

/** The body of a new recurring block. */
export const repeatPayload = (values: EntryValues, derived: EntryDerived) => ({
	taskId: values.taskId,
	projectId: values.absence ? undefined : (values.projectId ?? undefined),
	description: values.note.trim() || undefined,
	daysOfWeek: derived.days,
	duration: formatHours(values.seconds),
	effectiveFrom: values.date,
	effectiveUntil: values.until ?? undefined,
});

/** The body of a new entry. */
export const createPayload = (
	values: EntryValues,
	derived: EntryDerived,
	picked: CalendarEvent | null,
) => ({
	date: values.date,
	taskId: values.taskId,
	projectId: values.absence ? undefined : (values.projectId ?? undefined),
	description: values.note.trim(),
	// A rest-of-day block's length comes from the day.
	durationSeconds: derived.isFill ? undefined : values.seconds,
	overtime: values.absence ? false : values.overtime,
	fillsDay: derived.isFill,
	...meetingFieldsOf(derived, values.absence, picked),
});

/** The body of a change to an entry. */
export const updatePayload = (
	id: string,
	values: EntryValues,
	derived: EntryDerived,
	picked: CalendarEvent | null,
) => ({
	id,
	patch: {
		date: values.date,
		taskId: values.taskId,
		// Null clears the project; time off has none.
		projectId: values.absence ? null : values.projectId,
		description: values.note.trim(),
		durationSeconds: derived.isFill ? undefined : values.seconds,
		overtime: values.absence ? false : values.overtime,
		...meetingFieldsOf(derived, values.absence, picked),
	},
});
