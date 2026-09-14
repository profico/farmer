import type { WeekStartsOn } from "@farmer/core/lib/time";
import { useRouteContext } from "@tanstack/react-router";

import { orderedWeekdays } from "#/lib/weekdays.ts";

/**
 * The day the current workspace's weeks start on, an organization setting.
 *
 * Read from the `/$orgSlug` layout's context, which `enterOrganization`
 * resolves with the rest of the organization, so it costs no request. Saving
 * the setting re-runs that `beforeLoad` (`router.invalidate()` on Settings →
 * Organization), so every week on screen follows at once.
 */
export const useWeekStartsOn = (): WeekStartsOn =>
	useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.organization.weekStartsOn,
	});

/** The seven weekdays in the order this workspace draws a week. */
export const useWeekdays = () => orderedWeekdays(useWeekStartsOn());
