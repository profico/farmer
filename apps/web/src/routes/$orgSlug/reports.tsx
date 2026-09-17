import { parseMonthKey } from "@farmer/core/lib/report-period";
import { dayKeyInTz } from "@farmer/core/lib/time";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";

import { AbsenceTab } from "#/components/reports/absence-tab.tsx";
import { ComplianceTab } from "#/components/reports/compliance-tab.tsx";
import { OvertimeTab } from "#/components/reports/overtime-tab.tsx";
import { searchSchema, TABS, type TabId } from "#/components/reports/search.ts";
import {
	MonthFramed,
	periodLabel,
	TabPending,
} from "#/components/reports/shared.tsx";
import { TimeTab } from "#/components/reports/time-tab.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import { formatMonthKey } from "#/lib/format-date.ts";
import { myAccessQuery } from "#/queries/access.ts";

// The shell only: the route, the tab strip, and which tab is allowed to render.
//
// The eight report bodies live one per file in `components/reports/`, with the
// period controls and the shared table in `shared.tsx` and the search schema in
// `search.ts`. They were all in this file — 1839 lines and about twenty
// components, of which the routing concern above was forty. Eight independent
// screens that happen to share a period picker are eight modules; keeping them
// in one meant every edit to the Absence table loaded the Time drill-down, and
// the one thing a reader comes to a route file for — what this URL renders —
// was the smallest thing in it.

export const Route = createFileRoute("/$orgSlug/reports")({
	validateSearch: searchSchema,
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await context.queryClient.ensureQueryData(myAccessQuery(orgSlug));
	},
	component: ReportsPage,
});

/** The tabs in the order the strip draws them, so a swap knows which way the
 *  reader moved along it. */
const TAB_ORDER = TABS.map((tab) => tab.id);

function ReportsPage() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();

	const today = dayKeyInTz(new Date(), organization.timezone);
	const thisMonth = today.slice(0, 7);
	const month = search.month ?? thisMonth;
	const period = parseMonthKey(month);

	// Every tab for everyone: the services scope each report to what the
	// caller may see (§4 matrix), and a Member's report is their own row.
	const visibleTabs = TABS;
	const requested = search.tab ?? "time";

	const tab: TabId = visibleTabs.some((t) => t.id === requested)
		? requested
		: "time";

	return (
		// Eight tables under one strip, all of them at the frame's width — which
		// is sized for exactly this and shared with every other screen, so moving
		// between them never resizes the shell.
		<Page>
			<PageHeader
				// Tracking is a month; every other report can be a week, a quarter
				// or a year. Either way the eyebrow says which.
				eyebrow={
					tab === "compliance"
						? formatMonthKey(month)
						: periodLabel(search, today, organization.weekStartsOn)
				}
				title="Reports"
				// The report tabs sit on the eyebrow row, where every other screen
				// keeps its one control, rather than as a strip of their own under
				// the title — a screen that already has two rows of controls below
				// the title had no room for a third.
				action={
					<div className="overflow-x-auto">
						<SegmentedControl>
							{visibleTabs.map((t) => (
								<SegmentedControlItem
									key={t.id}
									active={tab === t.id}
									render={
										<Link
											to="/$orgSlug/reports"
											params={{ orgSlug: organization.slug }}
											// Deliberately drops every other search param: a period
											// or drill-down belongs to the tab it was set on, and
											// carrying a client filter into the Absence report would
											// only ever confuse.
											search={{ tab: t.id, month: search.month }}
											aria-current={tab === t.id ? "page" : undefined}
										/>
									}
								>
									{t.label}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>
				}
			/>

			{/* Every tab body reads its data with `useSuspenseQuery` and the route
			    loader only prefetches `myAccess`, so the first visit to a tab always
			    suspends. Without a boundary here that suspension escapes to the
			    router's own `defaultPendingComponent`, which swaps out the entire
			    route — header, tab strip and all — for `RoutePending`, held for at
			    least `defaultPendingMinMs`. It read exactly like a full page reload
			    on every first tab click. Keeping the boundary local means only the
			    panel below the tabs is replaced, and the tabs stay put and stay
			    clickable while it loads.

			    Keyed by tab so switching tabs re-suspends this boundary rather than
			    reusing the previous tab's resolved content.

			    `FadeSwap` sits *outside* the boundary on purpose: keyed on the same
			    tab, it crossfades one panel into the next, and the spinner-to-table
			    step inside stays uncrossfaded — that one is a sub-second wait on a
			    panel you are already looking at, and fading it would just make the
			    data land later than it actually did.

			    This one only covers the *first* render of a tab. Every control that
			    changes what a tab shows — the month stepper, the period preset, the
			    Clients/Projects/Teammates grouping, the drill-down filters — is
			    rendered outside a nested boundary of its own, so moving one replaces
			    the figures it changes and nothing else. A control that vanishes into
			    the skeleton it just triggered can't be clicked twice in a row. */}
			{/* The control that changes this is a horizontal segmented strip, so the
			    panel leaves the way the strip went — pressing a segment to the
			    right sends the content left. `order` is what lets the swap know
			    which way that was. */}
			<FadeSwap activeKey={tab} order={TAB_ORDER} className="mt-6">
				<Suspense key={tab} fallback={<TabPending />}>
					{tab === "time" && (
						<TimeTab
							orgSlug={organization.slug}
							search={search}
							today={today}
							thisMonth={thisMonth}
						/>
					)}
					{tab === "overtime" && (
						<OvertimeTab
							orgSlug={organization.slug}
							search={search}
							today={today}
							thisMonth={thisMonth}
						/>
					)}
					{tab === "compliance" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<ComplianceTab {...period} />
						</MonthFramed>
					)}
					{tab === "absence" && (
						<AbsenceTab
							orgSlug={organization.slug}
							search={search}
							today={today}
							thisMonth={thisMonth}
						/>
					)}
				</Suspense>
			</FadeSwap>
		</Page>
	);
}
