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
import { RewindBanner } from "#/components/rewind/rewind-banner.tsx";
import { DashboardLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import {
	TARGET_STATUS,
	TARGET_TONE,
	TargetGap,
} from "#/components/targets.tsx";
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

/** The plot's height in px. The columns, the target rule and the maximum are
 *  all measured against it, so the chart is one number to re-tune. */
const PLOT_H = 76;

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
				// A day that may be judged against the day's worth: a working day
				// that has happened. A future day, a weekend and a public holiday
				// are all simply not asked.
				judged:
					key <= today &&
					weekday !== 0 &&
					weekday !== 6 &&
					!holidays.has(key) &&
					targets.daySeconds > 0,
			};
		},
	);
	const maxDaySeconds = Math.max(
		...perDay.map((d) => d.seconds),
		targets.daySeconds,
		1,
	);
	// Where the dashed "a day's worth" rule sits, in the plot's own pixels.
	const targetPx = Math.round((targets.daySeconds / maxDaySeconds) * PLOT_H);

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
			<RewindBanner orgSlug={organization.slug} today={today} />
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

			{/* Today, the week and the month, in that order: the horizon widens
			    left to right. One band between hairlines, each cell with a thin
			    meter that carries the verdict colour, so the figure never has to. */}
			<StatTiles columns={3} className="mt-1">
				<StatTile
					label="Today"
					percent={
						targets.daySeconds > 0
							? (todayTotal / targets.daySeconds) * 100
							: null
					}
					tone={todayTotal >= targets.daySeconds ? "ok" : "neutral"}
					value={
						<>
							<CountUp value={todayTotal} format={formatReportHours} />
							{targets.daySeconds > 0 && (
								<Of>/ {formatReportHours(targets.daySeconds)}</Of>
							)}
						</>
					}
					caption={
						targets.daySeconds > todayTotal
							? `${formatReportHours(targets.daySeconds - todayTotal)} to go`
							: `${todayEntries.length} ${todayEntries.length === 1 ? "entry" : "entries"}`
					}
				/>
				<StatTile
					label="This week"
					aside={
						weekStatus && (
							<StatusPill tone={TARGET_STATUS[weekStatus].tone}>
								{TARGET_STATUS[weekStatus].label}
							</StatusPill>
						)
					}
					percent={
						targets.week.targetSeconds
							? (weekTotal / targets.week.targetSeconds) * 100
							: null
					}
					tone={weekStatus ? TARGET_TONE[weekStatus] : "neutral"}
					value={
						<>
							<CountUp value={weekTotal} format={formatReportHours} />
							{targets.week.targetSeconds != null && (
								<Of>/ {formatReportHours(targets.week.targetSeconds)}</Of>
							)}
						</>
					}
					caption={<TargetGap period={targets.week} />}
				/>
				<StatTile
					label="This month"
					aside={
						monthStatus && (
							<StatusPill tone={TARGET_STATUS[monthStatus].tone}>
								{TARGET_STATUS[monthStatus].label}
							</StatusPill>
						)
					}
					percent={
						targets.month.targetSeconds
							? (targets.month.totalSeconds / targets.month.targetSeconds) * 100
							: null
					}
					tone={monthStatus ? TARGET_TONE[monthStatus] : "neutral"}
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
							<TargetGap period={targets.month} /> · day{" "}
							{targets.month.workingDaysElapsed} of {targets.month.workingDays}
						</>
					}
				/>
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
					{/* No negative margins. The rows were full-bleed strips once and
					    kept the bleed after they became cards, so every row hung a
					    padding's width to the left of the heading above it and the
					    ghost row below it. A card aligns with its own column. */}
					<div
						key={selectedDay}
						className="stagger mt-3 flex flex-col border-t border-line"
					>
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
								className="mt-1"
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
					{/* W1: one baseline under the columns, ONE continuous target rule
					    across the whole week rather than seven per-column stubs, and
					    fixed text rows so every label and figure lands on the same y
					    whatever the day holds. The rule is what turns seven bars into
					    a chart: a column either reaches it or it does not.

					    **The whole column is the button**, bar included. The plot used
					    to be an `aria-hidden` block with the buttons under it, so only
					    the label and the figure took a click and the tall, obvious
					    target — the bar — did nothing.

					    The rule and the baseline are one absolutely-positioned layer
					    over the grid rather than something each button draws, because
					    seven stubs are not an axis, and `pointer-events-none` is what
					    keeps them out of the way of the buttons underneath. */}
					<div className="relative mt-4">
						<span
							aria-hidden
							className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-foreground/25"
							style={{ top: `${PLOT_H - targetPx}px` }}
						/>
						<span
							aria-hidden
							className="pointer-events-none absolute inset-x-0 z-10 border-t border-line"
							style={{ top: `${PLOT_H}px` }}
						/>
						<div className="grid grid-cols-7">
							{perDay.map((d, i) => {
								const px =
									d.seconds > 0
										? Math.max(
												Math.round((d.seconds / maxDaySeconds) * PLOT_H),
												3,
											)
										: 2;
								const isSelected = d.key === selectedDay;
								const verdict = d.holiday
									? "warn"
									: !d.judged
										? "none"
										: d.seconds === 0
											? "bad"
											: d.seconds >= targets.daySeconds
												? "ok"
												: "warn";
								return (
									<button
										type="button"
										key={d.key}
										onClick={() => setSelectedDay(d.key)}
										aria-pressed={isSelected}
										aria-label={`${d.label}, ${formatReportHours(d.seconds)}`}
										className={cn(
											"group/day flex flex-col rounded-lg pb-1.5 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/16",
											d.isWeekend && !isSelected && "opacity-45",
										)}
									>
										<span
											className="flex w-full items-end justify-center"
											style={{ height: `${PLOT_H}px` }}
										>
											<span
												className={cn(
													"rise block w-5 rounded-t-[4px]",
													verdict === "warn" && d.holiday
														? "bg-warn/40"
														: verdict === "none"
															? "bg-line"
															: verdict === "bad"
																? "bg-bad"
																: verdict === "ok"
																	? "bg-ok"
																	: "bg-warn",
												)}
												style={{
													height: `${px}px`,
													animationDelay: `${i * 40}ms`,
												}}
											/>
										</span>
										<span
											className={cn(
												"eyebrow mt-2.5",
												// No filled column for the picked day: nothing inside the
												// page is a card. The picked day's label turns purple and
												// today's stays ink.
												d.isToday && "text-foreground",
												isSelected && "text-primary",
											)}
										>
											{d.label}
										</span>
										<span
											className={cn(
												"tnum mt-1.5 text-2xs",
												d.holiday
													? "text-warn"
													: verdict === "none"
														? "text-faint"
														: verdict === "bad"
															? "text-bad"
															: verdict === "ok"
																? "text-ok"
																: "text-warn",
											)}
										>
											{d.holiday
												? "hol."
												: d.seconds > 0
													? formatReportHours(d.seconds)
													: d.judged
														? "—"
														: "\u00a0"}
										</span>
									</button>
								);
							})}
						</div>
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
										<span className="mono shrink-0 text-muted-foreground">
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
										<span className="mono shrink-0 text-muted-foreground">
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
