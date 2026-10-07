// What the person took off an entry, and the engine must not put back.
//
// `githubService.detachCommit` and `detachPullRequestActivity` delete an
// attachment row. The commit engine re-reads every day in its window and
// inserts the evidence again, so a row that only disappears comes back. These
// helpers write, read, clear and prune the two tombstones that stop it. The
// tables are in `db/schema/settings.ts`, with the reasons for their keys.
//
// The key is the person and the commit (or event), not the entry. A manual
// attach clears the tombstone. A row older than the automation window is dead,
// because the engine never reads that day, so the engine prunes it.

import { and, eq, inArray, lt } from "drizzle-orm";

import {
	commitDetachTombstone,
	pullRequestEventDetachTombstone,
} from "../db/schema/settings";
import { AUTOMATION_GRACE_DAYS } from "../lib/automation-window";
import { addDaysToKey } from "../lib/time";
import { ctxDb } from "./db-ctx";
import type { Ctx } from "./types";

/** Record that the person said no to these commits. */
export const refuseCommits = async (
	ctx: Ctx,
	commits: { sha: string; date: string }[],
): Promise<void> => {
	if (commits.length === 0) return;
	await ctxDb(ctx)
		.insert(commitDetachTombstone)
		.values(
			commits.map(({ sha, date }) => ({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				sha,
				date,
			})),
		)
		.onConflictDoNothing();
};

/** Record that the person said no to these pull request events. */
export const refuseEvents = async (
	ctx: Ctx,
	events: { eventId: string; date: string }[],
): Promise<void> => {
	if (events.length === 0) return;
	await ctxDb(ctx)
		.insert(pullRequestEventDetachTombstone)
		.values(
			events.map(({ eventId, date }) => ({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				eventId,
				date,
			})),
		)
		.onConflictDoNothing();
};

/** A manual attach is a new decision: take the "no" back for these commits. */
export const allowCommits = async (ctx: Ctx, shas: string[]): Promise<void> => {
	if (shas.length === 0) return;
	await ctxDb(ctx)
		.delete(commitDetachTombstone)
		.where(
			and(
				eq(commitDetachTombstone.organizationId, ctx.organizationId),
				eq(commitDetachTombstone.userId, ctx.userId),
				inArray(commitDetachTombstone.sha, shas),
			),
		);
};

/** The same, for pull request events. */
export const allowEvents = async (
	ctx: Ctx,
	eventIds: string[],
): Promise<void> => {
	if (eventIds.length === 0) return;
	await ctxDb(ctx)
		.delete(pullRequestEventDetachTombstone)
		.where(
			and(
				eq(pullRequestEventDetachTombstone.organizationId, ctx.organizationId),
				eq(pullRequestEventDetachTombstone.userId, ctx.userId),
				inArray(pullRequestEventDetachTombstone.eventId, eventIds),
			),
		);
};

/** Which of these commits did the person detach? */
export const refusedCommitShas = async (
	ctx: Ctx,
	shas: string[],
): Promise<Set<string>> => {
	if (shas.length === 0) return new Set();
	const rows = await ctxDb(ctx)
		.select({ sha: commitDetachTombstone.sha })
		.from(commitDetachTombstone)
		.where(
			and(
				eq(commitDetachTombstone.organizationId, ctx.organizationId),
				eq(commitDetachTombstone.userId, ctx.userId),
				inArray(commitDetachTombstone.sha, shas),
			),
		);
	return new Set(rows.map((row) => row.sha));
};

/** Which of these pull request events did the person detach? */
export const refusedEventIds = async (
	ctx: Ctx,
	eventIds: string[],
): Promise<Set<string>> => {
	if (eventIds.length === 0) return new Set();
	const rows = await ctxDb(ctx)
		.select({ eventId: pullRequestEventDetachTombstone.eventId })
		.from(pullRequestEventDetachTombstone)
		.where(
			and(
				eq(pullRequestEventDetachTombstone.organizationId, ctx.organizationId),
				eq(pullRequestEventDetachTombstone.userId, ctx.userId),
				inArray(pullRequestEventDetachTombstone.eventId, eventIds),
			),
		);
	return new Set(rows.map((row) => row.eventId));
};

/**
 * Delete the person's tombstones for days the engine can no longer reach.
 *
 * `rangeTo` is the last day of the pass: today, or yesterday for the commit
 * engine. The window never reaches back more than `AUTOMATION_GRACE_DAYS` from
 * today, so one more day of margin keeps every tombstone the engine can still
 * need.
 */
export const pruneDetachTombstones = async (
	ctx: Ctx,
	rangeTo: string,
): Promise<void> => {
	const cutoff = addDaysToKey(rangeTo, -(AUTOMATION_GRACE_DAYS + 1));
	const db = ctxDb(ctx);
	await db
		.delete(commitDetachTombstone)
		.where(
			and(
				eq(commitDetachTombstone.organizationId, ctx.organizationId),
				eq(commitDetachTombstone.userId, ctx.userId),
				lt(commitDetachTombstone.date, cutoff),
			),
		);
	await db
		.delete(pullRequestEventDetachTombstone)
		.where(
			and(
				eq(pullRequestEventDetachTombstone.organizationId, ctx.organizationId),
				eq(pullRequestEventDetachTombstone.userId, ctx.userId),
				lt(pullRequestEventDetachTombstone.date, cutoff),
			),
		);
};
