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
import { DashboardLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { TARGET_STATUS, TargetBar, TargetGap } from "#/components/targets.tsx";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { AssembleDayDialog } from "#/components/time/assemble-day-dialog.tsx";
import { EntryBlockRow } from "#/components/time/entry-block-row.tsx";
import { Button } from "#/components/ui/button.tsx";
import { CountUp } from "#/components/ui/count-up.tsx";
import { GhostRow } from "#/components/ui/ghost-row.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { Of, StatTile, StatTiles } from "#/components/ui/stat-tile.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { orderedWeekdays } from "#/lib/weekdays.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

export const Route = createFileRoute("/$orgSlug/")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		const today = dayKeyInTz(new Date(), context.organization.timezone);
		const weekStart = startOfWeekKey(today, context.organization.weekStartsOn);
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
	// where the three figures and the week's bars were about to land.
	pendingComponent: DashboardLoadingSkeleton,
	component: OrgHome,
});

function greetingForHour(hour: number): string {
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

/**
 * The home page is three figures and what is behind them.
 *
 * It used to be four: a "Logged today" metric, a "This week" metric, and then
 * TargetBlocks for the week and the month that said both numbers again with
 * their targets. The same figure appeared in the eyebrow, as a 40px metric and
 * inside a rail, in three visual languages — so the screen answered "how am I
 * doing" four times and never once at a glance.
 *
 * Now one band of three tiles carries today, the week and the month, each as
 * `logged / target` with one sentence and one rail. Below it, the two things a
 * figure makes you want: what you logged, and how the week is shaped.
 */
function OrgHome() {
	const orgSlug = useOrgSlug();
	const { organization, session } = Route.useRouteContext();
	const today = dayKeyInTz(new Date(), organization.timezone);
	const weekStart = startOfWeekKey(today, organization.weekStartsOn);
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
	// list beside them. Defaults to today.
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
	const todayLeft = Math.max(0, targets.daySeconds - todayTotal);

	// Per-weekday totals, in the org's week order, for the bars — derived from
	// the same week query, so it costs no extra fetch.
	const perDay = orderedWeekdays(organization.weekStartsOn).map(
		({ day: weekday, label }, i) => {
			const key = addDaysToKey(weekStart, i);
			const seconds = weekEntries
				.filter((e) => e.date === key)
				.reduce((sum, e) => sum + e.durationSeconds, 0);
			return {
				label,
				key,
				seconds,
				isToday: key === today,
				isWeekend: weekday === 0 || weekday === 6,
				holiday: holidays.get(key),
				// A day with a line to reach: a past or present working day.
				expected:
					key <= today && weekday !== 0 && weekday !== 6 && !holidays.has(key),
			};
		},
	);
	const maxDaySeconds = Math.max(
		...perDay.map((d) => d.seconds),
		targets.daySeconds,
		1,
	);
	const dayTargetPx = Math.round((targets.daySeconds / maxDaySeconds) * 64);

	// "Auto-tracked today": the blocks Farmer filled in for you rather than by
	// hand — synced Google Calendar meetings (calendarEventId) and GitHub-linked
	// work (commitCount, pullRequestCount). Both read straight off today's entries.
	const meetingEntries = todayEntries.filter((e) => e.calendarEventId);
	const meetingSeconds = meetingEntries.reduce(
		(s, e) => s + e.durationSeconds,
		0,
	);
	const githubEntries = todayEntries.filter(
		(e) => (e.commitCount ?? 0) > 0 || (e.pullRequestCount ?? 0) > 0,
	);
	const commitTotal = githubEntries.reduce(
		(s, e) => s + (e.commitCount ?? 0),
		0,
	);
	const pullRequestTotal = githubEntries.reduce(
		(s, e) => s + (e.pullRequestCount ?? 0),
		0,
	);
	const githubSeconds = githubEntries.reduce(
		(s, e) => s + e.durationSeconds,
		0,
	);
	const hasAutoTracked = meetingEntries.length > 0 || githubEntries.length > 0;

	const firstName = session.user.name.split(" ")[0];
	const weekStatus = targets.week.status;
	const monthStatus = targets.month.status;

	return (
		<Page>
			<AutoTrackNag orgSlug={organization.slug} />
			<PageHeader
				eyebrow={formatDayKey(today)}
				title={`${greetingForHour(new Date().getHours())}, ${firstName}`}
				action={
					<div className="flex items-center gap-2">
						<AssembleDayDialog
							orgSlug={orgSlug}
							date={today}
							trigger={
								<Button variant="secondary" size="sm">
									<SparkleIcon weight="regular" className="size-4" />
									Assemble my day
								</Button>
							}
						/>
						<AddBlockDialog
							timezone={organization.timezone}
							defaultDate={today}
							trigger={
								<Button size="sm">
									<PlusIcon weight="regular" className="size-4" />
									Log time
								</Button>
							}
						/>
					</div>
				}
			/>

			{/* Today, the week and the month, in that order: the horizon widens left
			    to right. Each is `logged / target`, one sentence saying what is
			    missing, and one rail. The figures count up on arrival and tween
			    when an entry is saved, so the number that changed is the one that
			    moves (`CountUp`). */}
			<StatTiles columns={3} className="-mx-4 px-4 sm:-mx-8 sm:px-8">
				<StatTile
					label="Today"
					value={
						<>
							<CountUp value={todayTotal} format={formatReportHours} />
							{targets.daySeconds > 0 && (
								<Of>/ {formatReportHours(targets.daySeconds)}</Of>
							)}
						</>
					}
					caption={
						targets.daySeconds > 0 ? (
							<>
								{todayLeft > 0 ? (
									<>
										<span className="font-medium text-foreground">
											{formatReportHours(todayLeft)}
										</span>{" "}
										to go
									</>
								) : (
									<span className="font-medium text-ok">Day complete</span>
								)}
								{" · "}
								{todayEntries.length}{" "}
								{todayEntries.length === 1 ? "entry" : "entries"}
							</>
						) : (
							<>
								{todayEntries.length}{" "}
								{todayEntries.length === 1 ? "entry" : "entries"}
							</>
						)
					}
				>
					{targets.daySeconds > 0 && (
						<div className="mt-3 h-1.5 rounded-full bg-secondary">
							<span
								className="rail-fill block h-full rounded-full bg-primary"
								style={{
									width: `${Math.min(100, (todayTotal / targets.daySeconds) * 100)}%`,
								}}
							/>
						</div>
					)}
				</StatTile>

				<StatTile
					label="This week"
					aside={
						weekStatus && (
							<StatusPill tone={TARGET_STATUS[weekStatus].tone}>
								{TARGET_STATUS[weekStatus].label}
							</StatusPill>
						)
					}
					value={
						<>
							<CountUp value={weekTotal} format={formatReportHours} />
							{targets.week.targetSeconds != null && (
								<Of>/ {formatReportHours(targets.week.targetSeconds)}</Of>
							)}
						</>
					}
					caption={<TargetGap period={targets.week} />}
				>
					<TargetBar period={targets.week} className="mt-3" />
				</StatTile>

				<StatTile
					label="This month"
					aside={
						monthStatus && (
							<StatusPill tone={TARGET_STATUS[monthStatus].tone}>
								{TARGET_STATUS[monthStatus].label}
							</StatusPill>
						)
					}
					value={
						<>
							<CountUp
								value={targets.month.totalSeconds}
								format={formatReportHours}
							/>
							{targets.month.targetSeconds != null && (
								<Of>/ {formatReportHours(targets.month.targetSeconds)}</Of>
							)}
						</>
					}
					caption={
						<>
							<TargetGap period={targets.month} />
							{" · day "}
							{targets.month.workingDaysElapsed} of {targets.month.workingDays}
						</>
					}
				>
					<TargetBar period={targets.month} className="mt-3" />
				</StatTile>
			</StatTiles>

			{/* What you logged, and how the week is shaped. Side by side from lg:
			    the day bars drive the list beside them, so cause and effect are on
			    one screen. Below that they stack, entries first — on a phone the
			    list is what you came for. */}
			<div className="mt-7 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
				<div className="min-w-0">
					<div className="section-head">
						<h2 className="eyebrow">
							{selectedDay === today
								? "Today's entries"
								: `${formatDayKey(selectedDay, { year: false })}`}
						</h2>
						<span className="text-sm text-muted-foreground">
							{formatReportHours(
								selectedEntries.reduce((s, e) => s + e.durationSeconds, 0),
							)}{" "}
							logged
						</span>
					</div>
					{/* No AnimatePresence — see the note in EntryBlockRow. It mattered
					    most here: picking another day in "This week by day" swaps every
					    row at once, so the whole list collapsed as if each entry had
					    been deleted. Switching days is navigation, not removal.
					    `key` on the wrapper re-runs the stagger when the day changes,
					    which is the crossfade doing the same job honestly. */}
					<div key={selectedDay} className="stagger mt-3 -mx-4 sm:-mx-8">
						{selectedEntries.map((entry) => (
							<EntryBlockRow
								key={entry.id}
								entry={entry}
								timezone={organization.timezone}
							/>
						))}
					</div>
					<AddBlockDialog
						timezone={organization.timezone}
						defaultDate={selectedDay}
						trigger={
							<GhostRow
								className="mt-2"
								hint={selectedEntries.length > 0 ? undefined : "or press L"}
							>
								{selectedEntries.length === 0
									? selectedDay === today
										? "Log your first block of the day"
										: "Nothing logged. Add an entry to this day"
									: `Add another entry to ${selectedDay === today ? "today" : formatDayKey(selectedDay, { year: false })}`}
							</GhostRow>
						}
					/>
				</div>

				<div className="min-w-0">
					<div className="section-head">
						<h2 className="eyebrow">This week by day</h2>
						<span className="text-sm text-muted-foreground">
							{formatReportHours(weekTotal)}
						</span>
					</div>
					{/* Each bar rises from its baseline in turn (`.rise`), which is what
					    makes seven columns read as a week rather than a barcode. */}
					<div className="mt-4 flex gap-1.5">
						{perDay.map((d, i) => {
							const px =
								d.seconds > 0
									? Math.max(Math.round((d.seconds / maxDaySeconds) * 64), 5)
									: 3;
							const isSelected = d.key === selectedDay;
							return (
								<button
									type="button"
									key={d.key}
									onClick={() => setSelectedDay(d.key)}
									aria-pressed={isSelected}
									aria-label={`${d.label}, ${formatReportHours(d.seconds)}`}
									// basis-0 + min-w-0 so the day labels can't widen their own
									// column: every day is an identical hit target regardless of
									// how much (or how little) was logged.
									className={cn(
										"flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 rounded-lg py-1.5 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/16",
										isSelected && "bg-secondary",
										d.isWeekend && !isSelected && "opacity-55",
									)}
								>
									{/* The 64px track is always here, bottom-aligned — an empty
									    day used to collapse to a 2px-tall button that was
									    almost impossible to hit. */}
									<div className="relative flex h-16 w-full items-end justify-center">
										{/* The day's worth, drawn as a line to reach — so an
										    under-filled day shows as a bar that stops short. */}
										{d.expected && (
											<span
												aria-hidden
												className="absolute left-1/2 w-7 -translate-x-1/2 border-t border-dashed border-foreground/25"
												style={{ bottom: `${dayTargetPx}px` }}
											/>
										)}
										<div
											className={cn(
												// Capped width: a full-width fill turns a 64px-tall bar
												// into a slab that out-weighs everything else on the
												// screen. A column reads as a measurement.
												"rise w-full max-w-5 rounded-t-[3px] rounded-b-[1px]",
												d.holiday
													? "bg-warn/30"
													: d.isToday
														? "bg-primary"
														: d.seconds > 0
															? "bg-primary/45"
															: "bg-line",
												isSelected && !d.isToday && "bg-primary/70",
											)}
											style={{
												height: `${px}px`,
												animationDelay: `${i * 40}ms`,
											}}
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
											"tnum text-2xs",
											d.holiday ? "text-warn" : "text-muted-foreground",
										)}
									>
										{d.holiday
											? "hol."
											: d.key <= today && d.seconds > 0
												? formatReportHours(d.seconds)
												: d.key <= today
													? "—"
													: " "}
									</span>
								</button>
							);
						})}
					</div>

					{hasAutoTracked && (
						<div className="mt-7">
							<h2 className="eyebrow flex items-center gap-1.5">
								<SparkleIcon className="size-3" />
								Auto-tracked today
							</h2>
							<div className="mt-3 flex flex-col gap-2.5">
								{meetingEntries.length > 0 && (
									<div className="flex items-center gap-2.5 text-sm">
										<CalendarBlankIcon className="size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate text-muted-foreground">
											<span className="font-medium text-foreground">
												{meetingEntries.length} meeting
												{meetingEntries.length === 1 ? "" : "s"}
											</span>{" "}
											from your calendar
										</span>
										<span className="tnum shrink-0 text-muted-foreground">
											{formatHoursShort(meetingSeconds)}
										</span>
									</div>
								)}
								{githubEntries.length > 0 && (
									<div className="flex items-center gap-2.5 text-sm">
										<GitCommitIcon className="size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate text-muted-foreground">
											<span className="font-medium text-foreground">
												{[
													commitTotal > 0
														? `${commitTotal} commit${commitTotal === 1 ? "" : "s"}`
														: null,
													pullRequestTotal > 0
														? `${pullRequestTotal} pull request${pullRequestTotal === 1 ? "" : "s"}`
														: null,
												]
													.filter(Boolean)
													.join(" and ")}
											</span>{" "}
											linked
										</span>
										<span className="tnum shrink-0 text-muted-foreground">
											{formatHoursShort(githubSeconds)}
										</span>
									</div>
								)}
							</div>
						</div>
					)}

					<Link
						to="/$orgSlug/time"
						params={{ orgSlug: organization.slug }}
						className="action mt-7 inline-flex text-sm text-primary transition-colors duration-(--dur-base) hover:text-foreground"
					>
						Open the timesheet
						<ArrowRightIcon weight="regular" className="size-3.5" />
					</Link>
				</div>
			</div>
		</Page>
	);
}
