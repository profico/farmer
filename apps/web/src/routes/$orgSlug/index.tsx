import { formatReportHours } from "@farmer/core/lib/report-format";
import {
	addDaysToKey,
	dayKeyInTz,
	formatDayKey,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import {
	ArrowRightIcon,
	CalendarBlankIcon,
	GitCommitIcon,
	PlusIcon,
	SparkleIcon,
} from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AutoTrackNag } from "#/components/auto-track-nag.tsx";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { DashboardLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { TargetBlock } from "#/components/targets.tsx";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { EntryBlockRow } from "#/components/time/entry-block-row.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Metric } from "#/components/ui/metric.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

export const Route = createFileRoute("/$orgSlug/")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		const today = dayKeyInTz(new Date(), context.organization.timezone);
		const weekStart = startOfWeekKey(today);
		const weekEnd = addDaysToKey(weekStart, 6);
		await Promise.all([
			context.queryClient.ensureQueryData(
				timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
			),
			context.queryClient.ensureQueryData(myProjectsQuery(orgSlug)),
			context.queryClient.ensureQueryData(myTargetsQuery(orgSlug)),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
			),
		]);
	},
	// The generic page placeholder is a header over a ruled list, which is the
	// shape of most screens here and not of this one — it put four ragged lines
	// where the two figures and the week's bars were about to land.
	pendingComponent: DashboardLoadingSkeleton,
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
	const orgSlug = useOrgSlug();
	const { organization, session } = Route.useRouteContext();
	const today = dayKeyInTz(new Date(), organization.timezone);
	const weekStart = startOfWeekKey(today);
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: weekEntries } = useSuspenseQuery(
		timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
	);
	// The two yardsticks are the fund rule, read for this person: the week and
	// the month, each with where they should be by today.
	const { data: targets } = useSuspenseQuery(myTargetsQuery(orgSlug));
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
	);
	const holidays = new Map(holidayEntries);

	// The "by day" bars are clickable; the day the user picks drives the entry
	// list at the bottom. Defaults to today.
	const [selectedDay, setSelectedDay] = useState(today);

	const todayEntries = weekEntries.filter((entry) => entry.date === today);
	const todayTotal = todayEntries.reduce(
		(sum, e) => sum + e.durationSeconds,
		0,
	);

	const selectedEntries = weekEntries.filter(
		(entry) => entry.date === selectedDay,
	);
	const weekTotal = weekEntries.reduce((sum, e) => sum + e.durationSeconds, 0);

	// Per-weekday totals (Mon..Sun) for the sparkline — derived from the same
	// week query, so it costs no extra fetch.
	const perDay = WEEKDAY_LABELS.map((label, i) => {
		const key = addDaysToKey(weekStart, i);
		const seconds = weekEntries
			.filter((e) => e.date === key)
			.reduce((sum, e) => sum + e.durationSeconds, 0);
		const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
		return {
			label,
			key,
			seconds,
			isToday: key === today,
			holiday: holidays.get(key),
			// A day with a line to reach: a past or present working day.
			expected:
				key <= today && weekday !== 0 && weekday !== 6 && !holidays.has(key),
		};
	});
	const maxDaySeconds = Math.max(
		...perDay.map((d) => d.seconds),
		targets.daySeconds,
		1,
	);
	const dayTargetPx = Math.round((targets.daySeconds / maxDaySeconds) * 48);

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
		<Page>
			<AutoTrackNag orgSlug={organization.slug} />
			<PageHeader
				eyebrow={`${formatDayKey(today)} · ${formatReportHours(todayTotal)} logged`}
				title={`${greetingForHour(new Date().getHours())}, ${firstName}`}
				action={
					<AddBlockDialog
						timezone={organization.timezone}
						dateOptions={dateOptions}
						trigger={
							<Button size="sm">
								<PlusIcon weight="regular" className="size-4" />
								Add block
							</Button>
						}
					/>
				}
			/>

			{/* Below xl this is one vertical stack: summary, then the selected day's
			    entries. From xl the two sit side by side — the summary is a fixed
			    reading width and the entry list takes the rest, which is what turns
			    a tall scroll into one screenful on a wide monitor. The day bars
			    already drive the list's selection, so the split makes the existing
			    interaction visible instead of scrolling between cause and effect.

			    This is the one band in the app that opens ON a rule rather than on
			    air, and it is a `div` rather than a `PageSection` so the
			    `.screen > section:first-of-type` rule cannot take it away. The rest
			    of the app's first bands are plain stacks, where a rule under the
			    header only repeats the boundary the header already drew. This one
			    is a grid: its `divide-x` verticals start at the band's top edge, so
			    with no top rule they hang off nothing and the whole panel reads as
			    unclosed. The rule is what they terminate on. */}
			<div className="-mx-4 grid border-t border-b sm:-mx-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:divide-x">
				{/* Whichever summary section lands last keeps its rule when stacked
				    (it separates summary from entries) but drops it side by side,
				    where it would just be a stray line across the column. */}
				<div className="min-w-0 xl:[&>*:last-child]:border-b-0">
					<div className="grid grid-cols-2 divide-x border-b">
						<Metric
							className="px-4 py-5 sm:px-8"
							label="Logged today"
							value={formatReportHours(todayTotal)}
							accent={todayTotal > 0}
						/>
						<Metric
							className="px-4 py-5 sm:px-8"
							label="This week"
							value={formatReportHours(weekTotal)}
						/>
					</div>

					{/* This week and this month against the rule, each saying what is
					    missing. They replaced the schedule's weekly target: the fund is
					    the one yardstick, here and on Tracking. */}
					<TargetBlock title="This week" period={targets.week} />
					<TargetBlock
						title="This month"
						period={targets.month}
						note={
							<span className="text-muted-foreground">
								{" "}
								· {targets.month.workingDaysElapsed} of{" "}
								{targets.month.workingDays} working days
							</span>
						}
					/>

					<div className="border-b px-4 py-4 sm:px-8">
						<div className="eyebrow">This week by day</div>
						<div className="mt-3.5 flex gap-2">
							{perDay.map((d) => {
								const px =
									d.seconds > 0
										? Math.max(Math.round((d.seconds / maxDaySeconds) * 48), 4)
										: 2;
								const isSelected = d.key === selectedDay;
								return (
									<button
										type="button"
										key={d.key}
										onClick={() => setSelectedDay(d.key)}
										aria-pressed={isSelected}
										// basis-0 + min-w-0 so the day labels can't widen their own
										// column: every day is an identical hit target regardless of
										// how much (or how little) was logged.
										className={cn(
											"flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 rounded-sm py-1 transition-colors duration-(--dur-fast) hover:bg-muted",
											isSelected && "bg-muted",
										)}
									>
										{/* The 48px track is always here, bottom-aligned — an empty
										    day used to collapse to a 2px-tall button that was
										    almost impossible to hit. */}
										<div className="relative flex h-12 w-full items-end justify-center">
											{/* The day's worth, drawn as a line to reach — so an
											    under-filled day shows as a bar that stops short. */}
											{d.expected && (
												<span
													aria-hidden
													className="absolute left-1/2 w-8 -translate-x-1/2 border-t border-foreground/30"
													style={{ bottom: `${dayTargetPx}px` }}
												/>
											)}
											<div
												className={cn(
													// Capped width: a full-width fill turns a 48px-tall bar
													// into a 40px-wide slab, which out-weighs everything
													// else on the screen. A column reads as a measurement.
													"w-full max-w-6 rounded-[2px]",
													d.holiday
														? "bg-warn/30"
														: d.isToday
															? "bg-primary"
															: d.seconds > 0
																? "bg-primary/40"
																: "bg-line",
													isSelected && !d.isToday && "bg-primary/70",
												)}
												style={{ height: `${px}px` }}
											/>
										</div>
										<span
											className={cn(
												"eyebrow",
												(d.isToday || isSelected) && "text-foreground",
											)}
										>
											{d.label}
										</span>
										<span
											className={cn(
												"mono text-2xs",
												d.holiday ? "text-warn" : "text-muted-foreground",
											)}
										>
											{d.holiday
												? "hol."
												: d.key <= today
													? formatReportHours(d.seconds)
													: "\u00a0"}
										</span>
									</button>
								);
							})}
						</div>
					</div>

					{hasAutoTracked && (
						<div className="border-b">
							<div className="eyebrow flex items-center gap-1.5 px-4 pt-4 pb-1 sm:px-8">
								<SparkleIcon className="size-3" />
								Auto-tracked today
							</div>
							<div>
								{meetingEntries.length > 0 && (
									<div className="flex items-center gap-3 px-4 py-3 sm:px-8">
										<CalendarBlankIcon className="size-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0 flex-1">
											<p className="text-base">
												{meetingEntries.length} meeting
												{meetingEntries.length === 1 ? "" : "s"} synced
											</p>
											<p className="mt-0.5 text-xs text-faint">
												Google Calendar
											</p>
										</div>
										<span className="mono shrink-0 text-sm">
											{formatHoursShort(meetingSeconds)}
										</span>
									</div>
								)}
								{commitEntries.length > 0 && (
									<div className="flex items-center gap-3 px-4 py-3 sm:px-8">
										<GitCommitIcon className="size-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0 flex-1">
											<p className="text-base">
												{commitTotal} commit{commitTotal === 1 ? "" : "s"}
											</p>
											<p className="mt-0.5 text-xs text-faint">
												across {commitEntries.length} block
												{commitEntries.length === 1 ? "" : "s"}
											</p>
										</div>
										<span className="mono shrink-0 text-sm">
											{formatHoursShort(commitSeconds)}
										</span>
									</div>
								)}
							</div>
						</div>
					)}
				</div>

				<div className="min-w-0 pt-4 pb-1.5">
					<div className="eyebrow mb-1 px-4 sm:px-8">
						{selectedDay === today
							? "Today's entries"
							: `${formatDayKey(selectedDay, { year: false })} entries`}
					</div>
					{selectedEntries.length === 0 ? (
						<EmptyState
							title="Nothing logged"
							description={
								selectedDay === today
									? "Add your first block to start tracking today's time."
									: "No time was logged on this day."
							}
						/>
					) : (
						// No AnimatePresence — see the note in DayView. It mattered most
						// here: picking another day in "This week by day" swaps every row
						// at once, so the whole list collapsed as if each entry had been
						// deleted. Switching days is navigation, not removal.
						<div className="divide-y divide-line2">
							{selectedEntries.map((entry) => (
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

			<div className="mt-5">
				<Link
					to="/$orgSlug/time"
					params={{ orgSlug: organization.slug }}
					className="action serif text-primary transition-colors duration-(--dur-base) hover:text-foreground"
					style={{ fontSize: 21 }}
				>
					View full calendar
					<ArrowRightIcon weight="regular" className="size-4" />
				</Link>
			</div>
		</Page>
	);
}
