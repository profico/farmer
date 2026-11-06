import { formatReportHours } from "@farmer/core/lib/report-format";
import {
	formatDayKey,
	startOfWeekKey,
	addDaysToKey,
	dayKeyInTz,
	timeKeyInTz,
} from "@farmer/core/lib/time";
import { ArrowRightIcon, PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";

import { AutoTrackNag } from "#/components/auto-track-nag.tsx";
import { GithubReconnectBanner } from "#/components/github-reconnect-banner.tsx";
import { AutoTrackedList } from "#/components/org-home/auto-tracked.tsx";
import { SelectedDayEntries } from "#/components/org-home/day-entries.tsx";
import { OrgHomeStatBand } from "#/components/org-home/stat-band.tsx";
import { WeekChart } from "#/components/org-home/week-chart.tsx";
import { RewindBanner } from "#/components/rewind/rewind-banner.tsx";
import { DashboardLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { AssembleDayDialog } from "#/components/time/assemble-day-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useTimedEntryId } from "#/hooks/use-timer.ts";
import { useToday } from "#/hooks/use-today.ts";
import {
	buildWeekChart,
	greetingForHour,
	resolveSelectedDay,
	sumSeconds,
	summarizeAutoTracked,
} from "#/lib/org-home.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import {
	timeEntriesRangeQuery,
	WARM_RANGE_GC_MS,
} from "#/queries/time-entries.ts";

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
			context.queryClient.ensureQueryData(myTargetsQuery(orgSlug, today)),
			context.queryClient.ensureQueryData(
				holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
			),
		]);

		// The next week and its holidays, warmed but NOT awaited. A prefetch has no
		// observer, so the long gcTime keeps it for a tab that stays open until
		// the week ends. With the default 5 minutes it would be gone by then.
		const nextStart = addDaysToKey(weekStart, 7);
		const nextEnd = addDaysToKey(nextStart, 6);
		void context.queryClient.prefetchQuery({
			...timeEntriesRangeQuery(orgSlug, nextStart, nextEnd),
			gcTime: WARM_RANGE_GC_MS,
		});
		void context.queryClient.prefetchQuery({
			...holidaysForRangeQuery(orgSlug, { from: nextStart, to: nextEnd }),
			gcTime: WARM_RANGE_GC_MS,
		});
	},
	// The generic page placeholder is a header over a ruled list, which is the
	// shape of most screens here and not of this one — it put four ragged lines
	// where the three figures and the week's bars were about to land.
	pendingComponent: DashboardLoadingSkeleton,
	component: OrgHome,
});

function OrgHome() {
	const orgSlug = useOrgSlug();
	const { organization, session } = Route.useRouteContext();
	// Live, so a tab left open past midnight moves to the new day by itself.
	// The whole page reads the deferred value, so its figures, bars and marks
	// all come from one day. A new day can be a new week, whose range is not in
	// the cache. The live value would show the pending state at once and, with
	// no network, the error page. The deferred render suspends in the
	// background and the old day stays on screen until the new week loads.
	const today = useDeferredValue(useToday(organization.timezone));
	const weekStart = startOfWeekKey(today, organization.weekStartsOn);
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: weekEntries } = useSuspenseQuery(
		timeEntriesRangeQuery(orgSlug, weekStart, weekEnd),
	);
	// The two yardsticks are the fund rule, read for this person: the week and
	// the month, each with where they should be by today.
	const { data: targets } = useSuspenseQuery(myTargetsQuery(orgSlug, today));
	const { data: holidayEntries } = useSuspenseQuery(
		holidaysForRangeQuery(orgSlug, { from: weekStart, to: weekEnd }),
	);
	const holidays = new Map(holidayEntries);
	const timedEntryId = useTimedEntryId(orgSlug);

	// The "by day" bars are clickable; the day the user picks drives the entry
	// list beside them. Null means today, so a pick-less page follows the day. A
	// pick outside the week on screen (the week moved on at midnight) is dropped.
	const [pickedDay, setSelectedDay] = useState<string | null>(null);
	const selectedDay = resolveSelectedDay(pickedDay, weekStart, weekEnd, today);

	const todayEntries = weekEntries.filter((entry) => entry.date === today);
	const todayTotal = sumSeconds(todayEntries);

	const selectedEntries = weekEntries.filter(
		(entry) => entry.date === selectedDay,
	);
	const selectedTotal = sumSeconds(selectedEntries);
	const weekTotal = sumSeconds(weekEntries);

	// Per-weekday totals, in the org's week order, for the bars — derived from
	// the same week query, so it costs no extra fetch.
	const { perDay, maxDaySeconds, targetPx } = buildWeekChart({
		entries: weekEntries,
		weekStart,
		weekStartsOn: organization.weekStartsOn,
		today,
		daySeconds: targets.daySeconds,
		holidays,
	});

	const autoTracked = summarizeAutoTracked(todayEntries);
	const firstName = session.user.name.split(" ")[0];
	// The org's hour, not the machine's: the server renders this text first,
	// and an hour from its own clock is a hydration mismatch.
	const hour = Number(
		timeKeyInTz(new Date(), organization.timezone).slice(0, 2),
	);

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
				title={`${greetingForHour(hour)}, ${firstName}`}
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
							// The day picked in the chart, which the list below shows: a
							// person who picks Thursday and presses this means Thursday.
							defaultDate={selectedDay}
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
			<OrgHomeStatBand
				daySeconds={targets.daySeconds}
				week={targets.week}
				month={targets.month}
				todayTotal={todayTotal}
				todayEntryCount={todayEntries.length}
				weekTotal={weekTotal}
			/>

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
					<SelectedDayEntries
						entries={selectedEntries}
						total={selectedTotal}
						selectedDay={selectedDay}
						today={today}
						timezone={organization.timezone}
						timedEntryId={timedEntryId}
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
					<WeekChart
						perDay={perDay}
						selectedDay={selectedDay}
						maxDaySeconds={maxDaySeconds}
						targetPx={targetPx}
						onSelect={setSelectedDay}
					/>

					<AutoTrackedList summary={autoTracked} />

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
