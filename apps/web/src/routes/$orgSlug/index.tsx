import { weekDayMarks } from "@farmer/core/lib/day-marks";
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
import { GithubReconnectBanner } from "#/components/github-reconnect-banner.tsx";
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
import { GhostRow } from "#/components/ui/ghost-row.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { Of, StatTile, StatTiles } from "#/components/ui/stat-tile.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useTimedEntryId } from "#/hooks/use-timer.ts";
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

/** The week chart's plot height in px. The columns, the target rule and the
 *  maximum are all measured against it, so the chart is one number to re-tune. */
const PLOT_H = 76;

function greetingForHour(hour: number): string {
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

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
	const timedEntryId = useTimedEntryId(orgSlug);

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
	const selectedTotal = selectedEntries.reduce(
		(sum, e) => sum + e.durationSeconds,
		0,
	);
	const weekTotal = weekEntries.reduce((sum, e) => sum + e.durationSeconds, 0);

	// Per-weekday totals, in the org's week order, for the bars — derived from
	// the same week query, so it costs no extra fetch.
	const secondsByDay = new Map<string, number>();
	for (const entry of weekEntries) {
		secondsByDay.set(
			entry.date,
			(secondsByDay.get(entry.date) ?? 0) + entry.durationSeconds,
		);
	}
	const weekDays = orderedWeekdays(organization.weekStartsOn).map(
		({ day: weekday, label }, i) => ({
			weekday,
			label,
			key: addDaysToKey(weekStart, i),
		}),
	);
	// The same marks the timesheet's week strip draws, so a day the week has
	// made up for is never amber here and quiet there. A day with no mark is
	// not judged: a future day, a weekend and a public holiday are simply not
	// asked.
	const marks =
		targets.daySeconds > 0
			? weekDayMarks({
					dates: weekDays.map((d) => d.key),
					secondsByDay,
					holidays,
					today,
					daySeconds: targets.daySeconds,
				})
			: null;
	const perDay = weekDays.map(({ weekday, label, key }) => ({
		label,
		key,
		seconds: secondsByDay.get(key) ?? 0,
		isToday: key === today,
		isWeekend: weekday === 0 || weekday === 6,
		holiday: holidays.get(key),
		mark: marks?.get(key),
	}));
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

	// `flex flex-col` on the page: it is what lets the body grid below claim the
	// height the header and the band leave, and so what lets the rule between
	// its two columns run to the island's own bottom edge rather than stopping
	// under the last entry.
	return (
		<Page className="flex flex-col">
			<GithubReconnectBanner orgSlug={organization.slug} />
			<AutoTrackNag orgSlug={organization.slug} />
			<RewindBanner orgSlug={organization.slug} today={today} />
			<PageHeader
				eyebrow={formatDayKey(today)}
				title={`${greetingForHour(new Date().getHours())}, ${firstName}`}
				action={
					<div className="flex items-center gap-2">
						{/* The same dialog the timesheet opens, on the screen people
						    land on. Assembling a day is a morning job, and the morning
						    is when this page is open. */}
						<AssembleDayDialog
							orgSlug={orgSlug}
							date={today}
							trigger={
								<Button variant="outline" size="sm">
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
			    to right, the full width of the page. It used to be a 26rem column
			    holding two `Metric`s and two `TargetBlock`s, so today's figure was
			    said in the eyebrow, again at 30px and again inside a rail — the
			    screen answered "how am I doing" four times and never once at a
			    glance. */}
			<StatTiles columns={3}>
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
							{formatReportHours(todayTotal)}
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
							{formatReportHours(weekTotal)}
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
							{formatReportHours(targets.month.totalSeconds)}
							{targets.month.targetSeconds != null && (
								<Of>/ {formatReportHours(targets.month.targetSeconds)}</Of>
							)}
						</>
					}
					caption={
						<>
							<TargetGap period={targets.month} /> ·{" "}
							{targets.month.workingDaysElapsed} of {targets.month.workingDays}{" "}
							working days done
						</>
					}
				/>
			</StatTiles>

			{/* What you logged, and how the week is shaped. Side by side once the
			    PAGE is wide enough (`@4xl/page`, the container declared on
			    `SidebarInset`): the day bars drive the list beside them, so cause
			    and effect are on one screen. Below that they stack, entries first —
			    on a phone the list is what you came for.

			    The threshold is the page's width rather than the window's because
			    the nav column is not on the page. Split at `lg` on the viewport, a
			    1024px window gave the chart a 250px third column — seven weekday
			    labels drawn over each other — and the list beside it a width where
			    a project name truncated to its code. 896px of PAGE is where the
			    third column reaches 256px, which is what the labels need.

			    **Three columns, matching the band.** The list takes the first two
			    and the chart the third, so the split under the band falls on the
			    band's own division rather than at some width of its own — the week
			    chart sits under "This month", which is the figure it explains.

			    The gutter is 64px because that is the width at which the two
			    grids agree. `StatTiles` bleeds 32px each side and pads each cell
			    32px, so its third cell's text starts at `2W/3 + 128/3` from the
			    content edge; a three-column grid with gutter g starts its third
			    column at `2W/3 + 2g/3`. Those are equal at g = 64, at every
			    width — so "This week by day" sits exactly under "This month"
			    rather than near it. Change the tiles' padding and this number
			    changes with it.

			    **One vertical rule divides them, and it is the band's own rule
			    turned a corner.** It hangs from the hairline that closes the band
			    (`@4xl/page:-mt-7 @4xl/page:pt-7`) and runs to the island's bottom edge
			    (`@4xl/page:-mb-7`, the island's own bottom padding), so the two halves of
			    the screen are separated for their whole height rather than for as
			    far as the shorter one happens to reach. `@4xl/page:-mr-8` widens the left
			    column by half the 64px gutter, which is what puts the rule at the
			    gutter's centre; `@4xl/page:pr-8` pads the text back off it. The chart's
			    baseline and its target rule are axes, not page furniture. */}
			<div className="mt-7 grid gap-x-16 gap-y-8 @4xl/page:flex-1 @4xl/page:grid-cols-3">
				<div className="min-w-0 @4xl/page:col-span-2 @4xl/page:-mt-7 @4xl/page:-mr-8 @4xl/page:-mb-7 @4xl/page:border-r @4xl/page:border-line2 @4xl/page:pt-7 @4xl/page:pr-8 @4xl/page:pb-7">
					<div className="section-head">
						<h2 className="eyebrow">
							{selectedDay === today
								? "Today's entries"
								: formatDayKey(selectedDay, { year: false })}
						</h2>
						<span className="text-sm text-muted-foreground">
							{formatReportHours(selectedTotal)} logged
						</span>
					</div>
					{/* No AnimatePresence — see the note in EntryBlockRow. It matters
					    most here: picking another day in "This week by day" swaps every
					    row at once, so the whole list collapsed as if each entry had
					    been deleted. Switching days is navigation, not removal.

					    The rows keep the island's own padding and take a negative
					    margin of the same size, so the text stays on the column's
					    text edge while the hover fill and the rules between rows run
					    edge to edge — the island's left edge, and the vertical rule
					    on the right. A row highlighted only as far as its text is a
					    row that looks narrower than the list it is in. */}
					<div className="@container/entries mt-3 flex flex-col divide-y divide-line2">
						{selectedEntries.map((entry) => (
							<EntryBlockRow
								key={entry.id}
								entry={entry}
								timezone={organization.timezone}
								timing={entry.id === timedEntryId}
								className="-mx-4 sm:-mx-8"
							/>
						))}
					</div>
					{/* The list ends on the way to add to it, whether or not it has
					    rows: an empty day is a sentence and this same row, rather than
					    a centred placeholder with no action on it. */}
					<AddBlockDialog
						timezone={organization.timezone}
						defaultDate={selectedDay}
						trigger={
							<GhostRow
								className={cn(
									// The same bleed the rows take, so its rule ends where
									// theirs do. The width is spelled out because the row is
									// `w-full`: a negative margin alone moves it left without
									// widening it, and the rule would stop short on the right.
									"-ml-4 w-[calc(100%+2rem)] px-4 sm:-ml-8 sm:w-[calc(100%+4rem)] sm:px-8",
									selectedEntries.length > 0 ? "border-t border-line2" : "mt-1",
								)}
							>
								{selectedEntries.length === 0
									? selectedDay === today
										? "Nothing logged yet. Log your first block of the day"
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
					{/* One baseline under the columns and ONE continuous target rule
					    across the whole week, rather than seven per-column stubs. The
					    rule is what turns seven bars into a chart: a column either
					    reaches it or it does not.

					    **The whole column is the button**, bar included. The plot used
					    to be an `aria-hidden` block with the buttons under it, so only
					    the label and the figure took a click and the tall, obvious
					    target did nothing. The two rules are one absolutely-positioned
					    layer over the grid, and `pointer-events-none` is what keeps
					    them out of the way of the buttons underneath. */}
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
								// A covered day is grey, not amber: the week has made up for
								// it, and a bar still in the week's colours would be the
								// alarm the timesheet strip no longer raises.
								const verdict = d.holiday
									? "warn"
									: d.mark == null
										? "none"
										: d.mark === "done"
											? "ok"
											: d.mark === "covered"
												? "covered"
												: d.seconds === 0
													? "bad"
													: "warn";
								return (
									<button
										type="button"
										key={d.key}
										onClick={() => setSelectedDay(d.key)}
										aria-pressed={isSelected}
										aria-label={`${d.label}, ${formatReportHours(d.seconds)}`}
										// `min-w-0` because a grid item will not shrink below its
										// content by default, and the content here is a three-letter
										// label with tracking on it. Without it a narrow chart did
										// not compress — it overflowed, and seven weekday labels
										// were drawn across each other. The spans truncate for the
										// same reason: past a point the honest answer is "WE…".
										className={cn(
											"flex min-w-0 flex-col rounded-sm pb-1.5 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
											d.isWeekend && !isSelected && "opacity-45",
										)}
									>
										<span
											className="flex w-full items-end justify-center"
											style={{ height: `${PLOT_H}px` }}
										>
											<span
												className={cn(
													"rise block w-5 rounded-t-[2px]",
													verdict === "warn" && d.holiday
														? "bg-warn/40"
														: verdict === "none"
															? "bg-line"
															: verdict === "covered"
																? "bg-line-strong"
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
												"eyebrow mt-2.5 w-full truncate",
												d.isToday && "text-foreground",
												isSelected && "text-primary",
											)}
										>
											{d.label}
										</span>
										<span
											className={cn(
												"mono mt-1.5 w-full truncate text-2xs",
												d.holiday
													? "text-warn"
													: verdict === "none"
														? "text-faint"
														: verdict === "covered"
															? "text-muted-foreground"
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
													: d.mark != null
														? "—"
														: " "}
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
														? `${pullRequestTotal} PR event${pullRequestTotal === 1 ? "" : "s"}`
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
