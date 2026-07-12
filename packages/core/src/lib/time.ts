import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const secondsBetween = (a: Date, b: Date): number =>
	Math.floor((b.getTime() - a.getTime()) / 1000);

export const finalizeDuration = (
	startedAt: Date,
	stoppedAt = new Date(),
): number => secondsBetween(startedAt, stoppedAt);

export const formatDuration = (totalSeconds: number): string => {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

// Humanized, spelled-out form for reading, e.g. 19200 -> "5 hours 20 minutes",
// 3600 -> "1 hour", 1800 -> "30 minutes", 0 -> "0 minutes". Rounds to the
// nearest minute — this is a display string, not a precise clock.
export const formatDurationLong = (totalSeconds: number): string => {
	const totalMinutes = Math.round(totalSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const parts: string[] = [];
	if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
	if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
	return parts.length ? parts.join(" ") : "0 minutes";
};

const MONTHS_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

// Display a "YYYY-MM-DD" day key in human form, e.g. "Jul 12, 2026" (or
// "Jul 12" when `year: false`). Pure string math — a day key carries no time,
// so there is no timezone to honor.
export const formatDayKey = (
	key: string,
	{ year = true }: { year?: boolean } = {},
): string => {
	const [y, m, d] = key.split("-");
	const base = `${MONTHS_SHORT[Number(m) - 1]} ${Number(d)}`;
	return year ? `${base}, ${y}` : base;
};

// A start–end day-key range in human form:
//   same day       -> "Jul 12, 2026"
//   same year      -> "Dec 1 – Dec 12, 2026"  (year shown once, at the end)
//   spanning years -> "Jun 10, 2025 – Jan 15, 2026"
export const formatDayKeyRange = (start: string, end: string): string => {
	if (start === end) return formatDayKey(start);
	const sameYear = start.slice(0, 4) === end.slice(0, 4);
	return sameYear
		? `${formatDayKey(start, { year: false })} – ${formatDayKey(end)}`
		: `${formatDayKey(start)} – ${formatDayKey(end)}`;
};

// Compact form for prefilling a duration input, e.g. 5400 -> "1h30m".
export const formatDurationInput = (totalSeconds: number): string => {
	const roundedMinutes = Math.round(totalSeconds / 60);
	const hours = Math.floor(roundedMinutes / 60);
	const minutes = roundedMinutes % 60;
	if (hours && minutes) return `${hours}h${minutes}m`;
	if (hours) return `${hours}h`;
	return `${minutes}m`;
};

// Safe evaluator for a plain arithmetic expression of numbers using
// + - * / and parentheses, e.g. "1.5*4" or "(1+2)/2". Numbers may omit the
// leading zero (".5"). Returns null on any syntax error — never uses eval().
const evalArithmetic = (expr: string): number | null => {
	// Whitelist characters up front so nothing unexpected reaches the parser.
	if (!/^[\d.+\-*/()\s]+$/.test(expr)) return null;

	let pos = 0;
	const skipSpace = () => {
		while (expr[pos] === " ") pos++;
	};

	// expression := term (('+' | '-') term)*
	const parseExpression = (): number | null => {
		let left = parseTerm();
		if (left === null) return null;
		skipSpace();
		while (expr[pos] === "+" || expr[pos] === "-") {
			const op = expr[pos++];
			const right = parseTerm();
			if (right === null) return null;
			left = op === "+" ? left + right : left - right;
			skipSpace();
		}
		return left;
	};

	// term := factor (('*' | '/') factor)*
	const parseTerm = (): number | null => {
		let left = parseFactor();
		if (left === null) return null;
		skipSpace();
		while (expr[pos] === "*" || expr[pos] === "/") {
			const op = expr[pos++];
			const right = parseFactor();
			if (right === null) return null;
			if (op === "/" && right === 0) return null;
			left = op === "*" ? left * right : left / right;
			skipSpace();
		}
		return left;
	};

	// factor := ('+' | '-')* ( number | '(' expression ')' )
	const parseFactor = (): number | null => {
		skipSpace();
		let sign = 1;
		while (expr[pos] === "+" || expr[pos] === "-") {
			if (expr[pos] === "-") sign = -sign;
			pos++;
			skipSpace();
		}
		if (expr[pos] === "(") {
			pos++;
			const value = parseExpression();
			if (value === null) return null;
			skipSpace();
			if (expr[pos] !== ")") return null;
			pos++;
			return sign * value;
		}
		const start = pos;
		while (pos < expr.length && /[\d.]/.test(expr[pos] ?? "")) pos++;
		const numStr = expr.slice(start, pos);
		if (!/^(\d+\.?\d*|\.\d+)$/.test(numStr)) return null;
		return sign * Number.parseFloat(numStr);
	};

	const result = parseExpression();
	skipSpace();
	// Trailing garbage (e.g. "1 2" or "1)") means the whole input is invalid.
	if (pos !== expr.length) return null;
	return result;
};

// Accepts "1h30m", "90m", "2h", a bare number of hours ("1.5" or ".5"), or an
// arithmetic expression of hours ("1.5*4" -> 6h, "(1+2)/2" -> 1h30m).
export const parseDuration = (input: string): number | null => {
	const trimmed = input.trim().toLowerCase();
	if (!trimmed) return null;

	// Unit form takes priority whenever an h/m suffix is present.
	if (/[hm]/.test(trimmed)) {
		const unitPattern = /(\d+(?:\.\d+)?)\s*(h|m)/g;
		let totalSeconds = 0;
		let matched = false;
		for (const match of trimmed.matchAll(unitPattern)) {
			matched = true;
			const value = Number.parseFloat(match[1] ?? "0");
			totalSeconds += match[2] === "h" ? value * 3600 : value * 60;
		}
		return matched ? Math.round(totalSeconds) : null;
	}

	// Otherwise treat the input as a number/expression of hours.
	const hours = evalArithmetic(trimmed);
	if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
	return Math.round(hours * 3600);
};

export const dayKeyInTz = (instant: Date, ianaTz: string): string =>
	format(new TZDate(instant, ianaTz), "yyyy-MM-dd");

export const timeKeyInTz = (instant: Date, ianaTz: string): string =>
	format(new TZDate(instant, ianaTz), "HH:mm");

// Anchors a "yyyy-MM-dd" calendar date to noon in the given timezone, so the
// stored UTC instant still falls on the intended day after dayKeyInTz.
export const anchorDate = (dateStr: string, tz: string): Date => {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new TZDate(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, 0, tz);
};

// Midnight-to-midnight bounds of a calendar day in the given timezone.
export const dayBoundsInTz = (
	dateStr: string,
	tz: string,
): { start: Date; end: Date } => {
	const [year, month, day] = dateStr.split("-").map(Number);
	return {
		start: new TZDate(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, tz),
		end: new TZDate(
			year ?? 1970,
			(month ?? 1) - 1,
			(day ?? 1) + 1,
			0,
			0,
			0,
			tz,
		),
	};
};

// Pure "yyyy-MM-dd" calendar-key arithmetic, deliberately not using date-fns'
// format/parse (which read local machine time) — everything here is UTC-anchored
// so results don't depend on the host process's timezone.
const keyToUtcDate = (dateStr: string): Date => {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
};
const utcDateToKey = (date: Date): string => {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
};

// Inclusive list of "yyyy-MM-dd" date keys between two date keys.
export const datesBetween = (fromStr: string, toStr: string): string[] => {
	const cursor = keyToUtcDate(fromStr);
	const end = keyToUtcDate(toStr);
	const dates: string[] = [];
	while (cursor.getTime() <= end.getTime()) {
		dates.push(utcDateToKey(cursor));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return dates;
};

export const addDaysToKey = (dateStr: string, amount: number): string => {
	const date = keyToUtcDate(dateStr);
	date.setUTCDate(date.getUTCDate() + amount);
	return utcDateToKey(date);
};

// Count working days in the inclusive [from, to] range: days whose weekday is
// in `enabledWeekdays` (0=Sun..6=Sat, matching memberWorkingHoursDay.dayOfWeek)
// and whose key is not in `holidayKeys`. Pure — the caller supplies the member's
// enabled weekdays and the (disable-aware) holiday key set.
export const countWorkingDays = (
	from: string,
	to: string,
	enabledWeekdays: Set<number>,
	holidayKeys: Set<string>,
): number =>
	datesBetween(from, to).filter(
		(key) =>
			enabledWeekdays.has(keyToUtcDate(key).getUTCDay()) &&
			!holidayKeys.has(key),
	).length;

// Monday-based start of the week containing this date.
export const startOfWeekKey = (dateStr: string): string => {
	const date = keyToUtcDate(dateStr);
	const day = date.getUTCDay(); // 0=Sun..6=Sat
	const diff = day === 0 ? -6 : 1 - day;
	date.setUTCDate(date.getUTCDate() + diff);
	return utcDateToKey(date);
};

export const startOfMonthKey = (dateStr: string): string =>
	`${dateStr.slice(0, 7)}-01`;

export const endOfMonthKey = (dateStr: string): string => {
	const [year, month] = dateStr.split("-").map(Number);
	// Day 0 of next month = last day of this month.
	return utcDateToKey(new Date(Date.UTC(year ?? 1970, month ?? 1, 0)));
};

// 0=Sun..6=Sat, matching Date#getDay() and recurringBlockRule.daysOfWeek.
export const weekdayInTz = (dateStr: string, tz: string): number =>
	anchorDate(dateStr, tz).getDay();

// Minutes since local midnight, in the given timezone (0-1439).
export const minutesSinceMidnightInTz = (
	instant: Date,
	ianaTz: string,
): number => {
	const zoned = new TZDate(instant, ianaTz);
	return zoned.getHours() * 60 + zoned.getMinutes();
};

// Anchors a "yyyy-MM-dd" date + "HH:mm" time to an instant in the given timezone.
export const anchorDateTime = (
	dateStr: string,
	timeStr: string,
	tz: string,
): Date => {
	const [year, month, day] = dateStr.split("-").map(Number);
	const [hours, minutes] = timeStr.split(":").map(Number);
	return new TZDate(
		year ?? 1970,
		(month ?? 1) - 1,
		day ?? 1,
		hours ?? 0,
		minutes ?? 0,
		0,
		tz,
	);
};
