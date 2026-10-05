import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { dayKeySchema } from "@farmer/core/schema";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

import { WeekView } from "#/components/time/week-view.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useToday } from "#/hooks/use-today.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

const searchSchema = z.object({
	weekStart: dayKeySchema.optional(),
});

export const Route = createFileRoute("/$orgSlug/time/week")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ weekStart: search.weekStart }),
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const weekStart =
			deps.weekStart ??
			startOfWeekKey(
				dayKeyInTz(new Date(), context.organization.timezone),
				context.organization.weekStartsOn,
			);
		const weekEnd = addDaysToKey(weekStart, 6);
		await Promise.all([
			context.queryClient.ensureQueryData(
				timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
			),
			context.queryClient.ensureQueryData(myProjectsQuery(orgSlug)),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
			),
		]);

		// Warm the weeks either side without holding this navigation up, so a step
		// with the ‹ / › buttons is a cache hit rather than a blocking fetch that
		// swaps the grid out for the pending state. Same reasoning as the Day route.
		for (const offset of [-7, 7]) {
			const start = addDaysToKey(weekStart, offset);
			void context.queryClient.prefetchQuery(
				timeEntriesRangeQuery(orgSlug, start, addDaysToKey(start, 6)),
			);
		}
	},
	component: WeekRoute,
});

function WeekRoute() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	// Deferred, so a day that opens a new week loads that week in the
	// background while the old week stays on screen (see the Day route).
	// `isCurrentWeek` follows the week on screen, so the two always agree.
	const today = useDeferredValue(useToday(organization.timezone));
	const currentWeekStart = startOfWeekKey(today, organization.weekStartsOn);
	const weekStart = search.weekStart ?? currentWeekStart;
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: entries } = useSuspenseQuery(
		timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
	);
	const dates = datesBetween(weekStart, weekEnd);

	return (
		<WeekView
			orgSlug={organization.slug}
			dates={dates}
			entries={entries}
			weekStart={weekStart}
			isCurrentWeek={weekStart === currentWeekStart}
			holidays={new Map(holidayEntries)}
		/>
	);
}
