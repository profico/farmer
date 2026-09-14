import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

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

// Short form for a message someone reads, e.g. 75240 -> "20h 54m", 3600 ->
// "1h", 2700 -> "45m", 0 -> "0h". Rounds to the nearest minute. The clock form
// above put "20:54:00 short" in every reminder, with seconds that are always
// zero and hours that read as a time of day.
export const formatDurationShort = (totalSeconds: number): string => {
	const totalMinutes = Math.round(totalSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours && minutes) return `${hours}h ${minutes}m`;
	if (minutes) return `${minutes}m`;
	return `${hours}h`;
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

// Accepts "1h30m", "1h30", "90m", "2h", "1:30", a bare number of hours ("1.5",
// "1,5" or ".5"), or an arithmetic expression of hours ("1.5*4" -> 6h,
// "(1+2)/2" -> 1h30m).
//
// Returns null for anything it cannot read IN FULL. That last part is the rule
// worth stating: this used to accept "1h30" as one hour, quietly dropping the
// 30, because the unit pattern scanned for matches instead of consuming the
// string. A duration input that silently discards half of what was typed is the
// one failure mode with no user-visible symptom, so unconsumed text is now an
// error and the caller shows it.
export const parseDuration = (input: string): number | null => {
	// A comma is what half of Europe types for a decimal point, and it can mean
	// nothing else in a duration — there is no thousands separator in "1,5 hours".
	const trimmed = input.trim().toLowerCase().replace(/,/g, ".");
	if (!trimmed) return null;

	// H:MM — the format every duration is DISPLAYED in, so it has to be readable
	// back or editing a cell in place would silently fail. "8:00" is 8 hours,
	// "0:30" is 30 minutes. Checked before the arithmetic branch, which would
	// otherwise choke on the colon.
	const clock = /^(\d+):([0-5]?\d)$/.exec(trimmed);
	if (clock) {
		return Number(clock[1]) * 3600 + Number(clock[2]) * 60;
	}

	// "1h30" — hours, then a bare number that can only be minutes. Written by
	// anyone who reads "1h30m" and thinks the trailing m is optional, which it
	// visibly is on a clock face.
	const hoursThenMinutes = /^(\d+)\s*h\s*([0-5]?\d)$/.exec(trimmed);
	if (hoursThenMinutes) {
		return (
			Number(hoursThenMinutes[1]) * 3600 + Number(hoursThenMinutes[2]) * 60
		);
	}

	// Unit form takes priority whenever an h/m suffix is present.
	if (/[hm]/.test(trimmed)) {
		const unitPattern = /(\d+(?:\.\d+)?)\s*(h|m)/g;
		let totalSeconds = 0;
		let matched = false;
		// Where the last match ended, so a tail the pattern never looked at (the
		// "30" in "1h30x") fails the whole input instead of vanishing.
		let consumedTo = 0;
		for (const match of trimmed.matchAll(unitPattern)) {
			if (
				match.index !== consumedTo &&
				trimmed.slice(consumedTo, match.index).trim() !== ""
			) {
				return null;
			}
			matched = true;
			const value = Number.parseFloat(match[1] ?? "0");
			totalSeconds += match[2] === "h" ? value * 3600 : value * 60;
			consumedTo = match.index + match[0].length;
		}
		if (!matched) return null;
		if (trimmed.slice(consumedTo).trim() !== "") return null;
		return Math.round(totalSeconds);
	}

	// Otherwise treat the input as a number/expression of hours.
	const hours = evalArithmetic(trimmed);
	if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
	return Math.round(hours * 3600);
};

// Entries snap to 15-minute steps (PRD 3.6), enforced by a CHECK constraint. Any
// duration that arrives from outside — a 25-minute calendar meeting, a
// commit-derived estimate — has to be snapped before it can be stored, or the
// insert fails. Rounds to nearest, with a 15-minute floor so a 3-minute event
// still becomes a real block rather than vanishing.
export const QUARTER_HOUR_SECONDS = 900;

export const snapToQuarterHour = (seconds: number): number =>
	Math.max(
		QUARTER_HOUR_SECONDS,
		Math.round(seconds / QUARTER_HOUR_SECONDS) * QUARTER_HOUR_SECONDS,
	);

// yyyy-MM (the month a day key belongs to).
export const monthKeyOf = (dateKey: string): string => dateKey.slice(0, 7);

/** An inclusive span of day keys — the shape every range-taking service reads. */
export type DayKeyRange = { from: string; to: string };

/** A half-open span of instants: `start` inclusive, `end` exclusive. */
export type InstantRange = { start: Date; end: Date };

// First and last day keys of a calendar month.
export const monthBounds = (year: number, month: number): DayKeyRange => {
	const from = `${year}-${String(month).padStart(2, "0")}-01`;
	return { from, to: endOfMonthKey(from) };
};

export const dayKeyInTz = (instant: Date, ianaTz: string): string =>
	format(new TZDate(instant, ianaTz), "yyyy-MM-dd");

export const timeKeyInTz = (instant: Date, ianaTz: string): string =>
	format(new TZDate(instant, ianaTz), "HH:mm");

// Anchors a "yyyy-MM-dd" calendar date to noon in the given timezone, so the
// stored UTC instant still falls on the intended day after dayKeyInTz.
const anchorDate = (dateStr: string, tz: string): Date => {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new TZDate(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, 0, tz);
};

// Midnight-to-midnight bounds of a calendar day in the given timezone.
export const dayBoundsInTz = (dateStr: string, tz: string): InstantRange => {
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

// A day key that names a day that exists. The shape regex the schemas use is not
// enough on its own: "2026-13-45" matches it, and every consumer downstream
// compares day keys as STRINGS, so an impossible date doesn't throw anywhere —
// it just sorts after every real one. That is harmless in a filter and not
// harmless in `automationLockedThrough`, where it silently locks the automations
// forever.
//
// Round-tripping through the date is the check: JS rolls 2026-13-45 over into
// 2027-02-14, so a key that survives the trip unchanged is a real day.
export const isValidDayKey = (dateStr: string): boolean =>
	/^\d{4}-\d{2}-\d{2}$/.test(dateStr) &&
	utcDateToKey(keyToUtcDate(dateStr)) === dateStr;

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

/** The day an organization's weeks start on, numbered as Date#getDay() numbers
 *  it: 1 = Monday (the default), 0 = Sunday. `organization.weekStartsOn`. */
export type WeekStartsOn = 0 | 1;

export const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 1;

/** The column is a plain integer; anything but Sunday reads as Monday. */
export const toWeekStartsOn = (value: number): WeekStartsOn =>
	value === 0 ? 0 : 1;

// Start of the week containing this date. The week start is required rather
// than defaulted: a caller that forgot it would draw a Sunday org's week from
// Monday, and nothing would say so.
export const startOfWeekKey = (
	dateStr: string,
	weekStartsOn: WeekStartsOn,
): string => {
	const date = keyToUtcDate(dateStr);
	const back = (date.getUTCDay() - weekStartsOn + 7) % 7;
	date.setUTCDate(date.getUTCDate() - back);
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
