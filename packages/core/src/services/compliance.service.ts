import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, user } from "../db/schema/auth";
import {
	datesBetween,
	dayKeyInTz,
	monthBounds,
	QUARTER_HOUR_SECONDS,
} from "../lib/time";
import { isHourlyMemberType } from "../schema/members";
import type { MonthReportInput } from "../schema/reports";
import { accessService } from "./access.service";
import { ctxAccess, ctxTimezone } from "./context";
import { holidaysService } from "./holidays.service";
import { hourFundService } from "./hour-fund.service";
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
	const workingDaysElapsed =
		today < from ? 0 : workingDaysIn(from, asOf, holidays);
	const share =
		workingDaysInMonth === 0 ? 0 : workingDaysElapsed / workingDaysInMonth;
	// To the nearest quarter hour, the unit every other figure in the app is
	// in. With the official fund this is a whole number of 8h days; it only
	// rounds when an admin entered a fund that is not a multiple of the days.
	const prorate = (fund: number) =>
		Math.round((fund * share) / QUARTER_HOUR_SECONDS) * QUARTER_HOUR_SECONDS;

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

export const complianceService = {
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
