import { createTimeEntry } from "#/server/time-entries.ts";

// Undo for a deleted time entry, shared by the two screens that delete one: the
// timesheet row (`components/time/entry-block-row.tsx`) and the unfiled-entries
// dialog (`components/time/unfiled-entries-banner.tsx`). Both get the deleted
// row back from `deleteTimeEntry` — `timeEntriesService.remove` returns it for
// exactly this — so undo is a re-create from that snapshot and nothing else is
// held anywhere.

/** The deleted row, in the fields a restore reads. */
export type DeletedTimeEntry = {
	projectId: string | null;
	taskId: string;
	description: string;
	date: string;
	durationSeconds: number;
	overtime: boolean;
	meetingUrl: string | null;
	calendarEventId: string | null;
	fillsDay: boolean;
	generatedFromRuleId: string | null;
};

/**
 * Whether undo can put this row back.
 *
 * A fill block is derived — the commit engine sizes it from what is left of the
 * day — and a rule-generated entry leaves a skip behind, so re-creating either
 * as a manual copy would be wrong rather than a restore.
 *
 * A calendar meeting is restorable, which is the case that matters here: a
 * delete writes a tombstone the sync engine honours forever, and
 * `timeEntriesService.create` clears it again when the new row carries the same
 * `calendarEventId`. So a meeting is not lost to one misclick.
 */
export const isRestorable = (entry: DeletedTimeEntry): boolean =>
	!entry.fillsDay && entry.generatedFromRuleId === null;

/**
 * Re-creates deleted rows from the snapshots the delete returned.
 *
 * Under the duration-only model this is a straight field copy — there are no
 * timestamps to reconstruct. It throws on the first row that fails, so a caller
 * can say the undo did not land instead of reporting a restore that did not
 * happen.
 */
export const restoreTimeEntries = async (
	entries: DeletedTimeEntry[],
): Promise<void> => {
	for (const entry of entries) {
		await createTimeEntry({
			data: {
				taskId: entry.taskId,
				projectId: entry.projectId ?? undefined,
				description: entry.description || undefined,
				date: entry.date,
				durationSeconds: entry.durationSeconds,
				overtime: entry.overtime,
				fillsDay: false,
				// Carried so a restored meeting keeps its link — and so the service
				// clears the tombstone the delete just wrote.
				meetingUrl: entry.meetingUrl ?? undefined,
				calendarEventId: entry.calendarEventId ?? undefined,
			},
		});
	}
};
