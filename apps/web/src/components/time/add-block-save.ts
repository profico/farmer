import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { rememberEntryOptions, rememberLastPick } from "#/lib/entry-options.ts";
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
	type AttachKind,
	type ExistingTimeEntry,
	type FormValues,
	type SuggestedCommit,
	type SuggestedPullRequest,
	selectedCommitRefs,
	savedMemory,
	saveNotice,
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

// Each kind attaches on its own, so a failure of one does not stop the other.
// The entry is saved already: a kind that fails is a line in the toast.
async function attachKind(
	kind: AttachKind,
	count: number,
	send: () => Promise<void>,
): Promise<AttachKind | null> {
	if (count === 0) return null;
	try {
		await send();
		return null;
	} catch {
		return kind;
	}
}

/** Attaches the picked commits and pull requests; gives the kinds that failed. */
async function attachSelection(saved: SavedContext): Promise<AttachKind[]> {
	const { savedEntry, values } = saved;
	if (values.repeatEnabled) return [];
	const timeEntryId = savedEntry.id;
	const commits = selectedCommitRefs(
		saved.suggestedCommits,
		saved.selectedCommitKeys,
	);
	const pullRequests = selectedPullRequestRefs(
		saved.suggestedPullRequests,
		saved.selectedPullRequestKeys,
	);
	const failed = await Promise.all([
		attachKind("commits", commits.length, async () => {
			await attachCommitsToEntry({ data: { timeEntryId, commits } });
		}),
		attachKind("pull requests", pullRequests.length, async () => {
			await attachPullRequestsToEntry({ data: { timeEntryId, pullRequests } });
		}),
	]);
	return failed.filter((kind) => kind !== null);
}

function rememberSaved(saved: SavedContext): void {
	const { values, entry, orgSlug } = saved;
	const { lastPick, options } = savedMemory(values, !!entry);
	if (lastPick) rememberLastPick("entry", orgSlug, lastPick);
	if (options) {
		rememberEntryOptions(orgSlug, values.projectId, values.taskId, options);
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

/** Everything after a save: attach the picks, remember them, refresh, close.
 *  Nothing here throws back to the mutation. The entry exists on the server
 *  now, and an error there kept the dialog open with no entry id, so the next
 *  Save created the entry a second time. */
export async function finishSave(
	saved: SavedContext,
	close: () => void,
): Promise<void> {
	const failed = await attachSelection(saved);
	rememberSaved(saved);
	// A day other than the one the dialog opened on, which the page behind it
	// may not show, or a pick that did not attach: say so.
	const notice = saveNotice(saved.values, saved.defaultDate, failed);
	if (notice) toast[notice.tone](notice.text);
	await refreshEntryLists(saved);
	close();
	void refreshBehindExit(saved);
}
