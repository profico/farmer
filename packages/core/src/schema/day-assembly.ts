import { z } from "zod";

import { dayKeySchema } from "./day-key";
import { pullRequestRef } from "./github";

export const suggestDayAssemblyInput = z.object({
	date: dayKeySchema,
	/**
	 * Propose things this person previously deleted, too.
	 *
	 * Deleting a synced meeting or a rest-of-day block records a tombstone, which
	 * is what stops the sync engines putting it straight back. That is the right
	 * default and a dead end when the deletion was a mistake or a change of mind:
	 * the block is gone, the engine has been told never to rebuild it, and the
	 * assembler — the one screen whose whole job is "offer me what's missing" —
	 * was the one place that agreed not to mention it.
	 *
	 * So it's a toggle on the dialog rather than a policy. Off by default, because
	 * a deletion normally means what it says.
	 *
	 * Recurring-break skips are deliberately NOT covered: a skipped break is a
	 * rule you adjusted for that day, not a row you lost.
	 */
	includeDismissed: z.boolean().optional(),
});
export type SuggestDayAssemblyInput = z.infer<typeof suggestDayAssemblyInput>;

// One accepted suggestion, shaped like a createTimeEntryInput plus the commits
// to attach as evidence once the entry exists. No start/end: under the
// duration-only entry model a suggestion proposes an AMOUNT of time, not a slot.
const assembledEntry = z.object({
	taskId: z.uuid(),
	projectId: z.uuid().optional(),
	description: z.string().optional(),
	durationSeconds: z.number().int().positive().optional(),
	fillsDay: z.boolean().optional(),
	overtime: z.boolean().optional(),
	meetingUrl: z.url().optional(),
	calendarEventId: z.string().optional(),
	commits: z
		.array(
			z.object({
				projectGithubRepoId: z.uuid(),
				sha: z.string(),
			}),
		)
		.optional(),
	pullRequests: z.array(pullRequestRef).max(50).optional(),
});

export const applyDayAssemblyInput = z.object({
	date: dayKeySchema,
	entries: z.array(assembledEntry).min(1).max(50),
});
export type ApplyDayAssemblyInput = z.infer<typeof applyDayAssemblyInput>;
