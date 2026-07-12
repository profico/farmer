import { dayKeyInTz, endOfMonthKey } from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MonthView } from "#/components/time/month-view.tsx";
import { availableEntryTypesQuery } from "#/queries/entry-types.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

const searchSchema = z.object({
	month: z
		.string()
		.regex(/^\d{4}-\d{2}$/)
		.optional(),
});

const currentMonthKey = (timezone: string) =>
	dayKeyInTz(new Date(), timezone).slice(0, 7);

export const Route = createFileRoute("/$orgSlug/time/month")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ month: search.month }),
	loader: async ({ context, deps }) => {
		const month = deps.month ?? currentMonthKey(context.organization.timezone);
		const monthStart = `${month}-01`;
		const monthEnd = endOfMonthKey(monthStart);
		await Promise.all([
			context.queryClient.ensureQueryData(
				timeEntriesRangeQuery(monthStart, monthEnd),
			),
			context.queryClient.ensureQueryData(myProjectsQuery()),
			context.queryClient.ensureQueryData(availableEntryTypesQuery()),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery({ from: monthStart, to: monthEnd }),
			),
		]);
	},
	component: MonthRoute,
});

function MonthRoute() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const month = search.month ?? currentMonthKey(organization.timezone);
	const monthStart = `${month}-01`;
	const monthEnd = endOfMonthKey(monthStart);
	const { data: entries } = useSuspenseQuery(
		timeEntriesRangeQuery(monthStart, monthEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery({ from: monthStart, to: monthEnd }),
	);

	return (
		<MonthView
			orgSlug={organization.slug}
			month={month}
			timezone={organization.timezone}
			entries={entries}
			holidays={new Map(holidayEntries)}
		/>
	);
}
