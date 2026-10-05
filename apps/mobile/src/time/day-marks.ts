/**
 * The mark under a working day: done, short, or covered because the rest of
 * the week made up for it. This is a copy of `weekDayMarks` in
 * `packages/core/src/lib/day-marks.ts`, because the app does not import the
 * server code (ADR 0005). Keep the two the same; the tests here are the
 * tests of the original.
 *
 * A past day is held to the week's figure through today against a day's
 * worth for each working day before today. Today also counts its own day's
 * worth, so it stays short until it is logged.
 */

export type DayMark = "done" | "covered" | "short";

const isWeekday = (key: string) => {
	const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
	return weekday !== 0 && weekday !== 6;
};

/** The marks of one week. A day with no mark is not judged: a weekend, a
 *  public holiday or a day after today. */
export const weekDayMarks = ({
	dates,
	secondsByDay,
	holidays,
	today,
	daySeconds,
}: {
	dates: readonly string[];
	/** Everything logged on each day: work, breaks and time off. */
	secondsByDay: ReadonlyMap<string, number>;
	holidays: { has: (key: string) => boolean };
	today: string;
	/** What one working day is worth (`tracking.daySeconds`). */
	daySeconds: number;
}): Map<string, DayMark> => {
	const loggedSoFar = dates
		.filter((date) => date <= today)
		.reduce((sum, date) => sum + (secondsByDay.get(date) ?? 0), 0);
	const judged = dates.filter(
		(date) => date <= today && isWeekday(date) && !holidays.has(date),
	);
	const pastTarget = judged.filter((date) => date < today).length * daySeconds;
	const todayTarget = pastTarget + daySeconds;

	const marks = new Map<string, DayMark>();
	for (const date of judged) {
		const target = date === today ? todayTarget : pastTarget;
		marks.set(
			date,
			(secondsByDay.get(date) ?? 0) >= daySeconds
				? "done"
				: loggedSoFar >= target
					? "covered"
					: "short",
		);
	}
	return marks;
};
