import { eq, sql } from "drizzle-orm";

import { task, timeEntry } from "../db/schema/domain";
import { ctxDb } from "./context";
import { WORKING_DAY_SECONDS } from "./hour-fund.service";
import { ledgerWhere } from "./ledger";
import type { ResolvedMemberType } from "./members.service";
import type { Ctx } from "./types";

// Expected hours: the one definition of how much a person was supposed to
// deliver in a month, shared by the compliance report and the reminder jobs.
// It used to live beside the month-end close sheet, which read the same figure;
// the sheet is gone and the formula is not.

/**
 * Absence days per person for the range, derived from their Vacation/Sick
 * entries across the whole org (absence has no project, so it is the same
 * number wherever the person appears).
 */
export const absenceDaysByUser = async (
	ctx: Ctx,
	from: string,
	to: string,
): Promise<Map<string, number>> => {
	const rows = await ctxDb(ctx)
		.select({
			userId: timeEntry.userId,
			total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
		})
		.from(timeEntry)
		.innerJoin(task, eq(timeEntry.taskId, task.id))
		.where(ledgerWhere(ctx, { from, to }, "absence"))
		.groupBy(timeEntry.userId);

	return new Map(
		rows.map((r) => [r.userId, Number(r.total) / WORKING_DAY_SECONDS]),
	);
};

/**
 * Expected hours for one person in a month:
 *
 *     Expected = monthly fund - (absence days x 8)
 *
 * Null — meaning "no Expected math applies" — when the person is a contractor
 * without an explicit override, or the admin hasn't entered the month's fund
 * yet. Never silently defaults: without a fund there is no number to reconcile
 * against, and inventing one would be worse than showing a blank.
 */
export const expectedSecondsFor = (
	memberType: ResolvedMemberType,
	fundSeconds: number | null,
	absenceDays: number,
): number | null => {
	const base =
		memberType.type === "contractor"
			? memberType.expectedSecondsOverride
			: (memberType.expectedSecondsOverride ?? fundSeconds);
	if (base == null) return null;
	return Math.max(0, base - Math.round(absenceDays * WORKING_DAY_SECONDS));
};
