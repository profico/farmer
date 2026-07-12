import { dayKeyInTz } from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DayView } from "#/components/time/day-view.tsx";
import { availableEntryTypesQuery } from "#/queries/entry-types.ts";
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
		await Promise.all([
			context.queryClient.ensureQueryData(timeEntriesRangeQuery(date, date)),
			context.queryClient.ensureQueryData(myProjectsQuery()),
			context.queryClient.ensureQueryData(availableEntryTypesQuery()),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery({ from: date, to: date }),
			),
		]);
	},
	component: DayRoute,
});

function DayRoute() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const date = search.date ?? dayKeyInTz(new Date(), organization.timezone);
	const { data: entries } = useSuspenseQuery(timeEntriesRangeQuery(date, date));
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery({ from: date, to: date }),
	);

	return (
		<DayView
			orgSlug={organization.slug}
			date={date}
			timezone={organization.timezone}
			entries={entries}
			holidays={new Map(holidayEntries)}
		/>
	);
}
