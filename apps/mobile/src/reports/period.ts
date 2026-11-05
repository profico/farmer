/**
 * The period of a report, and the steps between periods. This is a copy of
 * `lib/report-period.ts` in the core package: the app cannot import the
 * core (ADR 0005), and the web and the app must read the same days.
 *
 * "Today" comes from the server (`whoami.today`), never from the clock of
 * the phone.
 */

import { addDays, weekStartOf } from "../lib/days";

/** The widest range that a report can cover. The server refuses more. */
export const MAX_REPORT_SPAN_DAYS = 366;

export type PeriodPreset = "week" | "month" | "quarter" | "year" | "custom";

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
	{ value: "quarter", label: "Quarter" },
	{ value: "year", label: "Year" },
	{ value: "custom", label: "Custom" },
];

/** What the person chose. Every field is optional: no choice is this
 *  month. */
export type PeriodSelection = {
	preset?: PeriodPreset;
	/** `yyyy-MM`. The anchor of every preset except Week and Custom. */
	month?: string;
	/** `yyyy-MM-dd`. */
	from?: string;
	/** `yyyy-MM-dd`. */
	to?: string;
};

export type ResolvedPeriod = { preset: PeriodPreset; from: string; to: string };

const pad = (value: number) => String(value).padStart(2, "0");

const parseMonth = (key: string) => {
	const [year, month] = key.split("-").map(Number);
	return { year: year ?? 1970, month: month ?? 1 };
};

/** Move a month key by whole months, and roll the year. */
export const shiftMonth = (key: string, delta: number) => {
	const { year, month } = parseMonth(key);
	const total = year * 12 + (month - 1) + delta;
	return `${Math.floor(total / 12)}-${pad((((total % 12) + 12) % 12) + 1)}`;
};

/** The last day of the month of `key` (`yyyy-MM`). */
export const endOfMonth = (key: string) => {
	const { year, month } = parseMonth(key);
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return `${key}-${pad(last)}`;
};

const startOfQuarter = (key: string) => {
	const { year, month } = parseMonth(key);
	return `${year}-${pad(Math.floor((month - 1) / 3) * 3 + 1)}`;
};

/** The days that a selection covers. */
export const resolvePeriod = (
	selection: PeriodSelection,
	today: string,
	weekStartsOn: number,
): ResolvedPeriod => {
	const thisMonth = today.slice(0, 7);
	const preset = selection.preset ?? "month";

	if (preset === "week") {
		const from = selection.from ?? weekStartOf(today, weekStartsOn);
		return { preset, from, to: addDays(from, 6) };
	}
	if (preset === "custom") {
		const from = selection.from ?? `${selection.month ?? thisMonth}-01`;
		const to = selection.to ?? today;
		// An inverted range is an edit that is not complete. It becomes the
		// one day that the person set.
		const ordered = to < from ? from : to;
		const limit = addDays(from, MAX_REPORT_SPAN_DAYS);
		return { preset, from, to: ordered > limit ? limit : ordered };
	}
	const month = selection.month ?? thisMonth;
	if (preset === "quarter") {
		const first = startOfQuarter(month);
		return {
			preset,
			from: `${first}-01`,
			to: endOfMonth(shiftMonth(first, 2)),
		};
	}
	if (preset === "year") {
		const year = month.slice(0, 4);
		return { preset, from: `${year}-01-01`, to: `${year}-12-31` };
	}
	return { preset, from: `${month}-01`, to: endOfMonth(month) };
};

const monthsPerStep = (preset: PeriodPreset) =>
	preset === "quarter" ? 3 : preset === "year" ? 12 : 1;

/** The selection one step before (`-1`) or after (`1`) this one. */
export const stepPeriod = (
	selection: PeriodSelection,
	delta: number,
	today: string,
	weekStartsOn: number,
): PeriodSelection => {
	const { preset, from } = resolvePeriod(selection, today, weekStartsOn);
	if (preset === "week") {
		return { ...selection, from: addDays(from, 7 * delta), to: undefined };
	}
	const month = selection.month ?? today.slice(0, 7);
	return {
		...selection,
		month: shiftMonth(month, delta * monthsPerStep(preset)),
	};
};

/** A new preset starts again at "now". Custom keeps the range that was on
 *  the screen. */
export const choosePreset = (
	selection: PeriodSelection,
	preset: PeriodPreset,
	today: string,
	weekStartsOn: number,
): PeriodSelection => {
	const { from, to } = resolvePeriod(selection, today, weekStartsOn);
	return preset === "custom"
		? { preset, month: selection.month, from, to }
		: { preset };
};

/** True when the selection holds today. */
export const isCurrentPeriod = (
	selection: PeriodSelection,
	today: string,
	weekStartsOn: number,
) => {
	const { preset, from, to } = resolvePeriod(selection, today, weekStartsOn);
	if (preset === "week") return from === weekStartOf(today, weekStartsOn);
	if (preset === "quarter" || preset === "year") {
		return from <= today && today <= to;
	}
	return (selection.month ?? today.slice(0, 7)) === today.slice(0, 7);
};

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const SHORT_MONTHS = MONTHS.map((name) => name.slice(0, 3));

/** "August 2026". */
export const monthLabel = (key: string) => {
	const { year, month } = parseMonth(key);
	return `${MONTHS[month - 1] ?? ""} ${year}`;
};

/** "12 Aug 2026". */
export const dayLabel = (key: string) => {
	const { year, month } = parseMonth(key);
	return `${Number(key.slice(8, 10))} ${SHORT_MONTHS[month - 1] ?? ""} ${year}`;
};

/** "Wed, 12 Aug". */
export const dayHeading = (key: string) => {
	const day = new Date(`${key}T00:00:00Z`).getUTCDay();
	const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day];
	const { month } = parseMonth(key);
	return `${weekday ?? ""}, ${Number(key.slice(8, 10))} ${SHORT_MONTHS[month - 1] ?? ""}`;
};

/** What the period reads as: "August 2026", "Q3 2026", "2026", or a
 *  range. */
export const periodLabel = (
	selection: PeriodSelection,
	today: string,
	weekStartsOn: number,
) => {
	const { preset, from, to } = resolvePeriod(selection, today, weekStartsOn);
	const month = selection.month ?? today.slice(0, 7);
	if (preset === "month") return monthLabel(month);
	if (preset === "quarter") {
		const { year, month: m } = parseMonth(month);
		return `Q${Math.floor((m - 1) / 3) + 1} ${year}`;
	}
	if (preset === "year") return month.slice(0, 4);
	return `${dayLabel(from)} - ${dayLabel(to)}`;
};

/** The words of the link back to the current period. */
export const returnLabel = (preset: PeriodPreset) =>
	preset === "week"
		? "Return to this week"
		: preset === "quarter"
			? "Return to this quarter"
			: preset === "year"
				? "Return to this year"
				: "Return to this month";

/** The number of days in a range, both ends included. */
export const spanDays = (from: string, to: string) =>
	Math.round(
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
			86_400_000,
	) + 1;
