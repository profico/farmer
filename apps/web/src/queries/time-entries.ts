import { addDaysToKey } from "@farmer/core/lib/time";
import type { ListAbsenceForUserInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";

import {
	listAbsenceForUser,
	listTimeEntriesRange,
	listUnfiledEntries,
} from "#/server/time-entries.ts";

import { queryKeys } from "./keys.ts";

export const timeEntriesRangeQuery = (org: string, from: string, to: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timeEntries, from, to],
		queryFn: () => listTimeEntriesRange({ data: { from, to } }),
	});

// The caller's own entries with no project yet. Under the time-entries root,
// so a write that files or deletes one already moves the banner's count.
export const unfiledEntriesQuery = (org: string, from: string, to: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timeEntries, "unfiled", from, to],
		queryFn: () => listUnfiledEntries({ data: { from, to } }),
	});

// How far back the unfiled worklist reaches.
//
// It ends today: the calendar sync pre-imports meetings up to two weeks out, and
// a nag to file a meeting nobody has sat in yet is noise. 61 days back keeps the
// span inside the 62-day ceiling `listTimeEntriesRangeInput` enforces.
const UNFILED_DAYS_BACK = 61;

/**
 * The unfiled worklist's span, as the whole app addresses it.
 *
 * Two surfaces read this list — the banner over the timesheet and the count on
 * the Time nav row — and they are the same list, not two similar ones. Spelled
 * out separately they are two fetches whose windows drift apart the first time
 * one side's constant is edited, which reads on screen as a badge that says 3
 * over a banner that lists 4. One window, therefore one key, therefore one
 * answer.
 */
export const unfiledWindow = (todayKey: string) => ({
	from: addDaysToKey(todayKey, -UNFILED_DAYS_BACK),
	to: todayKey,
});

/** The worklist itself, over `unfiledWindow`. */
export const unfiledWindowQuery = (org: string, todayKey: string) => {
	const { from, to } = unfiledWindow(todayKey);

	return unfiledEntriesQuery(org, from, to);
};

// Somebody else's Vacation/Sick for a month, for a PM correcting it. Keyed by
// person and month because that is the whole scope of the
// permission behind it.
export const absenceForUserQuery = (
	org: string,
	input: ListAbsenceForUserInput,
) =>
	queryOptions({
		queryKey: [
			...queryKeys(org).timeEntries,
			"absence",
			input.userId,
			input.year,
			input.month,
		],
		queryFn: () => listAbsenceForUser({ data: input }),
	});
