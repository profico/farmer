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
} from "./time";

export type PeriodPreset = "month" | "week" | "custom";

/** Month leads because a month is what the close, the invoice and every other
 *  report in the product are keyed on. */
export const PERIOD_PRESETS = [
	{ id: "month", label: "Month" },
	{ id: "week", label: "Week" },
	{ id: "custom", label: "Custom" },
] as const satisfies readonly { id: PeriodPreset; label: string }[];

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

/** `2026-07` -> `{ year: 2026, month: 7 }`. Month is 1-based, matching every
 *  month-keyed row in the database and every `MonthReportInput`. */
export const parseMonthKey = (key: string): { year: number; month: number } => {
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
 * reads the clock cannot be pinned by a test.
 */
export const resolveReportPeriod = (
	selection: PeriodSelection,
	today: string,
): ResolvedPeriod => {
	const thisMonth = monthKeyOf(today);
	const preset = selection.preset ?? "month";

	if (preset === "week") {
		const from = selection.from ?? startOfWeekKey(today);
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
	return { preset, from: `${month}-01`, to: endOfMonthKey(`${month}-01`) };
};

/** Whether a selection is sitting on the current period — what the "Today" /
 *  "This month" affordance greys itself out for. */
export const isCurrentPeriod = (
	selection: PeriodSelection,
	today: string,
): boolean => {
	const { preset, from } = resolveReportPeriod(selection, today);
	if (preset === "week") return from === startOfWeekKey(today);
	// Month and Custom both step by month, so the month key is what "current"
	// means for either — a custom range is still anchored to the month picker.
	return (selection.month ?? monthKeyOf(today)) === monthKeyOf(today);
};
