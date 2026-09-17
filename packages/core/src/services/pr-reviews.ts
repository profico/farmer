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
// In its own module because the engine, the assembler and the two ways of
// taking a review off an entry need the same answers — which entry already
// holds a PR's reviews, which Code Review entries are blocks, and which review
// blocks the person said no to — and `day-assembly.service` imports
// `time-entries.service`, so neither can own them.
//
// A review has a moment and no length: GitHub records when it was submitted,
// not how long it took. The block is a fixed estimate the person edits, taken
// from the day's free time (the rest-of-day block shrinks by the same amount)
// and never added on top of a day that is already full.

export const REVIEW_BLOCK_SECONDS = 30 * 60;

export const reviewBlockDescription = (title: string) => `PR review: ${title}`;

type HeldReview = { pullRequestUrl: string; title: string };

/**
 * Every review attached on the day, two ways round: `homes` is the entry that
 * holds each reviewed pull request, keyed by the PR's URL, and `heldBy` is the
 * reviews each entry holds, keyed by entry id.
 *
 * Any entry is a home, not only a Code Review one. A day synced before review
 * blocks existed has its reviews on a Development entry or the rest-of-day
 * block, and the engine must not add a second half hour to a day it already
 * filed. The oldest attachment wins, so the answer is stable across runs.
 */
export const reviewsOnDay = async (
	ctx: Ctx,
	date: string,
): Promise<{
	homes: Map<string, string>;
	heldBy: Map<string, HeldReview[]>;
}> => {
	const rows = await ctxDb(ctx)
		.select({
			pullRequestUrl: timeEntryGithubPrActivity.pullRequestUrl,
			title: timeEntryGithubPrActivity.title,
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
	const heldBy = new Map<string, HeldReview[]>();

	for (const row of rows) {
		if (!homes.has(row.pullRequestUrl)) {
			homes.set(row.pullRequestUrl, row.timeEntryId);
		}

		heldBy.set(row.timeEntryId, [...(heldBy.get(row.timeEntryId) ?? []), row]);
	}

	return { homes, heldBy };
};

/**
 * Whether a Code Review entry is one pull request's review block, rather than
 * an entry the person logged for their reviewing on that project.
 *
 * The difference decides where a later review goes. A hand-logged entry is the
 * person's own answer to how long the reviewing took, so every PR reviewed on
 * its project that day belongs on it; a block is one PR's half hour, and a
 * second PR on it would hide that PR's time again.
 *
 * No column records it. A block is what the engine files and what the day
 * assembler proposes: the reviews of one PR, under that PR's
 * `reviewBlockDescription`. A hand-logged entry does not read that way even
 * after it takes a review, because its blank description is written as
 * "Reviewed #12: …", and a block whose description the person rewrote has
 * become their own entry.
 */
export const isReviewBlock = (
	description: string,
	held: HeldReview[],
): boolean =>
	new Set(held.map((review) => review.pullRequestUrl)).size === 1 &&
	held.some((review) => description === reviewBlockDescription(review.title));

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
 * The reviewed pull requests a Code Review entry holds — what deleting it, or
 * taking its reviews off, says no to. Read BEFORE the write, since the
 * attachments go with it.
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

/** Record that the person said no to these pull requests' review blocks. */
export const refuseReviewBlocks = async (
	ctx: Ctx,
	date: string,
	pullRequestUrls: string[],
): Promise<void> => {
	if (pullRequestUrls.length === 0) return;
	await ctxDb(ctx)
		.insert(pullRequestReviewTombstone)
		.values(
			pullRequestUrls.map((pullRequestUrl) => ({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				date,
				pullRequestUrl,
			})),
		)
		.onConflictDoNothing();
};
