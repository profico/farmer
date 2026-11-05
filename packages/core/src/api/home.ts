/**
 * `GET …/home` — the week chart of the home page, for the caller.
 *
 * The web app computes the marks in the browser with `lib/day-marks.ts`. A
 * client that cannot import `@farmer/core` gets them from the server, so the
 * two cannot disagree. The figures of the week and the month are on
 * `GET …/tracking`, and the entries are on `GET …/time-entries`.
 */

/** How a working day stands. `covered` is a short day that the rest of the
 *  week made up for. */
export type ApiDayMark = "done" | "covered" | "short";

export type ApiHomeDay = {
	date: string;
	/** Everything logged on the day: work, breaks and time off. */
	seconds: number;
	/** The name of the public holiday on the day, or null. */
	holiday: string | null;
	/** Null for a day that is not judged: a weekend, a holiday or a day after
	 *  today. */
	mark: ApiDayMark | null;
};

export type ApiHome = {
	/** Today, in the organization's timezone. */
	today: string;
	/** The first and the last day of this week, by the organization's
	 *  `weekStartsOn`. */
	from: string;
	to: string;
	/** What one working day is worth for the caller this month. */
	daySeconds: number;
	/** The seven days, in the order of the organization's week. */
	days: ApiHomeDay[];
};
