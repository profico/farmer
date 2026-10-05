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

import { DayView } from "#/components/time/day-view.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useToday } from "#/hooks/use-today.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

const searchSchema = z.object({
	date: dayKeySchema.optional(),
});

export const Route = createFileRoute("/$orgSlug/time/")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const date =
			deps.date ?? dayKeyInTz(new Date(), context.organization.timezone);
		// The whole week, not just the day: the strip above the list shows every
		// day's total, and fetching the week once is cheaper than seven day calls.
		const weekStart = startOfWeekKey(date, context.organization.weekStartsOn);
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

		// The neighbouring weeks, warmed but NOT awaited. Stepping between days
		// inside a week is a cache hit and lands instantly; the step that crosses a
		// week boundary used to miss, and the loader blocks navigation, so the whole
		// view was replaced by the pending state for at least 300ms while it
		// fetched. Prefetching removes the miss without holding up this navigation.
		for (const offset of [-7, 7]) {
			const start = addDaysToKey(weekStart, offset);
			void context.queryClient.prefetchQuery(
				timeEntriesRangeQuery(orgSlug, start, addDaysToKey(start, 6)),
			);
		}
	},
	component: DayRoute,
});

function DayRoute() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	// Live, so a tab left open past midnight moves to the new day by itself.
	// The range queries read the deferred value. A new day can be a new week,
	// whose range is not in the cache. The live value would show the pending
	// state at once and, with no network, the error page. The deferred render
	// suspends in the background and the old day stays on screen until the new
	// range loads. DayView reads the live day itself for its today marks.
	const today = useDeferredValue(useToday(organization.timezone));
	const date = search.date ?? today;
	const weekStart = startOfWeekKey(date, organization.weekStartsOn);
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: weekEntries } = useSuspenseQuery(
		timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
	);

	return (
		<DayView
			orgSlug={organization.slug}
			date={date}
			timezone={organization.timezone}
			entries={weekEntries.filter((entry) => entry.date === date)}
			weekDates={datesBetween(weekStart, weekEnd)}
			weekEntries={weekEntries}
			holidays={new Map(holidayEntries)}
		/>
	);
}
