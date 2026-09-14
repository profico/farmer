import { and, asc, eq } from "drizzle-orm";

import { task, timeEntry } from "../db/schema/domain";
import { timeEntryGithubPrActivity } from "../db/schema/github";
import { pullRequestReviewTombstone } from "../db/schema/settings";
import { ctxDb } from "./db-ctx";
import type { Ctx } from "./types";

// A reviewed pull request as a block of its own, under the Code Review task.
//
// Reviews started as evidence only, attached to the day's Development work like
// commits. That recorded the review and hid its time: a morning spent reviewing
// three PRs read as a Development day. So the commit engine files one block per
// reviewed PR per day, and the day assembler proposes the same block.
//
// In its own module because both of them need the same three answers — which
// entry already holds a PR's reviews, which review blocks were deleted, and
// what deleting an entry says no to — and `day-assembly.service` imports
// `time-entries.service`, so neither can own them.
//
// A review has a moment and no length: GitHub records when it was submitted,
// not how long it took. The block is a fixed estimate the person edits, taken
// from the day's free time (the rest-of-day block shrinks by the same amount)
// and never added on top of a day that is already full.

export const REVIEW_BLOCK_SECONDS = 30 * 60;

export const reviewBlockDescription = (title: string) => `PR review: ${title}`;

/**
 * The entry that already holds each reviewed pull request's reviews on the day,
 * keyed by the PR's URL.
 *
 * Any entry counts, not only a Code Review one. A day synced before review
 * blocks existed has its reviews on a Development entry or the rest-of-day
 * block, and the engine must not add a second half hour to a day it already
 * filed. The oldest attachment wins, so the answer is stable across runs.
 */
export const reviewHomesOnDay = async (
	ctx: Ctx,
	date: string,
): Promise<Map<string, string>> => {
	const rows = await ctxDb(ctx)
		.select({
			pullRequestUrl: timeEntryGithubPrActivity.pullRequestUrl,
			timeEntryId: timeEntryGithubPrActivity.timeEntryId,
		})
		.from(timeEntryGithubPrActivity)
		.innerJoin(
			timeEntry,
			eq(timeEntry.id, timeEntryGithubPrActivity.timeEntryId),
		)
		.where(
			and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, date),
				eq(timeEntryGithubPrActivity.kind, "reviewed"),
			),
		)
		.orderBy(asc(timeEntryGithubPrActivity.createdAt));
	const homes = new Map<string, string>();
	for (const row of rows) {
		if (!homes.has(row.pullRequestUrl)) {
			homes.set(row.pullRequestUrl, row.timeEntryId);
		}
	}
	return homes;
};

/** The pull requests whose review block the person deleted on this day. */
export const deletedReviewsOnDay = async (
	ctx: Ctx,
	date: string,
): Promise<Set<string>> => {
	const rows = await ctxDb(ctx).query.pullRequestReviewTombstone.findMany({
		where: and(
			eq(pullRequestReviewTombstone.organizationId, ctx.organizationId),
			eq(pullRequestReviewTombstone.userId, ctx.userId),
			eq(pullRequestReviewTombstone.date, date),
		),
		columns: { pullRequestUrl: true },
	});
	return new Set(rows.map((row) => row.pullRequestUrl));
};

/**
 * The reviewed pull requests a Code Review entry holds — what deleting it says
 * no to. Read BEFORE the delete, since the attachments cascade with the row.
 *
 * Only a Code Review entry. Deleting a Development entry that carried a review
 * as evidence is a statement about that work, not a refusal of a review block
 * nobody offered.
 */
export const reviewsHeldBy = async (
	ctx: Ctx,
	timeEntryId: string,
): Promise<string[]> => {
	const rows = await ctxDb(ctx)
		.selectDistinct({
			pullRequestUrl: timeEntryGithubPrActivity.pullRequestUrl,
		})
		.from(timeEntryGithubPrActivity)
		.innerJoin(
			timeEntry,
			eq(timeEntry.id, timeEntryGithubPrActivity.timeEntryId),
		)
		.innerJoin(task, eq(task.id, timeEntry.taskId))
		.where(
			and(
				eq(timeEntry.id, timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(task.systemKey, "code_review"),
				eq(timeEntryGithubPrActivity.kind, "reviewed"),
			),
		);
	return rows.map((row) => row.pullRequestUrl);
};
