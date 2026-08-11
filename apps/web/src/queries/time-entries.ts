import type { ListAbsenceForUserInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";
import {
	listAbsenceForUser,
	listTimeEntriesRange,
	listUnfiledEntries,
} from "#/server/time-entries.ts";
import { queryKeys } from "./keys.ts";

export const timeEntriesRangeQuery = (from: string, to: string) =>
	queryOptions({
		queryKey: [...queryKeys.timeEntries, from, to],
		queryFn: () => listTimeEntriesRange({ data: { from, to } }),
	});

// The caller's own entries with no project yet. Under the time-entries root,
// so a write that files or deletes one already moves the banner's count.
export const unfiledEntriesQuery = (from: string, to: string) =>
	queryOptions({
		queryKey: [...queryKeys.timeEntries, "unfiled", from, to],
		queryFn: () => listUnfiledEntries({ data: { from, to } }),
	});

// Somebody else's Vacation/Sick for a month, for a PM correcting it from the
// close sheet. Keyed by person and month because that is the whole scope of the
// permission behind it.
export const absenceForUserQuery = (input: ListAbsenceForUserInput) =>
	queryOptions({
		queryKey: [
			...queryKeys.timeEntries,
			"absence",
			input.userId,
			input.year,
			input.month,
		],
		queryFn: () => listAbsenceForUser({ data: input }),
	});
