import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, user } from "../db/schema/auth";
import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	monthBounds,
	QUARTER_HOUR_SECONDS,
	startOfWeekKey,
} from "../lib/time";
import { isHourlyMemberType } from "../schema/members";
import type { MonthReportInput } from "../schema/reports";
import { accessService } from "./access.service";
import { ctxAccess, ctxTimezone, ctxWeekStartsOn } from "./context";
import { holidaysService } from "./holidays.service";
import { hourFundService, WORKING_DAY_SECONDS } from "./hour-fund.service";
import { ledgerByUser } from "./ledger";
import { membersService, type ResolvedMemberType } from "./members.service";
import { orgSettingsService } from "./org-settings.service";
import type { Ctx } from "./types";

// Tracking (PRD 6.2, revised Sept 2026) — one rule, two consumers: the Tracking
// report and the reminders, so the two can never disagree about who is behind.
//
// The rule. For a month with hour fund F (Settings → Hour fund — the official
// monthly figure, "radni sati": working days × 8h, holidays already out):
// target so far = F × working days elapsed ÷ working days in the month, where
// a working day is Monday to Friday that is not a public holiday. Dividing by
// the same days the fund was built from is what keeps every working day worth
// exactly 8h — dividing by all weekdays made a day worth 7h38m in any month
// with a holiday. A person's total is work PLUS time off — a day of vacation is
// a day accounted for, not a day short. On track when total ≥ target; slightly
// behind when within the org's tolerance (default 5%); behind otherwise. Once
// the month is over the target is the whole fund.
//
// "Working days elapsed" counts only days strictly BEFORE today — today's own
// working day is still in progress, so it is not "elapsed" yet. The nudge runs
// at 09:00; counting today made a person who had logged a full day on every
// earlier working day show up short by a day's worth of hours until evening,
// and made the 1st of every month open with "No time logged yet" for
// everyone. The totals (work + time off) still cover up to and including
// today, so logging early in the day can only help, never hurt, a verdict. A
// finished month's elapsed figure is still every working day it had — the
// month is over, so nothing in it is still "in progress".
//
// Who has a target: employees, full-time students and full-time contractors —
// the fund applies to them. Hourly people are listed with their hours and no
// status unless an explicit expected-hours override was set for them. Overhead
// people and archived people are not listed at all.
//
// Nothing about a person's own schedule enters this: the fund is an org-wide
// figure, and the rule is the same for everyone it applies to.

export type TrackingStatus = "on_track" | "slightly_behind" | "behind";

export type TrackingRow = {
	userId: string;
	name: string;
	email: string;
	memberType: ResolvedMemberType["type"];
	workSeconds: number;
	timeOffSeconds: number;
	/** work + time off. */
	totalSeconds: number;
	/** This person's target so far, or null when no target applies to them. */
	targetSeconds: number | null;
	/** The whole month's figure for this person — their override, or the fund
	 *  — or null when no target applies to them. */
	monthTargetSeconds: number | null;
	/** total − target; null with no target. Negative is short. */
	deltaSeconds: number | null;
	status: TrackingStatus | null;
};

export type TrackingReport = {
	year: number;
	month: number;
	/** The last day the figures cover: today, or the month's last day once it
	 *  has passed. */
	asOf: string;
	complete: boolean;
	fundSeconds: number | null;
	workingDaysInMonth: number;
	/** Working days strictly BEFORE `asOf`'s day, or every working day in the
	 *  month once it is over — today's own working day is still in progress
	 *  and is never counted as elapsed. */
	workingDaysElapsed: number;
	/** The org-wide target so far (the fund prorated), or null with no fund. */
	targetSeconds: number | null;
	tolerancePct: number;
	rows: TrackingRow[];
};

/** People the tracking machinery applies to at all. Overhead people never
 *  appear anywhere in it — the system never nags the CEO about timesheets — and
 *  neither do archived people, who cannot act on a nudge at all. */
export type CohortMember = {
	userId: string;
	name: string;
	email: string;
	memberType: ResolvedMemberType;
};

/** Both the report and the reminders answer "as of now", and `now` is how a
 *  caller says which now — every figure is a fraction of the month elapsed,
 *  and a suite that cannot choose the date can only assert what happens to be
 *  true on the day it runs. Production passes nothing and gets the real
 *  clock. `onlyUserIds` is the caller's people scope; the public methods fill
 *  it in, the reminder job leaves it empty on purpose. */
export type ComplianceOpts = {
	now?: Date;
	onlyUserIds?: ReadonlySet<string> | null;
};

/** Working days in the inclusive range: Monday to Friday, minus the org's
 *  public holidays — the same days the official monthly fund counts, so fund ÷
 *  working days is a whole 8h. The numerator and the denominator of the
 *  proration both come from here. */
export const workingDaysIn = (
	from: string,
	to: string,
	// The org calendar's date → name map, or any set-like of day keys.
	holidays: { has(key: string): boolean },
): number => {
	if (from > to) return 0;
	return datesBetween(from, to).filter((key) => {
		if (holidays.has(key)) return false;
		// UTC weekday of a bare calendar key — the key IS the calendar day.
		const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
		return weekday !== 0 && weekday !== 6;
	}).length;
};

/** The part of a month's fund that `days` of its `daysInMonth` working days
 *  are worth. To the nearest quarter hour, the unit every other figure in the
 *  app is in. With the official fund this is a whole number of 8h days; it
 *  only rounds when an admin entered a fund that is not a multiple of the
 *  days. */
const prorateFund = (fund: number, days: number, daysInMonth: number) =>
	daysInMonth === 0
		? 0
		: Math.round((fund * (days / daysInMonth)) / QUARTER_HOUR_SECONDS) *
			QUARTER_HOUR_SECONDS;

/** The three-way verdict. Pure, so the report and the reminders share it. */
export const trackingStatusFor = (
	totalSeconds: number,
	targetSeconds: number,
	tolerancePct: number,
): TrackingStatus => {
	if (totalSeconds >= targetSeconds) return "on_track";
	if (totalSeconds >= targetSeconds * (1 - tolerancePct / 100)) {
		return "slightly_behind";
	}
	return "behind";
};

const STATUS_RANK = {
	behind: 0,
	slightly_behind: 1,
	on_track: 2,
} satisfies Record<TrackingStatus, number>;

const complianceCohort = async (
	ctx: Ctx,
	asOfMonth: { year: number; month: number },
	onlyUserIds: ReadonlySet<string> | null = null,
): Promise<CohortMember[]> => {
	const [people, types, archived] = await Promise.all([
		db
			.select({ userId: member.userId, name: user.name, email: user.email })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, ctx.organizationId)),
		membersService.typesForMonth(ctx, asOfMonth.year, asOfMonth.month),
		membersService.archivedUserIds(ctx),
	]);

	return people
		.map((p) => ({
			...p,
			memberType: types.get(p.userId) ?? {
				type: "employee_billable" as const,
				expectedSecondsOverride: null,
			},
		}))
		.filter(
			(p) =>
				p.memberType.type !== "employee_overhead" &&
				!archived.has(p.userId) &&
				(onlyUserIds === null || onlyUserIds.has(p.userId)),
		);
};

// The rule, computed without any authorization check. Module-private: the
// public method scopes it by the caller's people, and the reminder job's entry
// point below says out loud that it runs on nobody's behalf.
const computeTracking = async (
	ctx: Ctx,
	{ year, month }: MonthReportInput,
	opts: ComplianceOpts,
): Promise<TrackingReport> => {
	const [tz, settings] = await Promise.all([
		ctxTimezone(ctx),
		orgSettingsService.get(ctx),
	]);
	const today = dayKeyInTz(opts.now ?? new Date(), tz);
	const { from, to } = monthBounds(year, month);
	const complete = today > to;
	const asOf = complete ? to : today;
	const holidays = await holidaysService.holidaySetForRange(ctx, from, to);
	const workingDaysInMonth = workingDaysIn(from, to, holidays);
	// A finished month has nothing left "in progress", so every one of its
	// working days counts as elapsed; a month still running only counts the
	// days strictly before today — today itself is not over yet.
	const elapsedThrough = complete ? to : addDaysToKey(today, -1);
	const workingDaysElapsed =
		today < from ? 0 : workingDaysIn(from, elapsedThrough, holidays);
	const prorate = (fund: number) =>
		prorateFund(fund, workingDaysElapsed, workingDaysInMonth);

	const [cohort, fundSeconds] = await Promise.all([
		complianceCohort(ctx, { year, month }, opts.onlyUserIds ?? null),
		hourFundService.get(ctx, year, month),
	]);
	const tolerancePct = settings.trackingTolerancePct;
	const targetSeconds = fundSeconds == null ? null : prorate(fundSeconds);
	if (cohort.length === 0 || today < from) {
		return {
			year,
			month,
			asOf,
			complete,
			fundSeconds,
			workingDaysInMonth,
			workingDaysElapsed,
			targetSeconds,
			tolerancePct,
			rows: [],
		};
	}

	const userIds = cohort.map((c) => c.userId);
	const [worked, timeOff] = await Promise.all([
		ledgerByUser(ctx, { from, to: asOf }, "worked", { userIds }),
		ledgerByUser(ctx, { from, to: asOf }, "absence", { userIds }),
	]);

	const rows: TrackingRow[] = cohort.map((person) => {
		const workSeconds = worked.get(person.userId) ?? 0;
		const timeOffSeconds = timeOff.get(person.userId) ?? 0;
		const totalSeconds = workSeconds + timeOffSeconds;
		// An explicit override replaces the fund for this person; an hourly
		// person has a target only through one.
		const fund = isHourlyMemberType(person.memberType.type)
			? person.memberType.expectedSecondsOverride
			: (person.memberType.expectedSecondsOverride ?? fundSeconds);
		const target = fund == null ? null : prorate(fund);
		return {
			userId: person.userId,
			name: person.name,
			email: person.email,
			memberType: person.memberType.type,
			workSeconds,
			timeOffSeconds,
			totalSeconds,
			targetSeconds: target,
			monthTargetSeconds: fund ?? null,
			deltaSeconds: target == null ? null : totalSeconds - target,
			status:
				target == null
					? null
					: trackingStatusFor(totalSeconds, target, tolerancePct),
		};
	});

	// Worst first: behind, then slightly behind, then on track, then the people
	// with no target — and the biggest shortfall at the top of each group.
	rows.sort((a, b) => {
		const ra = a.status == null ? 3 : STATUS_RANK[a.status];
		const rb = b.status == null ? 3 : STATUS_RANK[b.status];
		if (ra !== rb) return ra - rb;
		return (
			(a.deltaSeconds ?? 0) - (b.deltaSeconds ?? 0) ||
			a.name.localeCompare(b.name)
		);
	});

	return {
		year,
		month,
		asOf,
		complete,
		fundSeconds,
		workingDaysInMonth,
		workingDaysElapsed,
		targetSeconds,
		tolerancePct,
		rows,
	};
};

/** One period of a person's own targets — the week or the month — as the home
 *  page and the timesheet show it. */
export type PeriodTarget = {
	from: string;
	to: string;
	workingDays: number;
	/** Working days strictly before today — the same "elapsed" the Tracking
	 *  report counts — so a partly-worked today is never claimed early. */
	workingDaysElapsed: number;
	/** `workingDaysElapsed` plus today, when today is a working day. This is
	 *  the day count that goes with `targetThroughTodaySeconds`. */
	workingDaysThroughToday: number;
	/** The whole period's target, or null when no target applies. */
	targetSeconds: number | null;
	/** Where they should be by today, from the working days elapsed above. This
	 *  is the figure the verdict is read from. */
	targetSoFarSeconds: number | null;
	/** The goal the person reads: `targetSoFarSeconds` plus today's own
	 *  working day, or the same figure when today is a weekend or a public
	 *  holiday. On the first working day of a week this is one day, not 0.
	 *  The verdict does not read it, because the day in progress must not
	 *  count against anyone. */
	targetThroughTodaySeconds: number | null;
	workSeconds: number;
	timeOffSeconds: number;
	/** work + time off — everything in the period, booked days ahead included.
	 *  For the top figure and the "to go" line, which do count a day booked
	 *  off next week as hours the period already has. */
	totalSeconds: number;
	/** work + time off through today only — never a day after it. This, not
	 *  `totalSeconds`, is what the verdict and the gap are read from, so
	 *  booking time off ahead of today cannot make someone who is behind
	 *  today read as on track. */
	totalSoFarSeconds: number;
	status: TrackingStatus | null;
};

export type MyTargets = {
	today: string;
	/** What one working day is worth this month: the person's month target ÷
	 *  the month's working days — 8h with the official fund — or 8h flat when
	 *  no fund is set, so the week still has a yardstick. */
	daySeconds: number;
	tolerancePct: number;
	week: PeriodTarget;
	month: PeriodTarget;
};

const sumOf = (map: Map<string, number>, userId: string) =>
	map.get(userId) ?? 0;

export const complianceService = {
	/**
	 * The caller's own week and month against the rule — for the home page and
	 * the strip on the timesheet, so how much is missing is never more than one
	 * look away, and never a different verdict than the one their lead reads on
	 * Tracking. The month is the Tracking row for this one person; the week is
	 * the same rule on the org's week: working days × a day's worth, where
	 * you should be by today = the working days elapsed × the same — elapsed
	 * meaning working days strictly BEFORE today, the same count Tracking
	 * uses, so a partly-worked today is never claimed early. The verdict and
	 * the gap are read from work + time off through today only; a day booked
	 * off later in the period still shows in the period's total and its "to
	 * go" line, but cannot make someone behind today read as on track.
	 *
	 * Nobody outside the rule gets a target — an hourly person without an
	 * override, an overhead person, someone archived — but everybody gets
	 * their hours.
	 */
	myTargets: async (
		ctx: Ctx,
		opts: Pick<ComplianceOpts, "now"> = {},
	): Promise<MyTargets> => {
		const [tz, weekStartsOn] = await Promise.all([
			ctxTimezone(ctx),
			ctxWeekStartsOn(ctx),
		]);
		const today = dayKeyInTz(opts.now ?? new Date(), tz);
		const year = Number(today.slice(0, 4));
		const month = Number(today.slice(5, 7));
		const report = await computeTracking(
			ctx,
			{ year, month },
			{ now: opts.now, onlyUserIds: new Set([ctx.userId]) },
		);
		const me = report.rows[0] ?? null;
		const daySeconds =
			me?.monthTargetSeconds != null && report.workingDaysInMonth > 0
				? Math.round(
						me.monthTargetSeconds /
							report.workingDaysInMonth /
							QUARTER_HOUR_SECONDS,
					) * QUARTER_HOUR_SECONDS
				: WORKING_DAY_SECONDS;

		const weekFrom = startOfWeekKey(today, weekStartsOn);
		const weekTo = addDaysToKey(weekFrom, 6);
		// Strictly before today — the day before, so "through yesterday" is a
		// single range endpoint rather than a special case at either end.
		const yesterday = addDaysToKey(today, -1);
		const monthRange = monthBounds(year, month);
		const userIds = [ctx.userId];
		const [
			holidays,
			weekWork,
			weekOff,
			weekWorkSoFar,
			weekOffSoFar,
			monthWork,
			monthOff,
		] = await Promise.all([
			holidaysService.holidaySetForRange(ctx, weekFrom, weekTo),
			ledgerByUser(ctx, { from: weekFrom, to: weekTo }, "worked", {
				userIds,
			}),
			ledgerByUser(ctx, { from: weekFrom, to: weekTo }, "absence", {
				userIds,
			}),
			// Through today only — the range the verdict is read from, so a day
			// booked off later in the same week cannot flatter it.
			ledgerByUser(ctx, { from: weekFrom, to: today }, "worked", {
				userIds,
			}),
			ledgerByUser(ctx, { from: weekFrom, to: today }, "absence", {
				userIds,
			}),
			// The whole month, booked days ahead included — for the top figure
			// and the "to go" line only. The verdict below reads the Tracking
			// row's own total instead, which already stops at today.
			ledgerByUser(ctx, monthRange, "worked", { userIds }),
			ledgerByUser(ctx, monthRange, "absence", { userIds }),
		]);

		// The week has a yardstick whenever the rule applies to the person —
		// even without a fund set, at 8h a day; an hourly person without an
		// override has none.
		const weekApplies =
			me != null &&
			(!isHourlyMemberType(me.memberType) || me.monthTargetSeconds != null);
		const weekDays = workingDaysIn(weekFrom, weekTo, holidays);
		const weekElapsed = workingDaysIn(weekFrom, yesterday, holidays);
		const weekTarget = weekApplies ? weekDays * daySeconds : null;
		const weekSoFar = weekApplies ? weekElapsed * daySeconds : null;
		// Today is always inside the week, so the week's own holidays say
		// whether today is a working day.
		const todayWorks = workingDaysIn(today, today, holidays);
		const weekThroughToday = weekApplies
			? (weekElapsed + todayWorks) * daySeconds
			: null;
		const weekTotal = sumOf(weekWork, ctx.userId) + sumOf(weekOff, ctx.userId);
		const weekTotalSoFar =
			sumOf(weekWorkSoFar, ctx.userId) + sumOf(weekOffSoFar, ctx.userId);
		const monthTotal =
			sumOf(monthWork, ctx.userId) + sumOf(monthOff, ctx.userId);
		// The Tracking row's own total already stops at today (or the month's
		// last day once it is over) — reusing it instead of a second month
		// query is what keeps this verdict from ever disagreeing with
		// Tracking's, and it inherits any later change to what "today" means
		// there for free.
		const monthTotalSoFar = me?.totalSeconds ?? monthTotal;

		return {
			today,
			daySeconds,
			tolerancePct: report.tolerancePct,
			week: {
				from: weekFrom,
				to: weekTo,
				workingDays: weekDays,
				workingDaysElapsed: weekElapsed,
				workingDaysThroughToday: weekElapsed + todayWorks,
				targetSeconds: weekTarget,
				targetSoFarSeconds: weekSoFar,
				targetThroughTodaySeconds: weekThroughToday,
				workSeconds: sumOf(weekWork, ctx.userId),
				timeOffSeconds: sumOf(weekOff, ctx.userId),
				totalSeconds: weekTotal,
				totalSoFarSeconds: weekTotalSoFar,
				status:
					weekSoFar == null
						? null
						: trackingStatusFor(weekTotalSoFar, weekSoFar, report.tolerancePct),
			},
			month: {
				from: monthRange.from,
				to: monthRange.to,
				workingDays: report.workingDaysInMonth,
				workingDaysElapsed: report.workingDaysElapsed,
				workingDaysThroughToday: report.workingDaysElapsed + todayWorks,
				targetSeconds: me?.monthTargetSeconds ?? null,
				targetSoFarSeconds: me?.targetSeconds ?? null,
				targetThroughTodaySeconds:
					me?.monthTargetSeconds == null
						? null
						: prorateFund(
								me.monthTargetSeconds,
								report.workingDaysElapsed + todayWorks,
								report.workingDaysInMonth,
							),
				workSeconds: sumOf(monthWork, ctx.userId),
				timeOffSeconds: sumOf(monthOff, ctx.userId),
				totalSeconds: monthTotal,
				totalSoFarSeconds: monthTotalSoFar,
				status:
					me?.targetSeconds == null
						? null
						: trackingStatusFor(
								monthTotalSoFar,
								me.targetSeconds,
								report.tolerancePct,
							),
			},
		};
	},

	/** The Tracking report for a month, scoped by people (§4 matrix): everyone
	 *  for Admin; for anyone else themselves, the people on their list and
	 *  everyone on the projects they manage. A Member sees one row — their own. */
	tracking: async (
		ctx: Ctx,
		input: MonthReportInput,
		opts: ComplianceOpts = {},
	): Promise<TrackingReport> => {
		const access = await ctxAccess(ctx);
		const onlyUserIds = await accessService.peopleScope(ctx, access);
		return computeTracking(ctx, input, { ...opts, onlyUserIds });
	},

	/**
	 * The same report for the scheduled reminder jobs, which run it for a whole
	 * organization on nobody's behalf.
	 *
	 * There is no caller to check: the job builds an org-only Ctx with an empty
	 * `userId` (`jobs/slack-reminders.ts`), because the question it is asking is
	 * about the whole organization and nobody in particular asked it. That Ctx
	 * cannot satisfy any access check, which is precisely why the unchecked
	 * path needs a name of its own instead of a flag: being this caller
	 * requires saying so at the call site.
	 *
	 * Do not wire this to a server function or a REST route.
	 */
	trackingForReminderJob: (
		ctx: Ctx,
		input: MonthReportInput,
		opts: ComplianceOpts = {},
	): Promise<TrackingReport> => computeTracking(ctx, input, opts),

	/**
	 * The people the tracking machinery applies to — no overhead, no archived —
	 * for the same job, on the same terms as `trackingForReminderJob` above.
	 *
	 * It exists because the month-end Slack push addresses this exact set and was
	 * selecting every member of the org instead, so the message went to precisely
	 * the two groups the cohort exists to exclude: archived people, who cannot act
	 * on it, and overhead employees, whom the system deliberately never nags about
	 * timesheets.
	 *
	 * Do not wire this to a server function or a REST route.
	 */
	cohortForReminderJob: (
		ctx: Ctx,
		asOfMonth: { year: number; month: number },
	): Promise<CohortMember[]> => complianceCohort(ctx, asOfMonth),
};
