import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { rememberEntryOptions, rememberLastPick } from "#/lib/entry-options.ts";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import {
	attachedCommitsQuery,
	attachedPullRequestsQuery,
} from "#/queries/github.ts";
import { queryKeys } from "#/queries/keys.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { invalidateTimer } from "#/queries/timer.ts";
import {
	attachCommitsToEntry,
	attachPullRequestsToEntry,
} from "#/server/github.ts";
import { createRecurringBlockRule } from "#/server/recurring-block-rules.ts";
import { createTimeEntry, updateTimeEntry } from "#/server/time-entries.ts";

import {
	type ExistingTimeEntry,
	type FormValues,
	type SuggestedCommit,
	type SuggestedPullRequest,
	selectedCommitRefs,
	selectedPullRequestRefs,
	toEntryPayload,
	toRulePayload,
} from "./add-block-form.ts";

/** Sends the form: a weekly rule for a new repeating entry, else one entry. */
export function submitEntry(
	values: FormValues,
	entry: ExistingTimeEntry | undefined,
	pick: { meetingUrl: string | null; calendarEventId: string | null },
) {
	if (!entry && values.repeatEnabled) {
		return createRecurringBlockRule({ data: toRulePayload(values) });
	}
	const payload = toEntryPayload(values, pick);
	return entry
		? updateTimeEntry({ data: { ...payload, timeEntryId: entry.id } })
		: createTimeEntry({ data: payload });
}

export type SavedContext = {
	savedEntry: { id: string };
	values: FormValues;
	entry: ExistingTimeEntry | undefined;
	orgSlug: string;
	queryClient: QueryClient;
	defaultDate: string;
	suggestedCommits: ReadonlyArray<SuggestedCommit>;
	suggestedPullRequests: ReadonlyArray<SuggestedPullRequest>;
	selectedCommitKeys: Set<string>;
	selectedPullRequestKeys: Set<string>;
};

async function attachSelection(saved: SavedContext): Promise<void> {
	const { savedEntry, values } = saved;
	if (values.repeatEnabled) return;
	const commits = selectedCommitRefs(
		saved.suggestedCommits,
		saved.selectedCommitKeys,
	);
	if (commits.length > 0) {
		await attachCommitsToEntry({
			data: { timeEntryId: savedEntry.id, commits },
		});
	}
	const pullRequests = selectedPullRequestRefs(
		saved.suggestedPullRequests,
		saved.selectedPullRequestKeys,
	);
	if (pullRequests.length > 0) {
		await attachPullRequestsToEntry({
			data: { timeEntryId: savedEntry.id, pullRequests },
		});
	}
}

// Time off is never remembered: a day of leave is not what the next
// entry is likely to be. An edit does not move the last pick either,
// since correcting an old entry says nothing about the next one.
function rememberSaved(saved: SavedContext): void {
	const { values, entry, orgSlug } = saved;
	if (!values.projectId) return;
	if (!entry) {
		rememberLastPick("entry", orgSlug, {
			projectId: values.projectId,
			taskId: values.taskId,
		});
	}
	if (!values.repeatEnabled) {
		rememberEntryOptions(orgSlug, values.projectId, values.taskId, {
			fillsDay: values.fillsDay,
			overtime: values.overtime,
		});
	}
}

// The entry lists are waited for, and nothing else. The body stays
// mounted after a close and seeds its form from `entry` only on the
// open transition, so a close before this refetch let a quick reopen
// show the values from before the save — and a second Save wrote them
// back. The other refetches run behind the exit: the dialog used to
// wait for all five, one after another, with its Save button disabled
// and nothing else to say so, and people pressed it again.
async function refreshEntryLists(saved: SavedContext): Promise<void> {
	const { queryClient, orgSlug } = saved;
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).timeEntries],
		}),
		// A timed entry's task and note show on the timer card.
		invalidateTimer(queryClient, orgSlug),
	]);
}

async function refreshBehindExit(saved: SavedContext): Promise<void> {
	const { queryClient, orgSlug, savedEntry, entry } = saved;
	await Promise.all([
		// The attached lists sit in the cache under the entry's id, fresh for
		// the default 30s, so reopening the entry showed the attachments from
		// before this save until a reload.
		queryClient.invalidateQueries({
			queryKey: attachedCommitsQuery(orgSlug, savedEntry.id).queryKey,
		}),
		queryClient.invalidateQueries({
			queryKey: attachedPullRequestsQuery(orgSlug, savedEntry.id).queryKey,
		}),
		// The task just logged is the next "Recent".
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).tasks, "recent"],
		}),
		entry
			? null
			: queryClient.invalidateQueries({
					queryKey: recurringBlockRulesQuery(orgSlug).queryKey,
				}),
	]);
}

/** Everything after a save: attach the picks, remember them, refresh, close. */
export async function finishSave(
	saved: SavedContext,
	close: () => void,
): Promise<void> {
	await attachSelection(saved);
	rememberSaved(saved);
	// Saved to a day other than the one the dialog opened on, which the page
	// behind it may not show: say where the time went.
	if (!saved.values.repeatEnabled && saved.values.date !== saved.defaultDate) {
		toast.success(`Saved to ${formatDateKeyLong(saved.values.date)}`);
	}
	await refreshEntryLists(saved);
	close();
	void refreshBehindExit(saved);
}
