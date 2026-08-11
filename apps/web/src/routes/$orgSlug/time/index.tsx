import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DayView } from "#/components/time/day-view.tsx";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

const searchSchema = z.object({
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
});

export const Route = createFileRoute("/$orgSlug/time/")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ context, deps }) => {
		const date =
			deps.date ?? dayKeyInTz(new Date(), context.organization.timezone);
		// The whole week, not just the day: the strip above the list shows every
		// day's total, and fetching the week once is cheaper than seven day calls.
		const weekStart = startOfWeekKey(date);
		const weekEnd = addDaysToKey(weekStart, 6);
		await Promise.all([
			context.queryClient.ensureQueryData(
				timeEntriesRangeQuery(weekStart, weekEnd),
			),
			context.queryClient.ensureQueryData(myProjectsQuery()),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery({ from: weekStart, to: weekEnd }),
			),
		]);
	},
	component: DayRoute,
});

function DayRoute() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const date = search.date ?? dayKeyInTz(new Date(), organization.timezone);
	const weekStart = startOfWeekKey(date);
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: weekEntries } = useSuspenseQuery(
		timeEntriesRangeQuery(weekStart, weekEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery({ from: weekStart, to: weekEnd }),
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
