import { dayKeyInTz } from "@farmer/core/lib/time";
import { useQuery } from "@tanstack/react-query";

import { unfiledWindowQuery } from "#/queries/time-entries.ts";

/**
 * How many of the caller's own entries are still unattributed.
 *
 * Unfiled time is the one worklist that has to follow a person around: it is
 * real work that no project report can see, and it is the single hard stop on
 * finalizing a month. It used to live only on the timesheet, so the person
 * holding up the close could walk the whole app without meeting it.
 *
 * The same query the banner reads (`unfiledWindowQuery`), so the badge and the
 * banner are one fetch and cannot disagree. Not a suspense query, and never
 * awaited by a loader — both navigations paint before it resolves, and a nav row
 * that arrives without its badge is right, while a nav that waits for one is not.
 */
export function useUnfiledCount(orgSlug: string, timezone: string): number {
	const { data } = useQuery({
		...unfiledWindowQuery(orgSlug, dayKeyInTz(new Date(), timezone)),
		staleTime: 60_000,
	});
	return data?.length ?? 0;
}
