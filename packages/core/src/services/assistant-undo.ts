import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import type { AssistantUndo } from "../db/schema/assistant";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import type { JsonRecord, Serializable } from "../lib/json";
import { UserFacingError } from "../lib/user-facing-error";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

/** The entry changed after the write, so the saved inverse is not exact. */
export class UndoStaleError extends UserFacingError {
	constructor() {
		super("This entry changed since, so the change cannot be undone.");
		this.name = "UndoStaleError";
	}
}

/** The entry gained commits or reviews, which a delete would cascade away. */
export class UndoHasEvidenceError extends UserFacingError {
	constructor() {
		super("This entry holds commits or reviews, so it cannot be undone.");
		this.name = "UndoHasEvidenceError";
	}
}

/** Reads the state before a write. The returned function builds the inverse
 *  from the result of the write, or gives null when it cannot be exact. */
export type UndoCapture = (result: Serializable | void) => AssistantUndo | null;
export type UndoCapturer = (
	ctx: Ctx,
	args: JsonRecord,
) => Promise<UndoCapture | null>;

const writtenRow = z.object({ id: z.string(), updatedAt: z.date() });
const entryArgs = z.object({ timeEntryId: z.string() });

/** The row a write returned, as the id and the new `updatedAt`. */
const written = (result: Serializable | void) => {
	const parsed = writtenRow.safeParse(result);
	return parsed.success
		? {
				entryId: parsed.data.id,
				updatedAt: parsed.data.updatedAt.toISOString(),
			}
		: null;
};

const entryBefore = async (ctx: Ctx, args: JsonRecord) => {
	const parsed = entryArgs.safeParse(args);
	if (!parsed.success) return null;
	return (
		(await timeEntriesService.getOwn(ctx, parsed.data.timeEntryId)) ?? null
	);
};

export const undoCreateEntry: UndoCapturer = async () => (result) => {
	const row = written(result);
	return row && { kind: "delete_entry", ...row };
};

export const undoUpdateEntry: UndoCapturer = async (ctx, args) => {
	const before = await entryBefore(ctx, args);
	// `update` recomputes the duration of a fill-day entry, so no inverse is exact.
	if (!before || before.fillsDay) return null;
	return (result) => {
		const row = written(result);
		return (
			row && {
				kind: "restore_entry",
				...row,
				before: {
					projectId: before.projectId,
					taskId: before.taskId,
					date: before.date,
					description: before.description,
					durationSeconds: before.durationSeconds,
					overtime: before.overtime,
					fillsDay: before.fillsDay,
				},
			}
		);
	};
};

export const undoDescription: UndoCapturer = async (ctx, args) => {
	const before = await entryBefore(ctx, args);
	if (!before) return null;
	return (result) => {
		const row = written(result);
		return (
			row && {
				kind: "restore_description",
				...row,
				description: before.description,
			}
		);
	};
};

export const undoOvertime: UndoCapturer = async (ctx, args) => {
	const before = await entryBefore(ctx, args);
	if (!before) return null;
	return (result) => {
		const row = written(result);
		return (
			row && { kind: "restore_overtime", ...row, overtime: before.overtime }
		);
	};
};

/** Adding a commit or a review does not touch `updatedAt`, so the staleness
 *  guard cannot see them. */
const holdsEvidence = async (entryId: string) => {
	const [commit] = await db
		.select({ id: timeEntryGithubCommit.id })
		.from(timeEntryGithubCommit)
		.where(eq(timeEntryGithubCommit.timeEntryId, entryId))
		.limit(1);
	if (commit) return true;
	const [activity] = await db
		.select({ id: timeEntryGithubPrActivity.id })
		.from(timeEntryGithubPrActivity)
		.where(eq(timeEntryGithubPrActivity.timeEntryId, entryId))
		.limit(1);
	return Boolean(activity);
};

/** Runs the inverse through the same services as the caller. Refuses when the
 *  entry is not exactly as the write left it. */
export const applyUndo = async (ctx: Ctx, undo: AssistantUndo) => {
	const current = await timeEntriesService.getOwn(ctx, undo.entryId);
	if (current?.updatedAt.getTime() !== new Date(undo.updatedAt).getTime()) {
		throw new UndoStaleError();
	}
	switch (undo.kind) {
		case "delete_entry":
			// shortcut: check and delete are not one transaction, and `remove` has no refuse option; evidence added in that small window is not seen.
			if (await holdsEvidence(undo.entryId)) throw new UndoHasEvidenceError();
			await timeEntriesService.remove(ctx, undo.entryId);
			return;
		case "restore_entry":
			await timeEntriesService.update(ctx, {
				timeEntryId: undo.entryId,
				...undo.before,
				projectId: undo.before.projectId ?? undefined,
			});
			return;
		case "restore_description":
			await timeEntriesService.updateDescription(ctx, {
				timeEntryId: undo.entryId,
				description: undo.description,
			});
			return;
		case "restore_overtime":
			await timeEntriesService.setOvertime(ctx, {
				timeEntryId: undo.entryId,
				overtime: undo.overtime,
			});
			return;
	}
};
