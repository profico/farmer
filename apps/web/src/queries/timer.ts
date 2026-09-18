import { queryOptions } from "@tanstack/react-query";

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
