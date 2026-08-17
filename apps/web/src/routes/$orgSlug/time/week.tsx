import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WeekView } from "#/components/time/week-view.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

const searchSchema = z.object({
	weekStart: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
});

export const Route = createFileRoute("/$orgSlug/time/week")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ weekStart: search.weekStart }),
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const weekStart =
			deps.weekStart ??
			startOfWeekKey(dayKeyInTz(new Date(), context.organization.timezone));
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
	const weekStart =
		search.weekStart ??
		startOfWeekKey(dayKeyInTz(new Date(), organization.timezone));
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: entries } = useSuspenseQuery(
		timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
	);
	const dates = datesBetween(weekStart, weekEnd);
	const currentWeekStart = startOfWeekKey(
		dayKeyInTz(new Date(), organization.timezone),
	);

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
