import {
	addDaysToKey,
	dayKeyInTz,
	formatDayKey,
	formatDurationLong,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Calendar,
	Clock,
	GitCommitHorizontal,
	Plus,
	Sparkles,
} from "lucide-react";
import { AutoTrackNag } from "#/components/auto-track-nag.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { EntryBlockRow } from "#/components/time/entry-block-row.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { availableEntryTypesQuery } from "#/queries/entry-types.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

export const Route = createFileRoute("/$orgSlug/")({
	loader: async ({ context }) => {
		const today = dayKeyInTz(new Date(), context.organization.timezone);
		const weekStart = startOfWeekKey(today);
		const weekEnd = addDaysToKey(weekStart, 6);
		await Promise.all([
			context.queryClient.ensureQueryData(
				timeEntriesRangeQuery(weekStart, weekEnd),
			),
			context.queryClient.ensureQueryData(myProjectsQuery()),
			context.queryClient.ensureQueryData(availableEntryTypesQuery()),
		]);
	},
	component: OrgHome,
});

function greetingForHour(hour: number): string {
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

// Monday-based, matching startOfWeekKey.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function OrgHome() {
	const { organization, session } = Route.useRouteContext();
	const today = dayKeyInTz(new Date(), organization.timezone);
	const weekStart = startOfWeekKey(today);
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: weekEntries } = useSuspenseQuery(
		timeEntriesRangeQuery(weekStart, weekEnd),
	);

	const todayEntries = weekEntries.filter(
		(entry) =>
			dayKeyInTz(new Date(entry.startedAt), organization.timezone) === today,
	);
	const todayTotal = todayEntries.reduce(
		(sum, e) => sum + e.durationSeconds,
		0,
	);
	const weekTotal = weekEntries.reduce((sum, e) => sum + e.durationSeconds, 0);

	// Per-weekday totals (Mon..Sun) for the sparkline — derived from the same
	// week query, so it costs no extra fetch.
	const perDay = WEEKDAY_LABELS.map((label, i) => {
		const key = addDaysToKey(weekStart, i);
		const seconds = weekEntries
			.filter(
				(e) => dayKeyInTz(new Date(e.startedAt), organization.timezone) === key,
			)
			.reduce((sum, e) => sum + e.durationSeconds, 0);
		return { label, key, seconds, isToday: key === today };
	});
	const maxDaySeconds = Math.max(...perDay.map((d) => d.seconds), 1);

	// "Auto-tracked today": the blocks Farmer filled in for you rather than by
	// hand — synced Google Calendar meetings (calendarEventId) and GitHub-linked
	// work (commitCount). Both read straight off today's entries.
	const meetingEntries = todayEntries.filter((e) => e.calendarEventId);
	const meetingSeconds = meetingEntries.reduce(
		(s, e) => s + e.durationSeconds,
		0,
	);
	const commitEntries = todayEntries.filter((e) => (e.commitCount ?? 0) > 0);
	const commitTotal = commitEntries.reduce(
		(s, e) => s + (e.commitCount ?? 0),
		0,
	);
	const commitSeconds = commitEntries.reduce(
		(s, e) => s + e.durationSeconds,
		0,
	);
	const hasAutoTracked = meetingEntries.length > 0 || commitEntries.length > 0;

	const dateOptions = [{ value: today, label: today }];
	const firstName = session.user.name.split(" ")[0];

	return (
		<div className="page-shell">
			<AutoTrackNag orgSlug={organization.slug} />
			<div className="flex items-center justify-between gap-4">
				<div>
					<h1 className="font-display text-xl">
						{greetingForHour(new Date().getHours())}, {firstName}
					</h1>
					<p className="mt-0.5 text-[12.5px] text-muted-foreground">
						{formatDayKey(today)} · {formatDurationLong(todayTotal)} logged
					</p>
				</div>
				<AddBlockDialog
					timezone={organization.timezone}
					dateOptions={dateOptions}
					trigger={
						<Button size="sm">
							<Plus className="size-4" />
							Add block
						</Button>
					}
				/>
			</div>

			<div className="-mx-4 mt-6 border-t border-b sm:-mx-8">
				<div className="grid grid-cols-2 divide-x border-b">
					<div className="px-4 py-4 sm:px-8">
						<div className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
							Logged today
						</div>
						<div className="font-display mt-1.5 text-2xl">
							{formatHoursShort(todayTotal)}
						</div>
					</div>
					<div className="px-4 py-4 sm:px-8">
						<div className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
							This week
						</div>
						<div className="font-display mt-1.5 text-2xl">
							{formatHoursShort(weekTotal)}
						</div>
					</div>
				</div>

				<div className="border-b px-4 py-4 sm:px-8">
					<div className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
						This week by day
					</div>
					<div className="mt-3 flex items-end gap-2">
						{perDay.map((d) => {
							const px =
								d.seconds > 0
									? Math.max(Math.round((d.seconds / maxDaySeconds) * 48), 4)
									: 2;
							return (
								<div
									key={d.key}
									className="flex flex-1 flex-col items-center gap-1.5"
								>
									<div
										className={cn(
											"w-full rounded-sm",
											d.isToday
												? "bg-primary"
												: d.seconds > 0
													? "bg-secondary"
													: "bg-muted",
										)}
										style={{ height: `${px}px` }}
									/>
									<span
										className={cn(
											"text-2xs",
											d.isToday
												? "font-semibold text-foreground"
												: "text-muted-foreground",
										)}
									>
										{d.label}
									</span>
								</div>
							);
						})}
					</div>
				</div>

				{hasAutoTracked && (
					<div className="border-b">
						<div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase sm:px-8">
							<Sparkles className="size-3.5" />
							Auto-tracked today
						</div>
						<div className="divide-y">
							{meetingEntries.length > 0 && (
								<div className="flex items-center gap-3 px-4 py-2.5 sm:px-8">
									<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
										<Calendar className="size-4" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">
											{meetingEntries.length} meeting
											{meetingEntries.length === 1 ? "" : "s"} synced
										</p>
										<p className="text-2xs text-muted-foreground">
											Google Calendar
										</p>
									</div>
									<span className="shrink-0 font-mono text-sm tabular-nums">
										{formatHoursShort(meetingSeconds)}
									</span>
								</div>
							)}
							{commitEntries.length > 0 && (
								<div className="flex items-center gap-3 px-4 py-2.5 sm:px-8">
									<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
										<GitCommitHorizontal className="size-4" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">
											{commitTotal} commit{commitTotal === 1 ? "" : "s"}
										</p>
										<p className="text-2xs text-muted-foreground">
											across {commitEntries.length} block
											{commitEntries.length === 1 ? "" : "s"}
										</p>
									</div>
									<span className="shrink-0 font-mono text-sm tabular-nums">
										{formatHoursShort(commitSeconds)}
									</span>
								</div>
							)}
						</div>
					</div>
				)}

				<div className="pt-4 pb-1.5">
					<div className="px-4 mb-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase sm:px-8">
						Today's entries
					</div>
					{todayEntries.length === 0 ? (
						<EmptyState
							icon={Clock}
							title="Nothing logged yet"
							description="Add your first block to start tracking today's time."
						/>
					) : (
						<div className="divide-y">
							{todayEntries.map((entry) => (
								<EntryBlockRow
									key={entry.id}
									entry={entry}
									timezone={organization.timezone}
									dateOptions={dateOptions}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			<div className="mt-4">
				<Link
					to="/$orgSlug/time"
					params={{ orgSlug: organization.slug }}
					className="text-sm text-primary hover:underline"
				>
					View full calendar →
				</Link>
			</div>
		</div>
	);
}
