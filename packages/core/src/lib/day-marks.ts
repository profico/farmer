import type { HolidayLookup } from "./working-day";

// What a working day says under it on the timesheet's week strip and the home
// page's week chart: done, short, or nothing because the week has covered it.
// Pure, because the browser draws it and `bun test` here is the only suite
// that can hold it (apps/web has none).
//
// A day alone cannot tell "forgot to log" from "worked six hours today and ten
// tomorrow" (issue #58), so the week decides. A day under a day's worth is
// `short` only while its week is behind. It is `covered` when the rest of the
// week has made up for it, weekend hours included, as the targets count them.
//
// Past days and today use different yardsticks, on purpose:
//
// - A past day asks the question of the week tile
//   (`complianceService.myTargets`): the week's total through today against a
//   day's worth for each working day strictly before today. A past day is never
//   red beside a tile that says on track.
// - Today also counts its own day's worth. With the tile's yardstick it would
//   go quiet whenever the week was exactly on target, and the "log today" mark
//   would disappear every morning.
//
// Only hours through today count, so time off booked for later in the week
// cannot hide a gap before it. The tile has the same guard.

export type DayMark = "done" | "covered" | "short";

// Monday to Friday, as the hour fund counts them. The key IS the calendar
// day, so its UTC weekday is the day's weekday.
const isWeekday = (dateKey: string) => {
	const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
	return weekday !== 0 && weekday !== 6;
};

/** The marks for one week's days. A day missing from the result is not judged
 *  at all: a weekend, a public holiday, or a day after today. */
export const weekDayMarks = ({
	dates,
	secondsByDay,
	holidays,
	today,
	daySeconds,
}: {
	/** The week's day keys, in any order. */
	dates: readonly string[];
	/** Everything logged per day — work, breaks and time off, as the targets
	 *  count it. */
	secondsByDay: ReadonlyMap<string, number>;
	holidays: HolidayLookup;
	today: string;
	/** What one working day is worth (`MyTargets.daySeconds`). */
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
