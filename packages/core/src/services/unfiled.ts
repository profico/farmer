import { count, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { task, timeEntry } from "../db/schema/domain";
import { ctxDb } from "./db-ctx";
import { ledgerWhere } from "./ledger";
import type { Ctx } from "./types";

// An UNFILED entry is real tracked time that carries no project yet: a Google
// Calendar meeting the sync imported, a commit-derived work-time fill block, a
// day-assembly suggestion the user accepted. All three engines write
// `projectId: null` directly, and the taxonomy guard now admits the shape (see
// assertTaskAvailable) instead of rejecting a row the app itself produces.
//
// Absence is explicitly NOT unfiled. Vacation and Sick Leave carry no project by
// definition and are complete as they stand; lumping them in would report every
// holiday as an outstanding to-do.
//
// This lives in its own module, like `guards.ts`, because reports, close and
// time-entries all need the same definition and importing one of those services
// from another would make the set circular.

// The predicate itself now lives in `ledger.ts` as the `unfiled` scope, so the
// definition this module was created to hold is stated in the same place as its
// siblings (`worked`, `project`, `absence`) and cannot drift from them.
const unfiledWhere = (
	ctx: Ctx,
	range: { from: string; to: string },
	userId?: string,
) => ledgerWhere(ctx, range, "unfiled", userId ? { userId } : {});

/** Count and total duration of unfiled time in a range, optionally for one
 *  person. Used for the time page's nag. */
export const unfiledTotals = async (
	ctx: Ctx,
	range: { from: string; to: string },
	userId?: string,
): Promise<{ count: number; seconds: number }> => {
	const [row] = await db
		.select({
			count: count(),
			seconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
		})
		.from(timeEntry)
		.innerJoin(task, eq(timeEntry.taskId, task.id))
		.where(unfiledWhere(ctx, range, userId));
	return { count: row?.count ?? 0, seconds: Number(row?.seconds ?? 0) };
};

/** Per-person unfiled totals for a range, keyed by userId, to name who is
 *  sitting on unfiled time rather than just that someone is. */
export const unfiledByUser = async (
	ctx: Ctx,
	range: { from: string; to: string },
): Promise<Map<string, { count: number; seconds: number }>> => {
	// `ctxDb`: callers may run this inside a transaction, so the read and the
	// write see the same connection.
	const rows = await ctxDb(ctx)
		.select({
			userId: timeEntry.userId,
			count: count(),
			seconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
		})
		.from(timeEntry)
		.innerJoin(task, eq(timeEntry.taskId, task.id))
		.where(unfiledWhere(ctx, range))
		.groupBy(timeEntry.userId);
	return new Map(
		rows.map((r) => [r.userId, { count: r.count, seconds: Number(r.seconds) }]),
	);
};

/** The caller's own unfiled entries, oldest first — the worklist behind the
 *  time page's "N unfiled" affordance. */
export const listUnfiledForUser = async (
	ctx: Ctx,
	range: { from: string; to: string },
) =>
	db
		.select({
			id: timeEntry.id,
			date: timeEntry.date,
			description: timeEntry.description,
			durationSeconds: timeEntry.durationSeconds,
			taskId: timeEntry.taskId,
			taskName: task.name,
			meetingUrl: timeEntry.meetingUrl,
		})
		.from(timeEntry)
		.innerJoin(task, eq(timeEntry.taskId, task.id))
		.where(unfiledWhere(ctx, range, ctx.userId))
		.orderBy(timeEntry.date);
