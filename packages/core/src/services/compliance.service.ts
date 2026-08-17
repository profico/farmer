import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { timeEntry } from "../db/schema/domain";
import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	monthBounds,
	startOfMonthKey,
} from "../lib/time";
import { absenceDaysByUser, expectedSecondsFor } from "./close.service";
import { ctxTimezone, requireAdmin } from "./context";
import { holidaysService } from "./holidays.service";
import { hourFundService } from "./hour-fund.service";
import { ledgerByUser } from "./ledger";
import { membersService, type ResolvedMemberType } from "./members.service";
import {
	BEHIND_PACE_THRESHOLD,
	orgSettingsService,
} from "./org-settings.service";
import type { Ctx } from "./types";

// Tracking compliance (PRD 6.2) — the forgetting-detector, and the engine behind
// the Slack reminders. One mechanism, two outputs: a dashboard for Admin and DMs
// for the person, so the two can never disagree about who is lagging.

export type NoEntriesRow = {
	userId: string;
	name: string;
	email: string;
	memberType: ResolvedMemberType["type"];
	/** The last day this person logged anything, or null if never. */
	lastEntryDate: string | null;
	/** How many working days they have gone without logging. */
	workingDaysMissing: number;
};

export type BehindPaceRow = {
	userId: string;
	name: string;
	email: string;
	memberType: ResolvedMemberType["type"];
	loggedSeconds: number;
	/** Expected-so-far: the month's Expected scaled by working days elapsed. */
	proratedExpectedSeconds: number;
	pacePct: number;
	shortfallSeconds: number;
};

/** Working days in [from, to]: Mon-Fri minus org holidays. */
const workingDaysIn = async (
	ctx: Ctx,
	from: string,
	to: string,
): Promise<string[]> => {
	if (from > to) return [];
	const holidays = await holidaysService.holidaySetForRange(ctx, from, to);
	return datesBetween(from, to).filter((key) => {
		if (holidays.has(key)) return false;
		const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
		return weekday !== 0 && weekday !== 6;
	});
};

/** People the compliance machinery applies to at all. Overhead people never
 *  appear anywhere in it — the system never nags the CEO about timesheets — and
 *  neither do archived people, who cannot act on a nudge at all. */
const complianceCohort = async (
	ctx: Ctx,
	asOfMonth: { year: number; month: number },
) => {
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
				type: "billable" as const,
				expectedSecondsOverride: null,
			},
		}))
		.filter((p) => p.memberType.type !== "overhead" && !archived.has(p.userId));
};

// The two views, computed without any authorization check.
//
// Deliberately module-private and deliberately not reachable through
// `complianceService`. These used to be the public methods, each taking a
// `{ skipAdminCheck?: boolean }` — an argument that switched authorization off,
// sitting in the public signature of the one service whose whole subject is
// org-wide data about people. One caller (the Slack reminder job) needed it and
// every other caller needed it never to be set; a flag cannot express that, and
// an options bag is exactly the shape that eventually gets spread from
// somewhere validated. The escape hatch is now a named export below that says
// out loud who it is for, and the flag no longer exists to be passed by
// accident.
const views = {
	/**
	 * View 1 — people with no entries in the last N working days (N configurable,
	 * default 3). Both Billable people and Contractors appear here: a contractor
	 * still has to tell us what they did, even though no hour fund applies to them.
	 */
	noEntries: async (ctx: Ctx) => {
		const [tz, settings] = await Promise.all([
			ctxTimezone(ctx),
			orgSettingsService.get(ctx),
		]);
		const today = dayKeyInTz(new Date(), tz);
		const cohort = await complianceCohort(ctx, {
			year: Number(today.slice(0, 4)),
			month: Number(today.slice(5, 7)),
		});
		if (cohort.length === 0) return [];

		// Look back far enough to always contain N working days even across a long
		// holiday stretch, then take the last N.
		const windowStart = addDaysToKey(
			today,
			-(settings.complianceMissingDays * 4 + 14),
		);
		const working = await workingDaysIn(ctx, windowStart, today);
		const recentWorkingDays = working.slice(-settings.complianceMissingDays);
		if (recentWorkingDays.length === 0) return [];
		const cutoff = recentWorkingDays[0] as string;

		const userIds = cohort.map((c) => c.userId);
		const [recent, lastEntries] = await Promise.all([
			db
				.select({ userId: timeEntry.userId })
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, ctx.organizationId),
						inArray(timeEntry.userId, userIds),
						gte(timeEntry.date, cutoff),
						lte(timeEntry.date, today),
					),
				)
				.groupBy(timeEntry.userId),
			db
				.select({
					userId: timeEntry.userId,
					lastDate: sql<string>`max(${timeEntry.date})`,
				})
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, ctx.organizationId),
						inArray(timeEntry.userId, userIds),
					),
				)
				.groupBy(timeEntry.userId),
		]);

		const hasRecent = new Set(recent.map((r) => r.userId));
		const lastByUser = new Map(lastEntries.map((r) => [r.userId, r.lastDate]));

		const rows: NoEntriesRow[] = [];
		for (const person of cohort) {
			if (hasRecent.has(person.userId)) continue;
			const lastEntryDate = lastByUser.get(person.userId) ?? null;
			const missing = lastEntryDate
				? working.filter((d) => d > lastEntryDate).length
				: working.length;
			rows.push({
				userId: person.userId,
				name: person.name,
				email: person.email,
				memberType: person.memberType.type,
				lastEntryDate,
				workingDaysMissing: missing,
			});
		}
		return rows.sort((a, b) => b.workingDaysMissing - a.workingDaysMissing);
	},

	/**
	 * View 2 — people whose month-to-date hours are below the prorated
	 * expectation, i.e. below ~90% of pace (the threshold is deliberately
	 * hardcoded, not a setting).
	 *
	 * Contractors appear here ONLY when they have an explicit expected-hours
	 * value: without a monthly fund there is no pace to be behind.
	 */
	behindPace: async (ctx: Ctx) => {
		const tz = await ctxTimezone(ctx);
		const today = dayKeyInTz(new Date(), tz);
		const year = Number(today.slice(0, 4));
		const month = Number(today.slice(5, 7));
		const { from, to } = monthBounds(year, month);

		const [cohort, fundSeconds, absence] = await Promise.all([
			complianceCohort(ctx, { year, month }),
			hourFundService.get(ctx, year, month),
			absenceDaysByUser(ctx, from, today),
		]);
		if (cohort.length === 0) return [];

		// Prorate by working days elapsed (inclusive of today) over the month's
		// total working days.
		const [elapsed, total] = await Promise.all([
			workingDaysIn(ctx, startOfMonthKey(today), today),
			workingDaysIn(ctx, from, to),
		]);
		if (total.length === 0 || elapsed.length === 0) return [];
		const elapsedFraction = elapsed.length / total.length;

		// Scope "worked", NOT "all". This query used to sum every entry in the
		// range with no absence exclusion, while `expectedSecondsFor` below
		// SUBTRACTS absence days from the target — so a person on vacation had
		// their expectation lowered AND their vacation counted as hours worked,
		// crediting it twice and hiding them from the pace check. Unfiled time
		// stays in: an imported meeting is work, it is just not attributed yet.
		const loggedByUser = await ledgerByUser(
			ctx,
			{ from, to: today },
			"worked",
			{ userIds: cohort.map((c) => c.userId) },
		);

		const rows: BehindPaceRow[] = [];
		for (const person of cohort) {
			const expected = expectedSecondsFor(
				person.memberType,
				fundSeconds,
				absence.get(person.userId) ?? 0,
			);
			// No fund (or a contractor with no override) => no pace to be behind.
			if (expected == null || expected <= 0) continue;

			const proratedExpectedSeconds = Math.round(expected * elapsedFraction);
			if (proratedExpectedSeconds <= 0) continue;

			const loggedSeconds = loggedByUser.get(person.userId) ?? 0;
			const pace = loggedSeconds / proratedExpectedSeconds;
			if (pace >= BEHIND_PACE_THRESHOLD) continue;

			rows.push({
				userId: person.userId,
				name: person.name,
				email: person.email,
				memberType: person.memberType.type,
				loggedSeconds,
				proratedExpectedSeconds,
				pacePct: Math.round(pace * 100),
				shortfallSeconds: proratedExpectedSeconds - loggedSeconds,
			});
		}
		return rows.sort((a, b) => a.pacePct - b.pacePct);
	},

	/** Both views at once — the Admin dashboard, and the input the Slack job
	 *  iterates to decide who gets a DM. */
	dashboard: async (ctx: Ctx) => {
		const [noEntries, behindPace] = await Promise.all([
			views.noEntries(ctx),
			views.behindPace(ctx),
		]);
		return { noEntries, behindPace };
	},
};

export const complianceService = {
	noEntries: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		return views.noEntries(ctx);
	},

	behindPace: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		return views.behindPace(ctx);
	},

	dashboard: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		return views.dashboard(ctx);
	},

	/**
	 * The dashboard for the scheduled Slack reminder job, which runs it for a
	 * whole organization on nobody's behalf.
	 *
	 * There is no caller to check: the job builds an org-only Ctx with an empty
	 * `userId` (`jobs/slack-reminders.ts`), because the question it is asking is
	 * about the whole organization and nobody in particular asked it. That Ctx
	 * cannot satisfy an Admin check, or any other check, which is precisely why
	 * the unchecked path needs a name of its own instead of a flag: being this
	 * caller requires saying so at the call site.
	 *
	 * Do not wire this to a server function or a REST route.
	 */
	dashboardForReminderJob: (ctx: Ctx) => views.dashboard(ctx),
};
