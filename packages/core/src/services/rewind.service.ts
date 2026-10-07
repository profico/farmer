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

type RewindDateRange = { from: string; to: string };

/** Everything one Rewind reads, in one round of queries. */
const readRewindRows = async (
	ctx: Ctx,
	year: number,
	lived: RewindDateRange,
) => {
	const yearStart = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;
	const mine = { userId: ctx.userId };

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
				.where(ledgerWhere(ctx, { from: yearStart, to: yearEnd }, "all", mine))
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
	return { rows, holidays, previousYear, notes, commitRows, pullRequestRows };
};

/** One grouped ledger row, as far as the tally reads it. */
type RewindRow = {
	date: string;
	projectId: string | null;
	overtime: boolean;
	taskId: string;
	taskName: string;
	group: TaskGroup;
	systemKey: string | null;
	isAbsence: boolean;
	/** A decimal string, as the database sums it. */
	seconds: string;
};

export type RewindTally = {
	workedByDay: Map<string, number>;
	absenceByDay: Map<string, number>;
	monthWorked: Map<number, number>;
	byProject: Map<string, number>;
	byTask: Map<string, RewindTask>;
	byGroup: Map<TaskGroup, number>;
	weekdays: number[];
	workedSeconds: number;
	overtimeSeconds: number;
	meetingSeconds: number;
	codeReviewSeconds: number;
	vacation: number;
	sick: number;
	otherTimeOff: number;
	/** Time off booked after `asOf`. */
	ahead: number;
	firstDay: string | null;
};

/** Counts a time off row, whichever side of `asOf` it is on. */
const tallyAbsence = (tally: RewindTally, row: RewindRow, asOf: string) => {
	const seconds = Number(row.seconds);
	addTo(tally.absenceByDay, row.date, seconds);
	if (row.systemKey === "vacation") tally.vacation += seconds;
	else if (row.systemKey === "sick") tally.sick += seconds;
	else tally.otherTimeOff += seconds;
	if (row.date > asOf) tally.ahead += seconds;
};

/** Counts a worked row. The caller has already dropped a row after `asOf`. */
const tallyWorked = (tally: RewindTally, row: RewindRow) => {
	const seconds = Number(row.seconds);
	if (tally.firstDay === null || row.date < tally.firstDay) {
		tally.firstDay = row.date;
	}
	tally.workedSeconds += seconds;
	addTo(tally.workedByDay, row.date, seconds);
	addTo(tally.monthWorked, Number(row.date.slice(5, 7)), seconds);
	const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
	tally.weekdays[weekday] = (tally.weekdays[weekday] ?? 0) + seconds;
	if (row.overtime) tally.overtimeSeconds += seconds;
	if (row.projectId) addTo(tally.byProject, row.projectId, seconds);
	const known = tally.byTask.get(row.taskId);
	tally.byTask.set(row.taskId, {
		id: row.taskId,
		name: row.taskName,
		seconds: (known?.seconds ?? 0) + seconds,
	});
	addTo(tally.byGroup, row.group, seconds);
	if (row.systemKey === "meeting") tally.meetingSeconds += seconds;
	if (row.systemKey === "code_review") tally.codeReviewSeconds += seconds;
};

/** Sums the year's rows into the maps and totals the Rewind is built from. */
const tallyRewindRows = (
	rows: readonly RewindRow[],
	asOf: string,
): RewindTally => {
	const tally: RewindTally = {
		workedByDay: new Map(),
		absenceByDay: new Map(),
		monthWorked: new Map(),
		byProject: new Map(),
		byTask: new Map(),
		byGroup: new Map(),
		weekdays: [0, 0, 0, 0, 0, 0, 0],
		workedSeconds: 0,
		overtimeSeconds: 0,
		meetingSeconds: 0,
		codeReviewSeconds: 0,
		vacation: 0,
		sick: 0,
		otherTimeOff: 0,
		ahead: 0,
		firstDay: null,
	};
	for (const row of rows) {
		if (row.isAbsence) tallyAbsence(tally, row, asOf);
		else if (row.date <= asOf) tallyWorked(tally, row);
	}
	return tally;
};

/** The projects the caller worked on, with their client. */
const loadRewindProjects = async (ctx: Ctx, projectIds: string[]) => {
	if (projectIds.length === 0) return [];
	return db
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
};

type BusiestAndWeekends = {
	busiestDay: Rewind["busiestDay"];
	weekendDaysWorked: number;
};

/** The day with most worked time (the earlier day on a tie) and how many
 *  weekend days had work. */
const busiestAndWeekends = (
	workedByDay: ReadonlyMap<string, number>,
): BusiestAndWeekends => {
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
	return { busiestDay, weekendDaysWorked };
};

const pullRequestCounts = (
	rows: readonly { kind: string; count: number }[],
): Rewind["pullRequests"] => {
	const pullRequests = { opened: 0, merged: 0, reviewed: 0 };
	for (const row of rows) {
		if (row.kind === "opened") pullRequests.opened = row.count;
		if (row.kind === "merged") pullRequests.merged = row.count;
		if (row.kind === "reviewed") pullRequests.reviewed = row.count;
	}
	return pullRequests;
};

const bySecondsDesc = (a: { seconds: number }, b: { seconds: number }) =>
	b.seconds - a.seconds;

type RewindReads = Awaited<ReturnType<typeof readRewindRows>>;

/** Puts the tally, the projection and the side reads into the Rewind. */
const assembleRewind = (args: {
	year: number;
	asOf: string;
	complete: boolean;
	tally: RewindTally;
	reads: RewindReads;
	projectRows: Awaited<ReturnType<typeof loadRewindProjects>>;
	projection: ReturnType<typeof projectRestOfYear> | null;
	isWorkingDay: (day: string) => boolean;
}): Rewind => {
	const { year, asOf, tally, reads, projectRows, projection } = args;
	const { busiestDay, weekendDaysWorked } = busiestAndWeekends(
		tally.workedByDay,
	);
	return {
		year,
		asOf,
		complete: args.complete,
		workedSeconds: tally.workedSeconds,
		projectedWorkedSeconds: projection
			? tally.workedSeconds + projection.totalSeconds
			: null,
		previousYearWorkedSeconds:
			reads.previousYear > 0 ? reads.previousYear : null,
		firstDay: tally.firstDay,
		daysWorked: [...tally.workedByDay.values()].filter((s) => s > 0).length,
		longestStreak: longestStreak(
			datesBetween(`${year}-01-01`, asOf),
			(day) => (tally.workedByDay.get(day) ?? 0) > 0,
			args.isWorkingDay,
		),
		busiestDay,
		months: Array.from({ length: 12 }, (_, i) => ({
			month: i + 1,
			seconds: tally.monthWorked.get(i + 1) ?? 0,
			projectedSeconds: projection?.byMonth.get(i + 1) ?? 0,
		})),
		weekdays: tally.weekdays,
		weekendDaysWorked,
		overtimeSeconds: tally.overtimeSeconds,
		projects: projectRows
			.map((p) => ({
				id: p.id,
				name: p.name,
				icon: p.icon,
				clientName: p.clientName,
				seconds: tally.byProject.get(p.id) ?? 0,
			}))
			.sort(bySecondsDesc)
			.slice(0, TOP_COUNT),
		projectCount: projectRows.length,
		clientCount: new Set(projectRows.map((p) => p.clientId)).size,
		tasks: [...tally.byTask.values()].sort(bySecondsDesc).slice(0, TOP_COUNT),
		groups: [...tally.byGroup]
			.map(([group, seconds]) => ({ group, seconds }))
			.sort(bySecondsDesc),
		meetingSeconds: tally.meetingSeconds,
		codeReviewSeconds: tally.codeReviewSeconds,
		timeOff: {
			vacationDays: toDays(tally.vacation),
			sickDays: toDays(tally.sick),
			otherDays: toDays(tally.otherTimeOff),
			aheadDays: toDays(tally.ahead),
		},
		commits: reads.commitRows[0]?.count ?? 0,
		pullRequests: pullRequestCounts(reads.pullRequestRows),
		words: topWords(reads.notes.map((n) => n.description)),
	};
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
		const lived = { from: yearStart, to: asOf };

		const reads = await readRewindRows(ctx, year, lived);
		const { holidays } = reads;
		const isWorkingDay = (day: string) =>
			!isWeekendKey(day) && !holidays.has(day);

		const tally = tallyRewindRows(reads.rows, asOf);
		const projectRows = await loadRewindProjects(ctx, [
			...tally.byProject.keys(),
		]);
		const projection =
			tally.firstDay === null
				? null
				: projectRestOfYear({
						today,
						yearEnd,
						firstDay: tally.firstDay,
						workedByDay: tally.workedByDay,
						absenceByDay: tally.absenceByDay,
						isWorkingDay,
						daySeconds: WORKING_DAY_SECONDS,
					});

		return assembleRewind({
			year,
			asOf,
			complete,
			tally,
			reads,
			projectRows,
			projection,
			isWorkingDay,
		});
	},
};
