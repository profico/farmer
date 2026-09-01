import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EditWeeklyTargetDialog } from "#/components/edit-weekly-target-dialog.tsx";
import { Unit } from "#/components/ui/metric.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { WorkingHoursRow } from "#/components/working-hours-row.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	weeklyTargetQuery,
	workingHoursQuery,
} from "#/queries/working-hours.ts";

export const Route = createFileRoute("/$orgSlug/settings/my-schedule")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			context.queryClient.ensureQueryData(workingHoursQuery(orgSlug)),
			context.queryClient.ensureQueryData(weeklyTargetQuery(orgSlug)),
		]);
	},
	component: MySchedulePage,
});

// DB dayOfWeek is 0=Sun..6=Sat (matches Date#getDay()/weekdayInTz), but the
// rest of the app orders weeks Mon-first (see startOfWeekKey) — this just
// reorders the display, the stored index is untouched.
const MON_FIRST_ORDER = [1, 2, 3, 4, 5, 6, 0];

function MySchedulePage() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const { data: days } = useSuspenseQuery(workingHoursQuery(orgSlug));
	const { data: targetSeconds } = useSuspenseQuery(weeklyTargetQuery(orgSlug));

	const orderedDays = MON_FIRST_ORDER.map((dayOfWeek) =>
		days.find((d) => d.dayOfWeek === dayOfWeek),
	);
	const targetHours = targetSeconds / 3600;

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Your schedule"
				title="My schedule"
				lede={`Your working hours. These drive the "fill rest of day" block and the reminder that you're behind pace.`}
				action={
					<div className="flex items-center gap-2.5">
						{/* Label then figure, the same order as every other label/value
						    pair in the app — reversed, the two ran together as one word. */}
						<span className="eyebrow">Weekly target</span>
						<span className="mono text-lg">
							{targetHours}
							<Unit>h</Unit>
						</span>
						<EditWeeklyTargetDialog currentHours={targetHours} />
					</div>
				}
				className="mb-0"
			/>

			<div className="-mx-4 mt-7 border-t sm:-mx-8">
				<div className="flex h-11 items-center border-b border-line2 px-4 sm:px-8">
					<h2 className="eyebrow">Working hours</h2>
				</div>
				<div className="divide-y divide-line2">
					{orderedDays.map(
						(day) => day && <WorkingHoursRow key={day.dayOfWeek} day={day} />,
					)}
				</div>
				<div className="border-t border-line2 px-4 py-4 sm:px-8">
					<Link
						to="/$orgSlug/settings/recurring-blocks"
						params={{ orgSlug: organization.slug }}
						className="underlined text-sm text-primary"
					>
						Manage repeating blocks →
					</Link>
				</div>
			</div>

			{/* Time off is no longer requested and approved here — Vacation and Sick
			    Leave are logged as ordinary time entries against the built-in absence
			    tasks, so they live on the Time screen with everything else. */}
			<div className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<p className="eyebrow">Time off</p>
				<p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
					Log Vacation and Sick Leave on the{" "}
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
				</p>
			</div>
		</Page>
	);
}
