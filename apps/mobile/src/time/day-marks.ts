import type { WorkingHoursDay } from "@farmer/api-client";

import { daySeconds as workingDaySeconds } from "../you/format";

/**
 * The mark under a working day: done, short, or covered because the rest of
 * the week made up for it. This follows `weekDayMarks` in
 * `packages/core/src/lib/day-marks.ts`, because the app does not import the
 * server code (ADR 0005). One difference is on purpose: each day has its own
 * target, from the person's working hours, as "Assemble my day" reads it on
 * the server (`targetSecondsFor` in `packages/core/src/lib/working-day.ts`).
 * The web gives each working day the same figure.
 *
 * A past day is held to the week's figure through today against the targets
 * of the working days before today. Today also counts its own target, so it
 * stays short until it is logged.
 */

export type DayMark = "done" | "covered" | "short";

const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

/**
 * The target of each day, as `targetSecondsFor` on the server: 0 on a public
 * holiday and on a day that is not in the working hours, otherwise the time
 * from the start to the end. Without working hours (they are still loading,
 * or the server cannot give them), each weekday is worth `fallbackSeconds`.
 */
export const dayTargets = ({
	dates,
	workingHours,
	holidays,
	fallbackSeconds,
}: {
	dates: readonly string[];
	workingHours: readonly WorkingHoursDay[] | undefined;
	holidays: { has: (key: string) => boolean };
	fallbackSeconds: number;
}): Map<string, number> =>
	new Map(
		dates.map((date) => {
			if (holidays.has(date)) return [date, 0];
			const weekday = weekdayOf(date);
			if (!workingHours) {
				return [date, weekday === 0 || weekday === 6 ? 0 : fallbackSeconds];
			}
			const day = workingHours.find((row) => row.dayOfWeek === weekday);
			return [
				date,
				day?.enabled && day.startTime && day.endTime
					? workingDaySeconds(day.startTime, day.endTime)
					: 0,
			];
		}),
	);

/** The marks of one week. A day with no mark is not judged: a day with no
 *  target (a weekend, a public holiday, a day off) or a day after today. */
export const weekDayMarks = ({
	dates,
	secondsByDay,
	targets,
	today,
}: {
	dates: readonly string[];
	/** Everything logged on each day: work, breaks and time off. */
	secondsByDay: ReadonlyMap<string, number>;
	/** The target of each day (`dayTargets`). */
	targets: ReadonlyMap<string, number>;
	today: string;
}): Map<string, DayMark> => {
	const targetOf = (date: string) => targets.get(date) ?? 0;
	const loggedSoFar = dates
		.filter((date) => date <= today)
		.reduce((sum, date) => sum + (secondsByDay.get(date) ?? 0), 0);
	const judged = dates.filter((date) => date <= today && targetOf(date) > 0);
	const pastTarget = judged
		.filter((date) => date < today)
		.reduce((sum, date) => sum + targetOf(date), 0);
	const todayTarget = pastTarget + targetOf(today);

	const marks = new Map<string, DayMark>();
	for (const date of judged) {
		const target = date === today ? todayTarget : pastTarget;
		marks.set(
			date,
			(secondsByDay.get(date) ?? 0) >= targetOf(date)
				? "done"
				: loggedSoFar >= target
					? "covered"
					: "short",
		);
	}
	return marks;
};
