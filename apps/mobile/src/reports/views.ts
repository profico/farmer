/**
 * The arithmetic of the report screens, apart from the screens: the groups
 * of a drill-down, the views of the Absence report and the bars of a
 * chart. The rules are the rules of the web app
 * (`components/reports/entries-drilldown.tsx` and `absence-tab.tsx`).
 */

import type { AbsenceReport, TimeReportDetail } from "@farmer/api-client";

import { addDays } from "../lib/days";
import { dayHeading, monthLabel, shiftMonth, spanDays } from "./period";

export type DetailRow = TimeReportDetail["rows"][number];

export type EntryGroupBy = "client" | "project" | "task" | "teammate" | "date";

export const ENTRY_GROUPS: { value: EntryGroupBy; label: string }[] = [
	{ value: "client", label: "Client" },
	{ value: "project", label: "Project" },
	{ value: "task", label: "Task" },
	{ value: "teammate", label: "Teammate" },
	{ value: "date", label: "Date" },
];

export type EntryGroup = {
	key: string;
	label: string;
	/** The code of a project group. */
	code: string | null;
	rows: DetailRow[];
	seconds: number;
	people: number;
};

const keyOf = (row: DetailRow, by: EntryGroupBy) =>
	by === "client"
		? row.client.id
		: by === "project"
			? row.project.id
			: by === "task"
				? row.task.id
				: by === "teammate"
					? row.user.id
					: row.date;

const labelOf = (row: DetailRow, by: EntryGroupBy) =>
	by === "client"
		? row.client.name
		: by === "project"
			? row.project.name
			: by === "task"
				? row.task.name
				: by === "teammate"
					? row.user.name
					: dayHeading(row.date);

/**
 * The entries in groups, by id and not by name: two people can have the
 * same name. Dates are in order; the other groups put the most hours
 * first. The entries in a group are in date order.
 */
export const groupEntries = (
	rows: DetailRow[],
	by: EntryGroupBy,
): EntryGroup[] => {
	const groups = new Map<string, { group: EntryGroup; people: Set<string> }>();
	for (const row of rows) {
		const key = keyOf(row, by);
		const found = groups.get(key) ?? {
			group: {
				key,
				label: labelOf(row, by),
				code: row.project.code,
				rows: [],
				seconds: 0,
				people: 0,
			},
			people: new Set<string>(),
		};
		found.group.rows.push(row);
		found.group.seconds += row.durationSeconds;
		found.people.add(row.user.id);
		groups.set(key, found);
	}
	return [...groups.values()]
		.map(({ group, people }) => ({
			...group,
			people: people.size,
			rows: [...group.rows].sort((a, b) => a.date.localeCompare(b.date)),
		}))
		.sort((a, b) =>
			by === "date" ? a.key.localeCompare(b.key) : b.seconds - a.seconds,
		);
};

/** True when the row holds the search text, in any of its names. */
export const entryMatches = (row: DetailRow, query: string) => {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [
		row.description,
		row.user.name,
		row.client.name,
		row.project.name,
		row.project.code ?? "",
		row.task.name,
	].some((text) => text.toLowerCase().includes(needle));
};

/** The number of people in a set of entries. */
export const peopleIn = (rows: DetailRow[]) =>
	new Set(rows.map((row) => row.user.id)).size;

export type Bucket = { key: string; label: string; seconds: number };

/** The ranges up to this many days show one bar for each day. A longer
 *  range shows one bar for each month. */
export const DAILY_BARS_MAX_DAYS = 31;

/**
 * The hours of a period, one bucket for each day or each month, with the
 * empty buckets in place, so the gaps show. A range of more than a month
 * has a bar for each month.
 */
export const bucketHours = (
	rows: { date: string; durationSeconds: number }[],
	from: string,
	to: string,
): Bucket[] => {
	const daily = spanDays(from, to) <= DAILY_BARS_MAX_DAYS;
	const buckets = new Map<string, Bucket>();
	if (daily) {
		for (let day = from; day <= to; day = addDays(day, 1)) {
			buckets.set(day, {
				key: day,
				label: String(Number(day.slice(8, 10))),
				seconds: 0,
			});
		}
	} else {
		for (
			let day = from;
			day <= to;
			day = `${shiftMonth(day.slice(0, 7), 1)}-01`
		) {
			const month = day.slice(0, 7);
			buckets.set(month, {
				key: month,
				label: monthLabel(month).slice(0, 3),
				seconds: 0,
			});
		}
	}
	for (const row of rows) {
		const bucket = buckets.get(daily ? row.date : row.date.slice(0, 7));
		if (bucket) bucket.seconds += row.durationSeconds;
	}
	return [...buckets.values()];
};

export type AbsenceView = "all" | "vacation" | "sick" | "paid" | "other";

export const ABSENCE_VIEWS: { value: AbsenceView; label: string }[] = [
	{ value: "all", label: "All time-off" },
	{ value: "vacation", label: "Vacation" },
	{ value: "sick", label: "Sick Leave" },
	{ value: "paid", label: "Paid Leave" },
	{ value: "other", label: "Non-vacation leave" },
];

/** The system key of the task that each single view counts. */
const VIEW_KEY = {
	vacation: "vacation",
	sick: "sick",
	paid: "paid_leave",
} as const;

/** The column keys that a view counts. A renamed task keeps its view, and
 *  a new kind of absence is in "Non-vacation leave". */
const keysFor = (
	view: AbsenceView,
	columns: { key: string }[],
): Set<string> => {
	const all = columns.map((column) => column.key);
	if (view === "all") return new Set(all);
	if (view === "other") return new Set(all.filter((key) => key !== "vacation"));
	return new Set([VIEW_KEY[view]]);
};

export type AbsenceViewRow = {
	userId: string;
	name: string;
	seconds: number;
	entries: AbsenceReport["rows"][number]["entries"];
};

/** Each person's hours in the kinds that the view counts. A person with
 *  nothing in the view is not in the list. */
export const absenceView = (
	report: AbsenceReport,
	view: AbsenceView,
): AbsenceViewRow[] => {
	const keys = keysFor(view, report.columns);
	return report.rows
		.map((row) => {
			const entries = row.entries.filter((entry) => keys.has(entry.taskKey));
			return {
				userId: row.userId,
				name: row.name,
				seconds: entries.reduce((sum, entry) => sum + entry.durationSeconds, 0),
				entries,
			};
		})
		.filter((row) => row.entries.length > 0);
};
