import { and, asc, eq, inArray } from "drizzle-orm";

import { task, timeEntry } from "../db/schema/domain";
import { projectGithubRepo, timeEntryGithubCommit } from "../db/schema/github";
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
 * Before a squeezed-out fill block is dropped, move its commits to the entry
 * the commit engine would have chosen had the block never existed: that
 * project's own Development entry on the day, else a project-less one.
 *
 * The attachments cascade with the row, and the engine does not bring them
 * back on its own — it only revisits days inside its window, and even there it
 * files a block only when the day has room, which is exactly what this day no
 * longer has. So dropping the block silently dropped the day's evidence.
 *
 * Both places that drop an emptied block call this — `recomputeDayFill` below,
 * on every write path, and `listRange`'s read-path recompute — so the two
 * cannot disagree about where the evidence goes.
 *
 * Deliberately no tombstone. A tombstone records a person saying no; here the
 * block went because the day filled up, and a tombstone would stop the engine
 * filing one on this day even after the day empties again.
 *
 * A commit with no such entry is still lost with the block. The day was filled
 * by something that is not development work (meetings, absence), and attaching
 * a commit to a meeting would be a claim the commit does not make.
 *
 * Reads and writes through `ctxDb(ctx)`: `recomputeDayFill` runs inside the
 * caller's transaction, and an ambient query from there deadlocks.
 */
export const rehomeDroppedFillCommits = async (
	ctx: Ctx,
	dropped: { id: string; date: string }[],
) => {
	if (dropped.length === 0) return;
	const client = ctxDb(ctx);
	const attached = await client
		.select({
			timeEntryId: timeEntryGithubCommit.timeEntryId,
			projectGithubRepoId: timeEntryGithubCommit.projectGithubRepoId,
			sha: timeEntryGithubCommit.sha,
			message: timeEntryGithubCommit.message,
			authorLogin: timeEntryGithubCommit.authorLogin,
			committedAt: timeEntryGithubCommit.committedAt,
			url: timeEntryGithubCommit.url,
			projectId: projectGithubRepo.projectId,
		})
		.from(timeEntryGithubCommit)
		.leftJoin(
			projectGithubRepo,
			eq(projectGithubRepo.id, timeEntryGithubCommit.projectGithubRepoId),
		)
		.where(
			inArray(
				timeEntryGithubCommit.timeEntryId,
				dropped.map((fill) => fill.id),
			),
		);
	if (attached.length === 0) return;

	// The same candidates the commit engine considers: Development entries that
	// are not themselves a fill block, found by system key rather than by name.
	const work = await client
		.select({
			id: timeEntry.id,
			date: timeEntry.date,
			projectId: timeEntry.projectId,
		})
		.from(timeEntry)
		.innerJoin(task, eq(task.id, timeEntry.taskId))
		.where(
			and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				inArray(timeEntry.date, [...new Set(dropped.map((f) => f.date))]),
				eq(timeEntry.fillsDay, false),
				eq(task.systemKey, "development"),
			),
		)
		.orderBy(asc(timeEntry.createdAt));

	const dateOf = new Map(dropped.map((fill) => [fill.id, fill.date]));
	const moved: (typeof timeEntryGithubCommit.$inferInsert)[] = [];
	for (const { timeEntryId, projectId, ...commit } of attached) {
		const onDay = work.filter((row) => row.date === dateOf.get(timeEntryId));
		const target =
			(projectId ? onDay.find((row) => row.projectId === projectId) : null) ??
			onDay.find((row) => row.projectId === null);
		if (!target) continue;
		moved.push({ ...commit, timeEntryId: target.id });
	}
	if (moved.length === 0) return;
	// tegc_entry_sha_unq: the target may already hold the same commit.
	await client
		.insert(timeEntryGithubCommit)
		.values(moved)
		.onConflictDoNothing();
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
		// Its commits would cascade with it. See `rehomeDroppedFillCommits`.
		await rehomeDroppedFillCommits(ctx, [{ id: fill.id, date: dateKey }]);
		await client.delete(timeEntry).where(eq(timeEntry.id, fill.id));
		return;
	}
	if (next === fill.durationSeconds) return;
	await client
		.update(timeEntry)
		.set({ durationSeconds: next, updatedAt: new Date() })
		.where(eq(timeEntry.id, fill.id));
};
