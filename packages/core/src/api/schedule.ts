/**
 * A person's schedule as the REST API answers it: their working hours, their
 * recurring blocks and the organization's public holidays.
 */

/** `GET …/working-hours` — one day of the caller's week. 0 is Sunday. */
export type ApiWorkingHoursDay = {
	dayOfWeek: number;
	enabled: boolean;
	/** HH:mm, or null when the day has no times. */
	startTime: string | null;
	endTime: string | null;
};

export const toApiWorkingHoursDay = (row: {
	dayOfWeek: number;
	enabled: boolean;
	startTime: string | null;
	endTime: string | null;
}): ApiWorkingHoursDay => ({
	dayOfWeek: row.dayOfWeek,
	enabled: row.enabled,
	startTime: row.startTime,
	endTime: row.endTime,
});

/** `GET …/recurring-blocks` — a rule that writes the same block onto each of
 *  its weekdays. */
export type ApiRecurringBlock = {
	id: string;
	task: { id: string; name: string };
	project: { id: string; name: string; code: string | null } | null;
	description: string;
	/** 0 is Sunday. */
	daysOfWeek: number[];
	durationSeconds: number;
	/** yyyy-MM-dd, or null for no bound. */
	effectiveFrom: string | null;
	effectiveUntil: string | null;
	active: boolean;
};

export const toApiRecurringBlock = (row: {
	id: string;
	description: string;
	daysOfWeek: number[];
	durationSeconds: number;
	effectiveFrom: string | null;
	effectiveUntil: string | null;
	active: boolean;
	task: { id: string; name: string };
	project: { id: string; name: string; code: string | null } | null;
}): ApiRecurringBlock => ({
	id: row.id,
	task: { id: row.task.id, name: row.task.name },
	project: row.project
		? { id: row.project.id, name: row.project.name, code: row.project.code }
		: null,
	description: row.description,
	daysOfWeek: [...row.daysOfWeek],
	durationSeconds: row.durationSeconds,
	effectiveFrom: row.effectiveFrom,
	effectiveUntil: row.effectiveUntil,
	active: row.active,
});

/** `GET …/holidays?year=` — the year's public holidays of the organization's
 *  country. `disabled` is true when an admin switched the day off, so it is a
 *  working day. */
export type ApiHoliday = { date: string; name: string; disabled: boolean };

/** `GET …/holidays/range?from&to` — the holidays that are days off, by day. */
export type ApiHolidayDay = { date: string; name: string };
