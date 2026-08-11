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
	loader: async ({ context, deps }) => {
		const weekStart =
			deps.weekStart ??
			startOfWeekKey(dayKeyInTz(new Date(), context.organization.timezone));
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
	component: WeekRoute,
});

function WeekRoute() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const weekStart =
		search.weekStart ??
		startOfWeekKey(dayKeyInTz(new Date(), organization.timezone));
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: entries } = useSuspenseQuery(
		timeEntriesRangeQuery(weekStart, weekEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery({ from: weekStart, to: weekEnd }),
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
