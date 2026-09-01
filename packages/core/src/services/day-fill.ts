import { and, eq } from "drizzle-orm";

import { timeEntry } from "../db/schema/domain";
import {
	type HolidayLookup,
	remainingSeconds,
	spokenForSeconds,
	targetSecondsFor,
	type WorkingHoursDay,
} from "../lib/working-day";
import { ctxDb } from "./db-ctx";
import { holidaysService } from "./holidays.service";
import type { Ctx } from "./types";
import { workingHoursService } from "./working-hours.service";

// The day's fill block: how long it should be, and keeping it that length.
//
// In its own module, like `guards.ts` and `unfiled.ts`, and for the same
// reason: `time-entries.service` and `recurring-block-rules.service` both need
// it and the former already imports the latter, so leaving it on either one
// makes the pair circular.
//
// The rule it implements is stated in `lib/working-day`. This only fetches what
// that arithmetic needs.

/**
 * How long a fill block on this day should be: the day's working-hours target
 * minus every other (non-fill) entry that day, floored at 0.
 *
 * Reads through `ctxDb(ctx)` rather than taking a client parameter: inside
 * `withCtxTx` that IS the transaction, so a caller cannot accidentally recompute
 * a day on the ambient pool after its own transaction has committed — which is
 * exactly what remove, setWeekCell and copyDay used to do.
 *
 * `holidays` is fetched here when the caller doesn't supply it, so a single
 * write pays one memoized lookup; a caller working over a RANGE (the commit
 * engine, listRange) should fetch once and pass it in rather than per day.
 */
export const computeDayFillSeconds = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
	opts: {
		workingHours?: WorkingHoursDay[];
		holidays?: HolidayLookup;
		/** Entry to leave out of the claims — the one being converted INTO the
		 *  fill block, which would otherwise be counted as competing with itself. */
		excludeEntryId?: string;
	} = {},
): Promise<number> => {
	const [dayEntries, hours, holidays] = await Promise.all([
		ctxDb(ctx).query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, dateKey),
			),
			columns: { id: true, durationSeconds: true, fillsDay: true },
		}),
		opts.workingHours ?? workingHoursService.list(ctx),
		opts.holidays ?? holidaysService.holidaySetForRange(ctx, dateKey, dateKey),
	]);
	return remainingSeconds(
		targetSecondsFor(hours, dateKey, tz, holidays),
		spokenForSeconds(dayEntries.filter((e) => e.id !== opts.excludeEntryId)),
	);
};

/**
 * Re-derive the duration of the day's fill block (if any) after a sibling entry
 * changed. No-op when the day has no fill block.
 *
 * A fill block that recomputes to ZERO is DELETED, not stored at 0. The day's
 * working hours are already spoken for, so what it now describes is "nothing" —
 * and `remainingSeconds` floors at 0, so the row can never come back on its own
 * while the day stays full. Keeping it left a literal `0:00 — rest of day` row
 * sitting in the Day view after any bulk write that filled the day (copyDay,
 * day assembly), which is what people reported as "it adds items with 0 time".
 * The DB CHECK still permits `fills_day = true and duration_seconds >= 0`; this
 * is the layer that decides a zero-length block is not worth keeping.
 *
 * This is the WRITE path, and it is deliberately not bounded by the automation
 * window: it runs because a person did something, and people may edit their own
 * entries in closed months on purpose. `listRange`'s read-path recompute is the
 * one that has to be bounded, because nobody asked for it.
 */
export const recomputeDayFill = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
) => {
	const client = ctxDb(ctx);
	const fill = await client.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.userId, ctx.userId),
			eq(timeEntry.date, dateKey),
			eq(timeEntry.fillsDay, true),
		),
		columns: { id: true, durationSeconds: true },
	});
	if (!fill) return;
	const next = await computeDayFillSeconds(ctx, dateKey, tz);
	if (next === 0) {
		await client.delete(timeEntry).where(eq(timeEntry.id, fill.id));
		return;
	}
	if (next === fill.durationSeconds) return;
	await client
		.update(timeEntry)
		.set({ durationSeconds: next, updatedAt: new Date() })
		.where(eq(timeEntry.id, fill.id));
};
