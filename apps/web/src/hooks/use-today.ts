import { dayKeyInTz } from "@farmer/core/lib/time";
import { useCallback, useSyncExternalStore } from "react";

import { watchToday } from "#/lib/today.ts";

/**
 * Today's day key in `timezone`, which changes by itself at midnight.
 *
 * Use this and not `dayKeyInTz(new Date(), …)` in a component. A render-time
 * read goes stale in a tab that stays open, and two components then disagree
 * about the day. Here every component that renders reads the clock, and every
 * subscriber renders again when the day changes.
 */
export function useToday(timezone: string): string {
	const subscribe = useCallback(
		(onChange: () => void) => watchToday(timezone, onChange),
		[timezone],
	);
	const read = () => dayKeyInTz(new Date(), timezone);
	return useSyncExternalStore(subscribe, read, read);
}
