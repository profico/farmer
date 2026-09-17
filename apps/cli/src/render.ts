import type { ApiTimeEntry } from "@farmer/core/api";

import type { DaySpan } from "./dates";
import { formatHours } from "./duration";
import { bold, type Output, print } from "./output";
import { type Column, formatTable, type Table } from "./table";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `Mon 2026-09-14`. A day key names a calendar day, so its weekday is
 *  calendar arithmetic with no timezone in it. */
export const dayTitle = (key: string): string => {
	const weekday = WEEKDAY_NAMES[new Date(`${key}T00:00:00Z`).getUTCDay()];

	return weekday ? `${weekday} ${key}` : key;
};

export const spanTitle = (span: DaySpan): string =>
	span.from === span.to
		? dayTitle(span.from)
		: `${dayTitle(span.from)} to ${dayTitle(span.to)}`;

export const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** Eight characters of the id: what the tables show, and what `edit`, `rm`
 *  and `file` accept back. */
export const shortId = (id: string) => id.slice(0, 8);

export const entryWhat = (entry: ApiTimeEntry): string =>
	entry.project
		? `${entry.project.name} / ${entry.task.name}`
		: entry.task.name;

const entryFlags = (entry: ApiTimeEntry): string => {
	const flags: string[] = [];

	if (entry.fillsDay) flags.push("fill");

	if (entry.overtime) flags.push("overtime");

	if (entry.synced) flags.push("synced");

	return flags.join(", ");
};

/**
 * The order the lists print in, and the order the row numbers count in.
 *
 * One function so the two can never drift: a number the table showed has to
 * still name that row when `edit` reads the day again. `listRange` answers in
 * (date, createdAt, id) order, and `sort` is stable, so this only groups the
 * days of a range and leaves each day as the server ordered it.
 */
export const sortEntries = (entries: ApiTimeEntry[]): ApiTimeEntry[] =>
	[...entries].sort((a, b) => a.date.localeCompare(b.date));

/**
 * The row numbers, counted inside each day rather than down the whole table.
 *
 * A day is the unit every command works in — `edit 3` reads one day and counts
 * its rows — so `3` names the same entry in `farmer ls 2026-09-14` and in the
 * week table that holds that day.
 */
const dayNumbers = (sorted: ApiTimeEntry[]): string[] => {
	const counted = new Map<string, number>();

	return sorted.map((entry) => {
		const next = (counted.get(entry.date) ?? 0) + 1;
		counted.set(entry.date, next);

		return String(next);
	});
};

export const entriesTable = (
	entries: ApiTimeEntry[],
	withDate: boolean,
): Table => {
	const withFlags = entries.some((entry) => entryFlags(entry) !== "");
	const columns: Column[] = [{ header: "#", align: "right" }, { header: "ID" }];

	if (withDate) columns.push({ header: "Date" });
	columns.push(
		{ header: "Time", align: "right" },
		{ header: "Project" },
		{ header: "Task" },
	);

	if (withFlags) columns.push({ header: "Flags" });
	columns.push({ header: "Description", shrink: true });

	const cells = (
		number: string,
		id: string,
		date: string,
		time: string,
		project: string,
		task: string,
		flags: string,
		description: string,
	) => {
		const row = [number, id];

		if (withDate) row.push(date);
		row.push(time, project, task);

		if (withFlags) row.push(flags);
		row.push(description);

		return row;
	};

	const sorted = sortEntries(entries);
	const numbers = dayNumbers(sorted);

	const totalSeconds = sorted.reduce(
		(sum, entry) => sum + entry.durationSeconds,
		0,
	);

	return {
		columns,
		rows: sorted.map((entry, index) =>
			cells(
				numbers[index] ?? "",
				shortId(entry.id),
				entry.date,
				formatHours(entry.durationSeconds),
				entry.project?.name ?? "-",
				entry.task.name,
				entryFlags(entry),
				entry.description,
			),
		),
		total: cells(
			"",
			"Total",
			"",
			formatHours(totalSeconds),
			"",
			"",
			"",
			plural(sorted.length, "entry", "entries"),
		),
	};
};

export const printTable = (out: Output, table: Table) => {
	const lines = formatTable(table, out.columns);
	lines.forEach((text, index) => {
		const emphasise =
			index === 0 || (table.total !== null && index === lines.length - 1);

		print(emphasise ? bold(out, text) : text);
	});
};
