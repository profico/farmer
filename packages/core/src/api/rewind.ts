/**
 * `GET …/rewind?year=` — the caller's own year in review.
 *
 * Only the caller's own time, as `rewindService.mine` reads it. The
 * projection copies each field by name for the reason `time-entries.ts`
 * gives.
 */

import type { Rewind } from "../services/rewind.service";

export type ApiRewind = {
	year: number;
	/** The day the year is read as of: today, or 31 December once it is over. */
	asOf: string;
	complete: boolean;
	workedSeconds: number;
	/** Worked time plus the projected rest of the year. Null once the year is
	 *  over, or before there is a pace to project from. */
	projectedWorkedSeconds: number | null;
	previousYearWorkedSeconds: number | null;
	firstDay: string | null;
	daysWorked: number;
	longestStreak: { days: number; from: string; to: string } | null;
	busiestDay: { date: string; seconds: number } | null;
	/** One for each month, 1 to 12. */
	months: { month: number; seconds: number; projectedSeconds: number }[];
	/** Worked seconds by weekday. Index 0 is Sunday. */
	weekdays: number[];
	weekendDaysWorked: number;
	overtimeSeconds: number;
	projects: {
		id: string;
		name: string;
		icon: string | null;
		clientName: string;
		seconds: number;
	}[];
	projectCount: number;
	clientCount: number;
	tasks: { id: string; name: string; seconds: number }[];
	/** Seconds by task group: `engineering`, `product`, `learning`, `general`
	 *  or `time_off`. */
	groups: { group: string; seconds: number }[];
	meetingSeconds: number;
	codeReviewSeconds: number;
	timeOff: {
		vacationDays: number;
		sickDays: number;
		otherDays: number;
		/** Of those, the days booked after `asOf`. */
		aheadDays: number;
	};
	commits: number;
	pullRequests: { opened: number; merged: number; reviewed: number };
	words: { word: string; count: number }[];
};

export const toApiRewind = (rewind: Rewind): ApiRewind => ({
	year: rewind.year,
	asOf: rewind.asOf,
	complete: rewind.complete,
	workedSeconds: rewind.workedSeconds,
	projectedWorkedSeconds: rewind.projectedWorkedSeconds,
	previousYearWorkedSeconds: rewind.previousYearWorkedSeconds,
	firstDay: rewind.firstDay,
	daysWorked: rewind.daysWorked,
	longestStreak: rewind.longestStreak
		? {
				days: rewind.longestStreak.days,
				from: rewind.longestStreak.from,
				to: rewind.longestStreak.to,
			}
		: null,
	busiestDay: rewind.busiestDay
		? { date: rewind.busiestDay.date, seconds: rewind.busiestDay.seconds }
		: null,
	months: rewind.months.map((month) => ({
		month: month.month,
		seconds: month.seconds,
		projectedSeconds: month.projectedSeconds,
	})),
	weekdays: [...rewind.weekdays],
	weekendDaysWorked: rewind.weekendDaysWorked,
	overtimeSeconds: rewind.overtimeSeconds,
	projects: rewind.projects.map((project) => ({
		id: project.id,
		name: project.name,
		icon: project.icon,
		clientName: project.clientName,
		seconds: project.seconds,
	})),
	projectCount: rewind.projectCount,
	clientCount: rewind.clientCount,
	tasks: rewind.tasks.map((task) => ({
		id: task.id,
		name: task.name,
		seconds: task.seconds,
	})),
	groups: rewind.groups.map((group) => ({
		group: group.group,
		seconds: group.seconds,
	})),
	meetingSeconds: rewind.meetingSeconds,
	codeReviewSeconds: rewind.codeReviewSeconds,
	timeOff: {
		vacationDays: rewind.timeOff.vacationDays,
		sickDays: rewind.timeOff.sickDays,
		otherDays: rewind.timeOff.otherDays,
		aheadDays: rewind.timeOff.aheadDays,
	},
	commits: rewind.commits,
	pullRequests: {
		opened: rewind.pullRequests.opened,
		merged: rewind.pullRequests.merged,
		reviewed: rewind.pullRequests.reviewed,
	},
	words: rewind.words.map((word) => ({ word: word.word, count: word.count })),
});
