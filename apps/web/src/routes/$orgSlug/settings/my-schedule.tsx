import { ArrowRightIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import { WorkingHoursRow } from "#/components/working-hours-row.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekdays } from "#/hooks/use-week-starts-on.ts";
import { workingHoursQuery } from "#/queries/working-hours.ts";

export const Route = createFileRoute("/$orgSlug/settings/my-schedule")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await context.queryClient.ensureQueryData(workingHoursQuery(orgSlug));
	},
	component: MySchedulePage,
});

function MySchedulePage() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const { data: days } = useSuspenseQuery(workingHoursQuery(orgSlug));

	const weekdays = useWeekdays();

	const orderedDays = weekdays.map(({ day }) =>
		days.find((d) => d.dayOfWeek === day),
	);
	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="My schedule"
				lede={`Your working hours. These drive the "fill rest of day" block, a booked span of time off, and when a reminder reaches you. Your targets come from the month's hour fund, not from here.`}
			/>

			{/* A standard band, with one deviation the vocabulary supports: the
			    body un-pads itself back to the island edge, because its rows are a
			    ruled list. That is the same `-mx-4 sm:-mx-8` a bleeding <Table>
			    carries, so the two read as one construct. */}
			<PageSection
				title="Working hours"
				contentClassName="-mx-4 border-t border-line2 sm:-mx-8"
			>
				<div className="divide-y divide-line2">
					{orderedDays.map(
						(day) => day && <WorkingHoursRow key={day.dayOfWeek} day={day} />,
					)}
				</div>
				<div className="border-t border-line2 px-4 py-4 sm:px-8">
					<Link
						to="/$orgSlug/settings/recurring-blocks"
						params={{ orgSlug: organization.slug }}
						className="underlined inline-flex items-center gap-1 text-sm text-primary"
					>
						Manage repeating blocks
						<ArrowRightIcon weight="regular" className="size-3.5" />
					</Link>
				</div>
			</PageSection>

			{/* Time off is no longer requested and approved here — Vacation and Sick
			    Leave are logged as ordinary time entries against the built-in absence
			    tasks, so they live on the Time screen with everything else. */}
			<PageSection
				title="Time off"
				description={
					<>
						Log Vacation, Sick Leave and Paid Leave on the{" "}
						<Link
							to="/$orgSlug/time"
							params={{ orgSlug: organization.slug }}
							search={{}}
							className="underlined text-primary"
						>
							Time
						</Link>{" "}
						screen, the same way you log everything else. There's no approval
						step. For a stretch of days, use <strong>Time off</strong> in the
						timesheet toolbar — it books every working day in the span at the
						hours above, and skips public holidays and days you don't work.
					</>
				}
			/>
		</Page>
	);
}
