import { type DayMark, weekDayMarks } from "@farmer/core/lib/day-marks";
import { formatReportHours } from "@farmer/core/lib/report-format";
import { addDaysToKey, type WeekStartsOn } from "@farmer/core/lib/time";

import { orderedWeekdays } from "#/lib/weekdays.ts";

/** The week chart's plot height in px. The columns, the target rule and the
 *  maximum are all measured against it, so the chart is one number to re-tune. */
export const PLOT_H = 76;

export type WeekDay = {
	label: string;
	key: string;
	seconds: number;
	isToday: boolean;
	isWeekend: boolean;
	holiday: string | undefined;
	mark: DayMark | undefined;
};

export type DayVerdict = "none" | "ok" | "covered" | "bad" | "warn";

/** A covered day is grey, not amber: the week has made up for it, and a bar
 *  still in the week's colours would be the alarm the timesheet strip no
 *  longer raises. A holiday is "warn" and is drawn on its own. */
export function dayVerdict(d: WeekDay): DayVerdict {
	if (d.holiday) return "warn";
	if (d.mark == null) return "none";
	if (d.mark === "done") return "ok";
	if (d.mark === "covered") return "covered";
	return d.seconds === 0 ? "bad" : "warn";
}

/** The small figure under a bar: "hol.", the hours, a dash or nothing. */
export function dayFigure(d: WeekDay): string {
	if (d.holiday) return "hol.";
	if (d.seconds > 0) return formatReportHours(d.seconds);
	return d.mark != null ? "—" : " ";
}

export function greetingForHour(hour: number): string {
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

type TimedEntry = { date: string; durationSeconds: number };

export function sumSeconds(entries: readonly TimedEntry[]): number {
	return entries.reduce((sum, e) => sum + e.durationSeconds, 0);
}

/** A pick outside the week on screen (the week moved on at midnight) is
 *  dropped. Null means today. */
export function resolveSelectedDay(
	pickedDay: string | null,
	weekStart: string,
	weekEnd: string,
	today: string,
): string {
	return pickedDay && pickedDay >= weekStart && pickedDay <= weekEnd
		? pickedDay
		: today;
}

export type WeekChartData = {
	perDay: WeekDay[];
	maxDaySeconds: number;
	targetPx: number;
};

/** Everything the week chart draws, from the week's entries. */
export function buildWeekChart({
	entries,
	weekStart,
	weekStartsOn,
	today,
	daySeconds,
	holidays,
}: {
	entries: readonly TimedEntry[];
	weekStart: string;
	weekStartsOn: WeekStartsOn;
	today: string;
	daySeconds: number;
	holidays: ReadonlyMap<string, string>;
}): WeekChartData {
	const secondsByDay = new Map<string, number>();
	for (const entry of entries) {
		secondsByDay.set(
			entry.date,
			(secondsByDay.get(entry.date) ?? 0) + entry.durationSeconds,
		);
	}
	const weekDays = orderedWeekdays(weekStartsOn).map(
		({ day: weekday, label }, i) => ({
			weekday,
			label,
			key: addDaysToKey(weekStart, i),
		}),
	);
	// The same marks the timesheet's week strip draws, so a day the week has
	// made up for is never amber here and quiet there. A day with no mark is
	// not judged: a future day, a weekend and a public holiday are simply not
	// asked.
	const marks =
		daySeconds > 0
			? weekDayMarks({
					dates: weekDays.map((d) => d.key),
					secondsByDay,
					holidays,
					today,
					daySeconds,
				})
			: null;
	const perDay = weekDays.map(({ weekday, label, key }) => ({
		label,
		key,
		seconds: secondsByDay.get(key) ?? 0,
		isToday: key === today,
		isWeekend: weekday === 0 || weekday === 6,
		holiday: holidays.get(key),
		mark: marks?.get(key),
	}));
	const maxDaySeconds = Math.max(
		...perDay.map((d) => d.seconds),
		daySeconds,
		1,
	);
	// Where the dashed "a day's worth" rule sits, in the plot's own pixels.
	const targetPx = Math.round((daySeconds / maxDaySeconds) * PLOT_H);
	return { perDay, maxDaySeconds, targetPx };
}

type AutoTrackedEntry = TimedEntry & {
	calendarEventId?: string | null;
	commitCount?: number | null;
	pullRequestCount?: number | null;
};

export type AutoTracked = {
	meetingCount: number;
	meetingSeconds: number;
	githubCount: number;
	githubSeconds: number;
	commitTotal: number;
	pullRequestTotal: number;
};

/** "Auto-tracked today": the blocks Farmer filled in for you rather than by
 *  hand — synced Google Calendar meetings (calendarEventId) and GitHub-linked
 *  work (commitCount, pullRequestCount). Both read straight off today's entries. */
export function summarizeAutoTracked(
	todayEntries: readonly AutoTrackedEntry[],
): AutoTracked {
	const meetingEntries = todayEntries.filter((e) => e.calendarEventId);
	const githubEntries = todayEntries.filter(
		(e) => (e.commitCount ?? 0) > 0 || (e.pullRequestCount ?? 0) > 0,
	);
	return {
		meetingCount: meetingEntries.length,
		meetingSeconds: sumSeconds(meetingEntries),
		githubCount: githubEntries.length,
		githubSeconds: sumSeconds(githubEntries),
		commitTotal: githubEntries.reduce((s, e) => s + (e.commitCount ?? 0), 0),
		pullRequestTotal: githubEntries.reduce(
			(s, e) => s + (e.pullRequestCount ?? 0),
			0,
		),
	};
}

/** The text of the GitHub line: "2 commits and 1 PR event". */
export function githubSummary(commitTotal: number, pullRequestTotal: number) {
	return [
		commitTotal > 0
			? `${commitTotal} commit${commitTotal === 1 ? "" : "s"}`
			: null,
		pullRequestTotal > 0
			? `${pullRequestTotal} PR event${pullRequestTotal === 1 ? "" : "s"}`
			: null,
	]
		.filter(Boolean)
		.join(" and ");
}
