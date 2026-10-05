import type { TimeEntry } from "@farmer/api-client";

import { MAX_DAY_SECONDS, QUARTER_HOUR_SECONDS } from "../lib/duration";

/**
 * The week as rows of work: one row for each project and task, one cell for
 * each day. The web grid (`week-view.tsx`) writes a cell through one server
 * function; `api/v1` has no such route, so the app plans the same write as
 * a create, a change or a delete of the entries behind the cell.
 */

export type GridRow = {
	key: string;
	projectId: string | null;
	taskId: string;
	/** The project, or the task when the row has no project. */
	heading: string;
	/** The task under a project, or "" when the heading is the task. */
	taskName: string;
	isAbsence: boolean;
	/** The entries behind each day's cell, usually one. */
	byDate: Map<string, TimeEntry[]>;
	/** A rest-of-day block is in the row. Its length follows the day, so the
	 *  row is changed in the day view, as on the web. */
	locked: boolean;
};

/** A row that the person added, with no hours yet. */
export type DraftRow = Omit<GridRow, "byDate" | "locked">;

export const rowKey = (projectId: string | null, taskId: string) =>
	`${projectId ?? "none"}|${taskId}`;

const rowOf = (entry: TimeEntry): DraftRow => ({
	key: rowKey(entry.project?.id ?? null, entry.task.id),
	projectId: entry.project?.id ?? null,
	taskId: entry.task.id,
	heading: entry.project?.name ?? entry.task.name,
	taskName: entry.project ? entry.task.name : "",
	isAbsence: entry.task.isAbsence,
});

/** The rows of a week, from its entries and the empty rows added to it. */
export const buildRows = (
	entries: readonly TimeEntry[],
	drafts: readonly DraftRow[],
): GridRow[] => {
	const rows = new Map<string, GridRow>();
	for (const entry of entries) {
		const base = rowOf(entry);
		let row = rows.get(base.key);
		if (!row) {
			row = { ...base, byDate: new Map(), locked: false };
			rows.set(base.key, row);
		}
		if (entry.fillsDay) row.locked = true;
		row.byDate.set(entry.date, [...(row.byDate.get(entry.date) ?? []), entry]);
	}
	for (const draft of drafts) {
		if (!rows.has(draft.key)) {
			rows.set(draft.key, { ...draft, byDate: new Map(), locked: false });
		}
	}
	return [...rows.values()].sort(
		(a, b) =>
			a.heading.localeCompare(b.heading) ||
			a.taskName.localeCompare(b.taskName),
	);
};

const sum = (entries: readonly TimeEntry[]) =>
	entries.reduce((total, entry) => total + entry.durationSeconds, 0);

/** The time in one cell. */
export const cellSeconds = (row: GridRow, date: string) =>
	sum(row.byDate.get(date) ?? []);

/** The time in a row over the week. */
export const rowSeconds = (row: GridRow, dates: readonly string[]) =>
	dates.reduce((total, date) => total + cellSeconds(row, date), 0);

/** Everything logged on a day. */
export const daySeconds = (entries: readonly TimeEntry[], date: string) =>
	sum(entries.filter((entry) => entry.date === date));

/**
 * One 15-minute step of a cell, up or down. A cell can go to zero, which
 * removes it, and the day it is on can hold at most 24 hours.
 */
export const stepCell = (
	seconds: number,
	steps: number,
	/** Everything on the day, this cell included. */
	dayTotal: number,
) => {
	const room = MAX_DAY_SECONDS - (dayTotal - seconds);
	const next = seconds + steps * QUARTER_HOUR_SECONDS;
	return Math.max(0, Math.min(next, room, MAX_DAY_SECONDS));
};

export type CellWrite =
	| { kind: "none" }
	| { kind: "create"; durationSeconds: number }
	| { kind: "update"; id: string; durationSeconds: number; deleteIds: string[] }
	| { kind: "delete"; ids: string[] };

/**
 * What a new figure in a cell writes, as the server's `setWeekCell` does it:
 * zero deletes the cell, an empty cell gets a new entry, and a filled one
 * changes its first entry and takes the others out. Only the time changes:
 * a note is never part of a cell write.
 */
export const planCellWrite = (
	cell: readonly TimeEntry[],
	durationSeconds: number,
): CellWrite => {
	const entries = cell.filter((entry) => !entry.fillsDay);
	const [first, ...others] = entries;
	if (durationSeconds === 0) {
		return entries.length === 0
			? { kind: "none" }
			: { kind: "delete", ids: entries.map((entry) => entry.id) };
	}
	if (!first) return { kind: "create", durationSeconds };
	if (others.length === 0 && first.durationSeconds === durationSeconds) {
		return { kind: "none" };
	}
	return {
		kind: "update",
		id: first.id,
		durationSeconds,
		deleteIds: others.map((entry) => entry.id),
	};
};

/** The note of a day in a row: the first one of its entries that has one. */
export const storedNote = (row: GridRow, date: string) =>
	(row.byDate.get(date) ?? []).find((entry) => entry.description)
		?.description ?? "";

/** The entries whose note changes when a day of a row gets `note`. */
export const notePatches = (row: GridRow, date: string, note: string) => {
	const next = note.trim();
	if (next === storedNote(row, date)) return [];
	return (row.byDate.get(date) ?? [])
		.filter((entry) => entry.description !== next)
		.map((entry) => ({ id: entry.id, description: next }));
};

/** The ids of a row's entries, one list for each day, in the order the
 *  server must delete them: each delete moves that day's fill block. */
export const rowDeletions = (row: GridRow) =>
	[...row.byDate.values()].map((cell) => cell.map((entry) => entry.id));
