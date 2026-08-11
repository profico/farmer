import type { ListAbsenceForUserInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";
import {
	listAbsenceForUser,
	listTimeEntriesRange,
} from "#/server/time-entries.ts";

export const timeEntriesRangeQuery = (from: string, to: string) =>
	queryOptions({
		queryKey: ["time-entries", from, to],
		queryFn: () => listTimeEntriesRange({ data: { from, to } }),
	});

// Somebody else's Vacation/Sick for a month, for a PM correcting it from the
// close sheet. Keyed by person and month because that is the whole scope of the
// permission behind it.
export const absenceForUserQuery = (input: ListAbsenceForUserInput) =>
	queryOptions({
		queryKey: [
			"time-entries",
			"absence",
			input.userId,
			input.year,
			input.month,
		],
		queryFn: () => listAbsenceForUser({ data: input }),
	});
