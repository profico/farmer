import { addDaysToKey, dayKeyInTz, endOfMonthKey } from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

import { MonthView } from "#/components/time/month-view.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useToday } from "#/hooks/use-today.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import {
	timeEntriesRangeQuery,
	WARM_RANGE_GC_MS,
} from "#/queries/time-entries.ts";

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
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const month = deps.month ?? currentMonthKey(context.organization.timezone);
		const monthStart = `${month}-01`;
		const monthEnd = endOfMonthKey(monthStart);
		await Promise.all([
			context.queryClient.ensureQueryData(
				timeEntriesRangeQuery(orgSlug, monthStart, monthEnd),
			),
			context.queryClient.ensureQueryData(myProjectsQuery(orgSlug)),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery(orgSlug, { from: monthStart, to: monthEnd }),
			),
		]);

		// The next month and its holidays, warmed but NOT awaited, as the Day and
		// Week routes warm the next week. A prefetch has no observer, so the long
		// gcTime keeps it for a tab that stays open until the month ends. With the
		// default 5 minutes it would be gone by then.
		const nextStart = addDaysToKey(monthEnd, 1);
		const nextEnd = endOfMonthKey(nextStart);
		void context.queryClient.prefetchQuery({
			...timeEntriesRangeQuery(orgSlug, nextStart, nextEnd),
			gcTime: WARM_RANGE_GC_MS,
		});
		void context.queryClient.prefetchQuery({
			...holidaysForRangeQuery(orgSlug, { from: nextStart, to: nextEnd }),
			gcTime: WARM_RANGE_GC_MS,
		});
	},
	component: MonthRoute,
});

function MonthRoute() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	// Deferred, so a day that opens a new month loads that month in the
	// background while the old month stays on screen (see the Day route).
	// MonthView gets this same day as a prop, so the page uses one day.
	const today = useDeferredValue(useToday(organization.timezone));
	const month = search.month ?? today.slice(0, 7);
	const monthStart = `${month}-01`;
	const monthEnd = endOfMonthKey(monthStart);
	const { data: entries } = useSuspenseQuery(
		timeEntriesRangeQuery(orgSlug, monthStart, monthEnd),
	);
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery(orgSlug, { from: monthStart, to: monthEnd }),
	);

	return (
		<MonthView
			orgSlug={organization.slug}
			month={month}
			timezone={organization.timezone}
			today={today}
			entries={entries}
			holidays={new Map(holidayEntries)}
		/>
	);
}
