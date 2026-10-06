import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { getTimer, getTimerSettings } from "#/server/timer.ts";

import { queryKeys } from "./keys.ts";

// The stopwatch (issue #59). One query, read by the sidebar, the mobile bar and
// the Time page, so no two surfaces can disagree about what is running.
//
// `staleTime: 0` on purpose. The app's default is 30 seconds, and a timer
// started on a laptop must show up in a phone's tab the moment it is looked at
// — a refetch on focus that waits half a minute is not the promise the row
// makes. The figure itself ticks in the browser between fetches.
export const timerQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timer],
		queryFn: () => getTimer(),
		staleTime: 0,
	});

export const timerSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timer, "settings"],
		queryFn: () => getTimerSettings(),
	});

/**
 * Refetch the timer row alone. Not the bare `queryKeys(org).timer` root: that
 * is a prefix of `timerSettingsQuery`, so it would refetch the cap as well.
 * Call it after any write that can change a timed entry (its task, project,
 * note or hours), because the timer reads those from the entry (issue #121).
 */
export const invalidateTimer = (queryClient: QueryClient, org: string) =>
	queryClient.invalidateQueries({
		queryKey: timerQuery(org).queryKey,
		exact: true,
	});
