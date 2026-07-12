import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EditWeeklyTargetDialog } from "#/components/edit-weekly-target-dialog.tsx";
import { RequestTimeOffDialog } from "#/components/request-time-off-dialog.tsx";
import { TimeOffBalanceCard } from "#/components/time-off-balance-card.tsx";
import { TimeOffItem } from "#/components/time-off-item.tsx";
import { WorkingHoursRow } from "#/components/working-hours-row.tsx";
import { myTimeOffQuery, timeOffBalanceQuery } from "#/queries/time-off.ts";
import {
	weeklyTargetQuery,
	workingHoursQuery,
} from "#/queries/working-hours.ts";

export const Route = createFileRoute("/$orgSlug/settings/my-schedule")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(workingHoursQuery()),
			context.queryClient.ensureQueryData(weeklyTargetQuery()),
			context.queryClient.ensureQueryData(myTimeOffQuery()),
			context.queryClient.ensureQueryData(timeOffBalanceQuery()),
		]);
	},
	component: MySchedulePage,
});

// DB dayOfWeek is 0=Sun..6=Sat (matches Date#getDay()/weekdayInTz), but the
// rest of the app orders weeks Mon-first (see startOfWeekKey) — this just
// reorders the display, the stored index is untouched.
const MON_FIRST_ORDER = [1, 2, 3, 4, 5, 6, 0];

function MySchedulePage() {
	const { organization } = Route.useRouteContext();
	const { data: days } = useSuspenseQuery(workingHoursQuery());
	const { data: targetSeconds } = useSuspenseQuery(weeklyTargetQuery());
	const { data: timeOff } = useSuspenseQuery(myTimeOffQuery());

	const orderedDays = MON_FIRST_ORDER.map((dayOfWeek) =>
		days.find((d) => d.dayOfWeek === dayOfWeek),
	);
	const sortedTimeOff = [...timeOff].sort((a, b) =>
		a.startDate.localeCompare(b.startDate),
	);
	const targetHours = targetSeconds / 3600;

	return (
		<div className="page-shell">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-display text-xl">My schedule</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Your working hours and time off.
					</p>
				</div>
				<div className="flex items-center gap-1">
					<div className="text-right">
						<p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
							Weekly target
						</p>
						<span className="font-display text-2xl">
							{targetHours}
							<span className="text-sm">h</span>
						</span>
					</div>
					<EditWeeklyTargetDialog currentHours={targetHours} />
				</div>
			</div>

			<div className="-mx-4 mt-8 grid grid-cols-1 border-y sm:-mx-8 lg:grid-cols-[1fr_330px] lg:divide-x">
				<div>
					<div className="flex h-11 items-center border-b px-4 sm:px-8">
						<h2 className="text-sm font-semibold">Working hours</h2>
					</div>
					<div className="divide-y">
						{orderedDays.map(
							(day) => day && <WorkingHoursRow key={day.dayOfWeek} day={day} />,
						)}
					</div>
					<div className="border-t px-4 py-4 sm:px-8">
						<Link
							to="/$orgSlug/settings/recurring-blocks"
							params={{ orgSlug: organization.slug }}
							className="text-sm text-primary hover:underline"
						>
							Manage repeating blocks →
						</Link>
					</div>
				</div>

				<div className="border-t lg:border-t-0">
					<div className="flex h-11 items-center justify-between border-b px-4 sm:px-8">
						<h2 className="text-sm font-semibold">Upcoming time off</h2>
						<RequestTimeOffDialog timezone={organization.timezone} />
					</div>
					<div className="border-b">
						<TimeOffBalanceCard />
					</div>
					<div className="divide-y">
						{sortedTimeOff.length === 0 ? (
							<p className="px-4 py-4 text-sm text-muted-foreground sm:px-8">
								No time off requested yet.
							</p>
						) : (
							sortedTimeOff.map((item) => (
								<TimeOffItem key={item.id} item={item} />
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
