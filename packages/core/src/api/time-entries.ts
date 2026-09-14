/**
 * Time entries as the REST API answers them.
 *
 * A projection, never the row. `listRange` returns every column of
 * `time_entry` plus its joins, and a CLI binary that is already installed reads
 * whatever it is handed: a column added to the table next month must not become
 * a field somebody's script depends on, and a renamed one must not break it.
 * So each field below is picked by name.
 */

export type ApiTaskRef = { id: string; name: string; isAbsence: boolean };

export type ApiProjectRef = {
	id: string;
	name: string;
	code: string | null;
	client: { id: string; name: string };
};

export type ApiTimeEntry = {
	id: string;
	/** yyyy-MM-dd. */
	date: string;
	durationSeconds: number;
	description: string;
	overtime: boolean;
	/** A rest-of-day block: its duration follows the day, it was not typed. */
	fillsDay: boolean;
	/** Mirrors a calendar event. Google still owns it unless it was filed. */
	synced: boolean;
	commitCount: number;
	task: ApiTaskRef;
	/** Null for time off, a Break, and anything not yet filed. */
	project: ApiProjectRef | null;
};

/** What a projection needs from a row — the joins `listRange` already makes. */
export type TimeEntrySource = {
	id: string;
	date: string;
	durationSeconds: number;
	description: string;
	overtime: boolean;
	fillsDay: boolean;
	calendarEventId: string | null;
	commitCount?: number;
	task: { id: string; name: string; isAbsence: boolean };
	project: {
		id: string;
		name: string;
		code: string | null;
		client: { id: string; name: string };
	} | null;
};

export const toApiTimeEntry = (row: TimeEntrySource): ApiTimeEntry => ({
	id: row.id,
	date: row.date,
	durationSeconds: row.durationSeconds,
	description: row.description,
	overtime: row.overtime,
	fillsDay: row.fillsDay,
	synced: row.calendarEventId != null,
	commitCount: row.commitCount ?? 0,
	task: { id: row.task.id, name: row.task.name, isAbsence: row.task.isAbsence },
	project: row.project
		? {
				id: row.project.id,
				name: row.project.name,
				code: row.project.code,
				client: { id: row.project.client.id, name: row.project.client.name },
			}
		: null,
});

/** `GET /api/v1/orgs/$slug/unfiled` — worked time with no project yet. */
export type ApiUnfiledEntry = {
	id: string;
	date: string;
	durationSeconds: number;
	description: string;
	task: { id: string; name: string };
	meetingUrl: string | null;
};

export const toApiUnfiledEntry = (row: {
	id: string;
	date: string;
	durationSeconds: number;
	description: string;
	taskId: string;
	taskName: string;
	meetingUrl: string | null;
}): ApiUnfiledEntry => ({
	id: row.id,
	date: row.date,
	durationSeconds: row.durationSeconds,
	description: row.description,
	task: { id: row.taskId, name: row.taskName },
	meetingUrl: row.meetingUrl,
});

/** `POST …/time-entries/file`. */
export type ApiFileResult = {
	filed: number;
	failed: number;
	firstError: string | null;
};

/** `POST …/time-entries/copy-day` and `…/copy-week`. `blockedDays` names the
 *  days a week copy left alone because they would pass 24 hours; a day copy
 *  answers an empty list, and refuses with `invalid_input` instead. */
export type ApiCopyResult = {
	copied: number;
	skipped: number;
	blockedDays: string[];
};

/** `POST …/absences` — the days of a span that were booked, and why the rest
 *  were not (a weekend, a holiday, a day already off). */
export type ApiAbsenceResult = {
	booked: { date: string; durationSeconds: number }[];
	skipped: { date: string; reason: string }[];
};

/** Every DELETE answers the id it removed. */
export type ApiDeleted = { id: string };
