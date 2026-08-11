import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { monthlyHourFund } from "../db/schema/settings";
import { datesBetween, endOfMonthKey } from "../lib/time";
import type { SetMonthlyHourFundInput } from "../schema/hour-fund";
import { requireAdmin } from "./context";
import { holidaysService } from "./holidays.service";
import type { Ctx } from "./types";

// A standard Croatian working day. Also the divisor the PRD's Expected formula
// uses to convert absence days into hours:
//   Expected = monthly fund - (absence days x 8)
export const WORKING_DAY_SECONDS = 8 * 3600;

export const monthKeyOf = (year: number, month: number) =>
	`${year}-${String(month).padStart(2, "0")}-01`;

export const hourFundService = {
	/** The fund for one month, or null when the admin hasn't entered it yet.
	 *  Null is meaningful and must NOT be coerced to a default: without a fund
	 *  there is no Expected value, so the close sheet shows blank rather than
	 *  inventing a number to reconcile against. */
	get: async (ctx: Ctx, year: number, month: number): Promise<number | null> => {
		const row = await db.query.monthlyHourFund.findFirst({
			where: and(
				eq(monthlyHourFund.organizationId, ctx.organizationId),
				eq(monthlyHourFund.year, year),
				eq(monthlyHourFund.month, month),
			),
			columns: { fundSeconds: true },
		});
		return row?.fundSeconds ?? null;
	},

	listForYear: async (ctx: Ctx, year: number) =>
		db.query.monthlyHourFund.findMany({
			where: and(
				eq(monthlyHourFund.organizationId, ctx.organizationId),
				eq(monthlyHourFund.year, year),
			),
			orderBy: asc(monthlyHourFund.month),
		}),

	set: async (ctx: Ctx, input: SetMonthlyHourFundInput) => {
		await requireAdmin(ctx);
		await db
			.insert(monthlyHourFund)
			.values({
				organizationId: ctx.organizationId,
				year: input.year,
				month: input.month,
				fundSeconds: input.fundSeconds,
			})
			.onConflictDoUpdate({
				target: [
					monthlyHourFund.organizationId,
					monthlyHourFund.year,
					monthlyHourFund.month,
				],
				set: { fundSeconds: input.fundSeconds, updatedAt: new Date() },
			});
	},

	/** Remove a month's fund entirely, returning it to "not entered yet".
	 *
	 *  Distinct from setting it to zero, and the difference is the whole point of
	 *  the column being nullable: a zero fund is a real claim (nobody is expected
	 *  to work this month) that the close sheet reconciles against, while no row
	 *  means there is no Expected figure to reconcile at all. It is also the only
	 *  way to un-stick `prefillYear`, which skips any month that already has a
	 *  row — without this, one wrong figure was permanent. */
	clear: async (ctx: Ctx, year: number, month: number) => {
		await requireAdmin(ctx);
		await db
			.delete(monthlyHourFund)
			.where(
				and(
					eq(monthlyHourFund.organizationId, ctx.organizationId),
					eq(monthlyHourFund.year, year),
					eq(monthlyHourFund.month, month),
				),
			);
	},

	/** Compute what a month's fund SHOULD be from the official holiday calendar:
	 *  Mon-Fri days that aren't public holidays, times 8h. This is roadmap item 5
	 *  — the number an admin currently looks up by hand on isplate.info.
	 *
	 *  Returned as a suggestion, never written automatically: the legal fund can
	 *  diverge from the naive calculation, so an admin confirms (or overrides) it. */
	suggestForMonth: async (
		ctx: Ctx,
		year: number,
		month: number,
	): Promise<{ workingDays: number; fundSeconds: number }> => {
		const first = monthKeyOf(year, month);
		const last = endOfMonthKey(first);
		const holidays = await holidaysService.holidaySetForRange(ctx, first, last);

		const workingDays = datesBetween(first, last).filter((key) => {
			if (holidays.has(key)) return false;
			// UTC weekday of a bare calendar key — no timezone involved, the key IS
			// the calendar day.
			const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
			return weekday !== 0 && weekday !== 6;
		}).length;

		return { workingDays, fundSeconds: workingDays * WORKING_DAY_SECONDS };
	},

	/** Prefill a whole year at once from the holiday calendar, skipping months an
	 *  admin has already set so a re-run never clobbers a hand-corrected figure. */
	prefillYear: async (ctx: Ctx, year: number) => {
		await requireAdmin(ctx);

		const existing = await hourFundService.listForYear(ctx, year);
		const known = new Set(existing.map((r) => r.month));

		const rows: { month: number; fundSeconds: number }[] = [];
		for (let month = 1; month <= 12; month++) {
			if (known.has(month)) continue;
			const { fundSeconds } = await hourFundService.suggestForMonth(
				ctx,
				year,
				month,
			);
			rows.push({ month, fundSeconds });
		}
		if (rows.length === 0) return { filled: 0 };

		await db.insert(monthlyHourFund).values(
			rows.map((r) => ({
				organizationId: ctx.organizationId,
				year,
				month: r.month,
				fundSeconds: r.fundSeconds,
			})),
		);
		return { filled: rows.length };
	},
};
