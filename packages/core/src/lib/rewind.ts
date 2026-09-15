// Rewind: a person's year in review, opened every December.
//
// Pure and browser-safe. The home page decides whether to offer a Rewind and
// the service decides whether to answer one, and the two must agree on the
// same day, so both read the rules from here.

import { addDaysToKey, datesBetween } from "./time";

/** The month a year's Rewind opens in. The year is not over then, so its
 *  figures carry a projection to 31 December. */
export const REWIND_OPENS_MONTH = 12;

const yearOf = (day: string): number => Number(day.slice(0, 4));
const monthOf = (day: string): number => Number(day.slice(5, 7));

/** Whether the Rewind for `year` may be opened on `today`: any year already
 *  over, and the current year from 1 December. */
export const isRewindOpen = (year: number, today: string): boolean =>
	year < yearOf(today) ||
	(year === yearOf(today) && monthOf(today) >= REWIND_OPENS_MONTH);

/** The Rewind the home page offers on `today`, or null. This year's through
 *  December, and last year's through January, so somebody back from the
 *  holidays still finds it. */
export const featuredRewindYear = (today: string): number | null => {
	const month = monthOf(today);
	if (month === REWIND_OPENS_MONTH) return yearOf(today);
	if (month === 1) return yearOf(today) - 1;
	return null;
};

/** The Rewind the page opens when the URL names no year. */
export const defaultRewindYear = (today: string): number =>
	featuredRewindYear(today) ?? yearOf(today) - 1;

/** Saturday or Sunday — the UTC weekday of a bare calendar key, which IS the
 *  calendar day (the same reading as `workingDaysIn`). */
export const isWeekendKey = (day: string): boolean => {
	const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
	return weekday === 0 || weekday === 6;
};

export type RewindStreak = { days: number; from: string; to: string };

/** The longest run of working days with work on each of them. A weekend or a
 *  holiday neither breaks a run nor lengthens it, so two full weeks read as
 *  ten days, not fourteen. */
export const longestStreak = (
	days: readonly string[],
	worked: (day: string) => boolean,
	isWorkingDay: (day: string) => boolean,
): RewindStreak | null => {
	let best: RewindStreak | null = null;
	let current: RewindStreak | null = null;
	for (const day of days) {
		if (!isWorkingDay(day)) continue;
		if (!worked(day)) {
			current = null;
			continue;
		}
		current = current
			? { days: current.days + 1, from: current.from, to: day }
			: { days: 1, from: day, to: day };
		if (!best || current.days > best.days) best = current;
	}
	return best;
};

export type RewindProjectionInput = {
	/** The day in progress. */
	today: string;
	/** 31 December of the Rewind's year. */
	yearEnd: string;
	/** The person's first day with any entry this year. The pace is measured
	 *  from here, so somebody who joined in June is not averaged over the
	 *  months before they existed. */
	firstDay: string;
	/** Worked seconds per day, through today. */
	workedByDay: ReadonlyMap<string, number>;
	/** Time off per day across the whole year, booked days ahead included. */
	absenceByDay: ReadonlyMap<string, number>;
	isWorkingDay: (day: string) => boolean;
	/** A full day of time off. */
	daySeconds: number;
};

export type RewindProjection = {
	/** Worked seconds per working day so far. */
	paceSeconds: number;
	/** The projected rest of the year, by month (1-12). */
	byMonth: Map<number, number>;
	totalSeconds: number;
};

/**
 * The rest of the year at the pace so far: the worked time before today over
 * the working days before today, laid on every working day still to come.
 *
 * Time off already booked is honoured, so a person away from the 22nd is not
 * projected to work over Christmas. Today counts as at least an average day —
 * what is already logged on it is kept and only the difference is projected.
 * Null once the year is over, or when there is no working day behind today to
 * take a pace from.
 */
export const projectRestOfYear = (
	input: RewindProjectionInput,
): RewindProjection | null => {
	const { today, yearEnd, firstDay, isWorkingDay } = input;
	if (today > yearEnd) return null;
	const yesterday = addDaysToKey(today, -1);
	if (firstDay > yesterday) return null;

	let workedBefore = 0;
	let workingDaysBefore = 0;
	for (const day of datesBetween(firstDay, yesterday)) {
		workedBefore += input.workedByDay.get(day) ?? 0;
		if (isWorkingDay(day)) workingDaysBefore += 1;
	}
	if (workingDaysBefore === 0) return null;
	const pace = workedBefore / workingDaysBefore;

	const byMonth = new Map<number, number>();
	let total = 0;
	for (const day of datesBetween(today, yearEnd)) {
		if (!isWorkingDay(day)) continue;
		const away = (input.absenceByDay.get(day) ?? 0) / input.daySeconds;
		let seconds = pace * Math.max(0, 1 - away);
		if (day === today) {
			seconds = Math.max(0, seconds - (input.workedByDay.get(day) ?? 0));
		}
		if (seconds <= 0) continue;
		const month = monthOf(day);
		byMonth.set(month, (byMonth.get(month) ?? 0) + seconds);
		total += seconds;
	}
	for (const [month, seconds] of byMonth) {
		byMonth.set(month, Math.round(seconds));
	}
	return {
		paceSeconds: Math.round(pace),
		byMonth,
		totalSeconds: Math.round(total),
	};
};

// Words that say nothing about the work, in the two languages the notes are
// written in. Anything under four letters is dropped before this is read.
const STOP_WORDS = new Set([
	// English
	"about",
	"after",
	"again",
	"also",
	"been",
	"before",
	"between",
	"both",
	"could",
	"does",
	"doing",
	"done",
	"each",
	"from",
	"have",
	"having",
	"here",
	"into",
	"just",
	"like",
	"made",
	"make",
	"more",
	"most",
	"much",
	"need",
	"only",
	"other",
	"over",
	"same",
	"should",
	"some",
	"still",
	"such",
	"than",
	"that",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"those",
	"under",
	"used",
	"using",
	"very",
	"were",
	"what",
	"when",
	"where",
	"which",
	"while",
	"will",
	"with",
	"would",
	"your",
	// Croatian
	"ako",
	"ali",
	"bila",
	"bilo",
	"biti",
	"dalje",
	"gdje",
	"izmedu",
	"između",
	"jako",
	"jedan",
	"jedna",
	"jedno",
	"još",
	"kada",
	"kako",
	"koja",
	"koje",
	"koji",
	"kroz",
	"može",
	"nakon",
	"neke",
	"neki",
	"nešto",
	"nije",
	"prema",
	"preko",
	"prije",
	"samo",
	"svih",
	"također",
	"treba",
	"zbog",
]);

const URL_RE = /\bhttps?:\/\/\S+/gu;
const WORD_RE = /\p{L}[\p{L}'-]*\p{L}/gu;

export type RewindWord = { word: string; count: number };

/** The words a person wrote most in their notes. A word counts once per note,
 *  so one long note that repeats itself cannot win the year, and a word needs
 *  at least two notes to count at all. */
export const topWords = (notes: readonly string[], limit = 5): RewindWord[] => {
	const counts = new Map<string, number>();
	for (const note of notes) {
		const words = new Set(
			note.replace(URL_RE, " ").toLocaleLowerCase().match(WORD_RE) ?? [],
		);
		for (const word of words) {
			if (word.length < 4 || STOP_WORDS.has(word)) continue;
			counts.set(word, (counts.get(word) ?? 0) + 1);
		}
	}
	return [...counts]
		.filter(([, count]) => count >= 2)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([word, count]) => ({ word, count }));
};
