import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { memberWorkingHoursDay } from "../db/schema/schedule";
// The schedule arithmetic lives in lib/working-day (pure); this service owns
// the reads and writes. Re-exported here because callers that already depend on
// this service for the rows shouldn't need a second import for the maths.
import { defaultDayRow, type WorkingHoursDay } from "../lib/working-day";
import type { UpsertWorkingHoursDayInput } from "../schema/working-hours";
import { ctxDb } from "./context";
import type { Ctx } from "./types";

export { dayDurationSeconds, type WorkingHoursDay } from "../lib/working-day";

export const workingHoursService = {
	// Always returns all 7 days (0=Sun..6=Sat) for the requesting user.
	//
	// Reads through `ctxDb(ctx)`, not the ambient handle: the fill-block
	// arithmetic calls this from inside `withCtxTx`, and a query issued on the
	// pool from within a transaction is at best reading pre-transaction state —
	// and on a single-connection handle (PGLite, which is what the tests run on)
	// it deadlocks outright, because the transaction is waiting on a query that
	// is queued behind the transaction.
	list: async (ctx: Ctx): Promise<WorkingHoursDay[]> => {
		const rows = await ctxDb(ctx).query.memberWorkingHoursDay.findMany({
			where: and(
				eq(memberWorkingHoursDay.organizationId, ctx.organizationId),
				eq(memberWorkingHoursDay.userId, ctx.userId),
			),
		});

		const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));

		return Array.from({ length: 7 }, (_, dayOfWeek) => {
			const existing = byDay.get(dayOfWeek);

			return existing
				? {
						dayOfWeek: existing.dayOfWeek,
						enabled: existing.enabled,
						startTime: existing.startTime,
						endTime: existing.endTime,
					}
				: defaultDayRow(dayOfWeek);
		});
	},

	// Org-wide: every member's full 7-day schedule (defaults synthesized the
	// same way as `list`), keyed by userId — used by the utilization report.
	listForOrg: async (
		ctx: Ctx,
		userIds: string[],
	): Promise<Map<string, WorkingHoursDay[]>> => {
		const rows = await db.query.memberWorkingHoursDay.findMany({
			where: eq(memberWorkingHoursDay.organizationId, ctx.organizationId),
		});

		const byUser = new Map<string, Map<number, WorkingHoursDay>>();

		for (const r of rows) {
			if (!byUser.has(r.userId)) byUser.set(r.userId, new Map());
			byUser.get(r.userId)?.set(r.dayOfWeek, r);
		}

		const result = new Map<string, WorkingHoursDay[]>();

		for (const userId of userIds) {
			const byDay = byUser.get(userId);
			result.set(
				userId,
				Array.from(
					{ length: 7 },
					(_, dayOfWeek) => byDay?.get(dayOfWeek) ?? defaultDayRow(dayOfWeek),
				),
			);
		}

		return result;
	},

	upsertDay: async (ctx: Ctx, input: UpsertWorkingHoursDayInput) => {
		const [row] = await db
			.insert(memberWorkingHoursDay)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				dayOfWeek: input.dayOfWeek,
				enabled: input.enabled,
				startTime: input.startTime ?? null,
				endTime: input.endTime ?? null,
			})
			.onConflictDoUpdate({
				target: [
					memberWorkingHoursDay.organizationId,
					memberWorkingHoursDay.userId,
					memberWorkingHoursDay.dayOfWeek,
				],
				set: {
					enabled: input.enabled,
					startTime: input.startTime ?? null,
					endTime: input.endTime ?? null,
					updatedAt: new Date(),
				},
			})
			.returning();

		if (!row) throw new Error("Failed to save working hours");

		return row;
	},
};
