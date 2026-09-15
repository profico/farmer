// Rewind: the caller's own year in review — see `lib/rewind.ts` for when a
// year opens and how December is projected.
//
// Only ever the caller's own time, so there is no scope to resolve beyond the
// membership check: every read below filters on `ctx.userId`. The ledger
// predicate still owns the tenancy, range and classification.

import { and, countDistinct, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { client, project, task, timeEntry } from "../db/schema/domain";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import {
	isRewindOpen,
	isWeekendKey,
	longestStreak,
	projectRestOfYear,
	type RewindStreak,
	type RewindWord,
	topWords,
} from "../lib/rewind";
import { datesBetween, dayKeyInTz } from "../lib/time";
import type { RewindInput } from "../schema/rewind";
import { ctxAccess, ctxTimezone } from "./context";
import { holidaysService } from "./holidays.service";
import { WORKING_DAY_SECONDS } from "./hour-fund.service";
import { ledgerTotal, ledgerWhere } from "./ledger";
import type { Ctx } from "./types";

/** How many projects and tasks a Rewind names. */
const TOP_COUNT = 5;

type TaskGroup = (typeof task.group.enumValues)[number];

export type RewindProject = {
	id: string;
	name: string;
	icon: string | null;
	clientName: string;
	seconds: number;
};

export type RewindTask = { id: string; name: string; seconds: number };

export type RewindMonth = {
	/** 1-12. */
	month: number;
	/** Logged. */
	seconds: number;
	/** Projected on top of `seconds`; zero once the month is over. */
	projectedSeconds: number;
};

export type Rewind = {
	year: number;
	/** The day the year is read as of: today, or 31 December once it is over. */
	asOf: string;
	/** The year is over, so nothing is projected. */
	complete: boolean;
	workedSeconds: number;
	/** Worked plus the projected rest of the year. Null once it is over, or
	 *  when there is no pace to project from yet. */
	projectedWorkedSeconds: number | null;
	/** Worked time the year before; null when there was none to compare. */
	previousYearWorkedSeconds: number | null;
	firstDay: string | null;
	daysWorked: number;
	longestStreak: RewindStreak | null;
	busiestDay: { date: string; seconds: number } | null;
	months: RewindMonth[];
	/** Worked seconds by `Date#getDay()` weekday, Sunday = 0. */
	weekdays: number[];
	weekendDaysWorked: number;
	overtimeSeconds: number;
	projects: RewindProject[];
	projectCount: number;
	clientCount: number;
	tasks: RewindTask[];
	groups: { group: TaskGroup; seconds: number }[];
	meetingSeconds: number;
	codeReviewSeconds: number;
	timeOff: {
		/** In days of `WORKING_DAY_SECONDS`, to the half day. */
		vacationDays: number;
		sickDays: number;
		otherDays: number;
		/** Of those, the days booked after `asOf`. */
		aheadDays: number;
	};
	commits: number;
	pullRequests: { opened: number; merged: number; reviewed: number };
	words: RewindWord[];
};

const toDays = (seconds: number): number =>
	Math.round((seconds / WORKING_DAY_SECONDS) * 2) / 2;

const addTo = <K>(map: Map<K, number>, key: K, seconds: number) => {
	map.set(key, (map.get(key) ?? 0) + seconds);
};

export const rewindService = {
	/**
	 * The caller's year. Refuses a year that has not opened yet (see
	 * `isRewindOpen`) rather than answering with a projection from March.
	 *
	 * Worked time is read through today only — a row on a day nobody has lived
	 * is not a thing somebody did this year. Time off is read across the whole
	 * year, because a booked holiday is exactly what the projection must not
	 * fill with work.
	 */
	mine: async (
		ctx: Ctx,
		input: Pick<RewindInput, "year">,
		opts: { now?: Date } = {},
	): Promise<Rewind> => {
		await ctxAccess(ctx);
		const tz = await ctxTimezone(ctx);
		const today = dayKeyInTz(opts.now ?? new Date(), tz);
		const { year } = input;
		if (!isRewindOpen(year, today)) {
			throw new Error(`Your ${year} Rewind opens on 1 December.`);
		}

		const yearStart = `${year}-01-01`;
		const yearEnd = `${year}-12-31`;
		const asOf = today < yearEnd ? today : yearEnd;
		const complete = today > yearEnd;
		const mine = { userId: ctx.userId };
		const lived = { from: yearStart, to: asOf };

		const [rows, holidays, previousYear, notes, commitRows, pullRequestRows] =
			await Promise.all([
				db
					.select({
						date: timeEntry.date,
						projectId: timeEntry.projectId,
						overtime: timeEntry.overtime,
						taskId: task.id,
						taskName: task.name,
						group: task.group,
						systemKey: task.systemKey,
						isAbsence: task.isAbsence,
						seconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
					})
					.from(timeEntry)
					.innerJoin(task, eq(timeEntry.taskId, task.id))
					.where(
						ledgerWhere(ctx, { from: yearStart, to: yearEnd }, "all", mine),
					)
					.groupBy(
						timeEntry.date,
						timeEntry.projectId,
						timeEntry.overtime,
						task.id,
					),
				holidaysService.holidaySetForRange(ctx, yearStart, yearEnd),
				ledgerTotal(
					ctx,
					{ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
					"worked",
					mine,
				),
				db
					.select({ description: timeEntry.description })
					.from(timeEntry)
					.innerJoin(task, eq(timeEntry.taskId, task.id))
					.where(ledgerWhere(ctx, lived, "worked", mine)),
				db
					.select({ count: countDistinct(timeEntryGithubCommit.sha) })
					.from(timeEntryGithubCommit)
					.innerJoin(
						timeEntry,
						eq(timeEntryGithubCommit.timeEntryId, timeEntry.id),
					)
					.where(ledgerWhere(ctx, lived, "all", mine)),
				db
					.select({
						kind: timeEntryGithubPrActivity.kind,
						count: countDistinct(timeEntryGithubPrActivity.eventId),
					})
					.from(timeEntryGithubPrActivity)
					.innerJoin(
						timeEntry,
						eq(timeEntryGithubPrActivity.timeEntryId, timeEntry.id),
					)
					.where(ledgerWhere(ctx, lived, "all", mine))
					.groupBy(timeEntryGithubPrActivity.kind),
			]);

		const isWorkingDay = (day: string) =>
			!isWeekendKey(day) && !holidays.has(day);

		const workedByDay = new Map<string, number>();
		const absenceByDay = new Map<string, number>();
		const monthWorked = new Map<number, number>();
		const byProject = new Map<string, number>();
		const byTask = new Map<string, RewindTask>();
		const byGroup = new Map<TaskGroup, number>();
		const weekdays = [0, 0, 0, 0, 0, 0, 0];
		let workedSeconds = 0;
		let overtimeSeconds = 0;
		let meetingSeconds = 0;
		let codeReviewSeconds = 0;
		let vacation = 0;
		let sick = 0;
		let otherTimeOff = 0;
		let ahead = 0;
		let firstDay: string | null = null;

		for (const row of rows) {
			const seconds = Number(row.seconds);
			if (row.isAbsence) {
				addTo(absenceByDay, row.date, seconds);
				if (row.systemKey === "vacation") vacation += seconds;
				else if (row.systemKey === "sick") sick += seconds;
				else otherTimeOff += seconds;
				if (row.date > asOf) ahead += seconds;
				continue;
			}
			if (row.date > asOf) continue;
			if (firstDay === null || row.date < firstDay) firstDay = row.date;
			workedSeconds += seconds;
			addTo(workedByDay, row.date, seconds);
			addTo(monthWorked, Number(row.date.slice(5, 7)), seconds);
			const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
			weekdays[weekday] = (weekdays[weekday] ?? 0) + seconds;
			if (row.overtime) overtimeSeconds += seconds;
			if (row.projectId) addTo(byProject, row.projectId, seconds);
			const known = byTask.get(row.taskId);
			byTask.set(row.taskId, {
				id: row.taskId,
				name: row.taskName,
				seconds: (known?.seconds ?? 0) + seconds,
			});
			addTo(byGroup, row.group, seconds);
			if (row.systemKey === "meeting") meetingSeconds += seconds;
			if (row.systemKey === "code_review") codeReviewSeconds += seconds;
		}

		const projectIds = [...byProject.keys()];
		const projectRows =
			projectIds.length === 0
				? []
				: await db
						.select({
							id: project.id,
							name: project.name,
							icon: project.icon,
							clientId: client.id,
							clientName: client.name,
						})
						.from(project)
						.innerJoin(client, eq(project.clientId, client.id))
						.where(
							and(
								eq(project.organizationId, ctx.organizationId),
								inArray(project.id, projectIds),
							),
						);

		const projection =
			firstDay === null
				? null
				: projectRestOfYear({
						today,
						yearEnd,
						firstDay,
						workedByDay,
						absenceByDay,
						isWorkingDay,
						daySeconds: WORKING_DAY_SECONDS,
					});

		let busiestDay: Rewind["busiestDay"] = null;
		let weekendDaysWorked = 0;
		for (const [date, seconds] of workedByDay) {
			if (seconds <= 0) continue;
			if (isWeekendKey(date)) weekendDaysWorked += 1;
			if (
				!busiestDay ||
				seconds > busiestDay.seconds ||
				(seconds === busiestDay.seconds && date < busiestDay.date)
			) {
				busiestDay = { date, seconds };
			}
		}

		const pullRequests = { opened: 0, merged: 0, reviewed: 0 };
		for (const row of pullRequestRows) {
			if (row.kind === "opened") pullRequests.opened = row.count;
			if (row.kind === "merged") pullRequests.merged = row.count;
			if (row.kind === "reviewed") pullRequests.reviewed = row.count;
		}

		const bySecondsDesc = (a: { seconds: number }, b: { seconds: number }) =>
			b.seconds - a.seconds;

		return {
			year,
			asOf,
			complete,
			workedSeconds,
			projectedWorkedSeconds: projection
				? workedSeconds + projection.totalSeconds
				: null,
			previousYearWorkedSeconds: previousYear > 0 ? previousYear : null,
			firstDay,
			daysWorked: [...workedByDay.values()].filter((s) => s > 0).length,
			longestStreak: longestStreak(
				datesBetween(yearStart, asOf),
				(day) => (workedByDay.get(day) ?? 0) > 0,
				isWorkingDay,
			),
			busiestDay,
			months: Array.from({ length: 12 }, (_, i) => ({
				month: i + 1,
				seconds: monthWorked.get(i + 1) ?? 0,
				projectedSeconds: projection?.byMonth.get(i + 1) ?? 0,
			})),
			weekdays,
			weekendDaysWorked,
			overtimeSeconds,
			projects: projectRows
				.map((p) => ({
					id: p.id,
					name: p.name,
					icon: p.icon,
					clientName: p.clientName,
					seconds: byProject.get(p.id) ?? 0,
				}))
				.sort(bySecondsDesc)
				.slice(0, TOP_COUNT),
			projectCount: projectRows.length,
			clientCount: new Set(projectRows.map((p) => p.clientId)).size,
			tasks: [...byTask.values()].sort(bySecondsDesc).slice(0, TOP_COUNT),
			groups: [...byGroup]
				.map(([group, seconds]) => ({ group, seconds }))
				.sort(bySecondsDesc),
			meetingSeconds,
			codeReviewSeconds,
			timeOff: {
				vacationDays: toDays(vacation),
				sickDays: toDays(sick),
				otherDays: toDays(otherTimeOff),
				aheadDays: toDays(ahead),
			},
			commits: commitRows[0]?.count ?? 0,
			pullRequests,
			words: topWords(notes.map((n) => n.description)),
		};
	},
};
