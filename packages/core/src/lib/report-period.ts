// The period a report covers, and the arithmetic for moving between periods.
//
// This is domain arithmetic, not view code: which seven days a "week" is, which
// month a bare month key names, and what "the previous month" means all have to
// answer the same way on the reports screen, in the PDF and in any future API
// caller. It lived in the reports route, where only the route could reach it and
// only a browser could exercise it — the route's own copy of `startOfWeekKey`
// had already drifted into existence alongside the one in `time.ts`.

import {
	addDaysToKey,
	endOfMonthKey,
	monthKeyOf,
	startOfWeekKey,
	type WeekStartsOn,
} from "./time";

export type PeriodPreset = "week" | "month" | "quarter" | "year" | "custom";

/** Harvest's order, which the COO signed off screen by screen: shortest to
 *  longest, then the free range. */
export const PERIOD_PRESETS = [
	{ id: "week", label: "Week" },
	{ id: "month", label: "Month" },
	{ id: "quarter", label: "Quarter" },
	{ id: "year", label: "Year" },
	{ id: "custom", label: "Custom" },
] as const satisfies readonly { id: PeriodPreset; label: string }[];

/** The first month of the quarter a month key sits in: `2026-08` -> `2026-07`. */
export const startOfQuarterKey = (monthKey: string): string => {
	const { year, month } = parseMonthKey(monthKey);
	const first = Math.floor((month - 1) / 3) * 3 + 1;
	return `${year}-${String(first).padStart(2, "0")}`;
};

/** `2026-08` -> "Q3 2026". */
export const formatQuarterKey = (monthKey: string): string => {
	const { year, month } = parseMonthKey(monthKey);
	return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
};

/** What the caller asked for — the reports route's search params, minus the
 *  parts that select a view rather than a period. Every field is optional
 *  because a bare `/reports` is a valid request. */
export type PeriodSelection = {
	preset?: PeriodPreset;
	/** `YYYY-MM` */
	month?: string;
	/** `YYYY-MM-DD` */
	from?: string;
	/** `YYYY-MM-DD` */
	to?: string;
};

export type ResolvedPeriod = {
	preset: PeriodPreset;
	from: string;
	to: string;
};

/** A month key taken apart. Month is 1-based, matching every month-keyed row
 *  in the database and every `MonthReportInput`. */
export type MonthKeyParts = { year: number; month: number };

/** `2026-07` -> `{ year: 2026, month: 7 }`. */
export const parseMonthKey = (key: string): MonthKeyParts => {
	const [year, month] = key.split("-").map(Number);
	return { year: year ?? 1970, month: month ?? 1 };
};

/** Move a month key by whole months, rolling the year. */
export const shiftMonthKey = (key: string, delta: number): string => {
	const { year, month } = parseMonthKey(key);
	const total = year * 12 + (month - 1) + delta;
	return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, "0")}`;
};

/** The `count` months ending at (and including) `end`, oldest first — the x
 *  axis of every trend in the reports screen. */
export const trailingMonths = (
	end: { year: number; month: number },
	count: number,
): { year: number; month: number }[] => {
	const endKey = `${end.year}-${String(end.month).padStart(2, "0")}`;
	return Array.from({ length: Math.max(count, 0) }, (_, i) =>
		parseMonthKey(shiftMonthKey(endKey, i - (count - 1))),
	);
};

/**
 * Turn a selection into the concrete day range a report reads.
 *
 * `today` is passed in rather than read from the clock: the answer depends on
 * the org's display timezone, which only the caller knows, and a function that
 * reads the clock cannot be pinned by a test. `weekStartsOn` is the org's, so
 * a week report covers the same seven days the timesheet draws.
 */
export const resolveReportPeriod = (
	selection: PeriodSelection,
	today: string,
	weekStartsOn: WeekStartsOn,
): ResolvedPeriod => {
	const thisMonth = monthKeyOf(today);
	const preset = selection.preset ?? "month";

	if (preset === "week") {
		const from = selection.from ?? startOfWeekKey(today, weekStartsOn);
		return { preset, from, to: addDaysToKey(from, 6) };
	}

	if (preset === "custom") {
		const from = selection.from ?? `${selection.month ?? thisMonth}-01`;
		const to = selection.to ?? today;
		// An inverted range is a half-finished edit in the date pickers, not an
		// error worth a screen: collapse it to the single day the user has set.
		return { preset, from, to: to < from ? from : to };
	}

	const month = selection.month ?? thisMonth;
	if (preset === "quarter") {
		const first = startOfQuarterKey(month);
		const last = shiftMonthKey(first, 2);
		return { preset, from: `${first}-01`, to: endOfMonthKey(`${last}-01`) };
	}
	if (preset === "year") {
		const { year } = parseMonthKey(month);
		return { preset, from: `${year}-01-01`, to: `${year}-12-31` };
	}
	return { preset, from: `${month}-01`, to: endOfMonthKey(`${month}-01`) };
};

/** How far one ‹ › step moves the anchor month for a preset. */
export const monthsPerStep = (preset: PeriodPreset): number =>
	preset === "quarter" ? 3 : preset === "year" ? 12 : 1;

/** Whether a selection is sitting on the current period — what the "Today" /
 *  "This month" affordance greys itself out for. */
export const isCurrentPeriod = (
	selection: PeriodSelection,
	today: string,
	weekStartsOn: WeekStartsOn,
): boolean => {
	const { preset, from, to } = resolveReportPeriod(
		selection,
		today,
		weekStartsOn,
	);
	if (preset === "week") return from === startOfWeekKey(today, weekStartsOn);
	if (preset === "quarter" || preset === "year") {
		return from <= today && today <= to;
	}
	// Month and Custom both step by month, so the month key is what "current"
	// means for either — a custom range is still anchored to the month picker.
	return (selection.month ?? monthKeyOf(today)) === monthKeyOf(today);
};
