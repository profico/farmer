import { parseMonthKey } from "@farmer/core/lib/report-period";
import { dayKeyInTz } from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";

import { AbsenceTab } from "#/components/reports/absence-tab.tsx";
import { BudgetBurnTab } from "#/components/reports/budget-burn-tab.tsx";
import { ComplianceTab } from "#/components/reports/compliance-tab.tsx";
import { NotOnInvoiceTab } from "#/components/reports/not-on-invoice-tab.tsx";
import { OvertimeTab } from "#/components/reports/overtime-tab.tsx";
import { searchSchema, TABS, type TabId } from "#/components/reports/search.ts";
import { MonthFramed, TabPending } from "#/components/reports/shared.tsx";
import { TimeTab } from "#/components/reports/time-tab.tsx";
import { UtilizationTab } from "#/components/reports/utilization-tab.tsx";
import { VarianceTab } from "#/components/reports/variance-tab.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
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

function ReportsPage() {
	const orgSlug = useOrgSlug();
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const { data: access } = useSuspenseQuery(myAccessQuery(orgSlug));

	const today = dayKeyInTz(new Date(), organization.timezone);
	const thisMonth = today.slice(0, 7);
	const month = search.month ?? thisMonth;
	const period = parseMonthKey(month);

	const visibleTabs = TABS.filter((t) => !t.adminOnly || access.isAdmin);
	// A tab this person can't see is treated as if it weren't asked for: the
	// admin-only ids stay valid search params (an admin's shared link must keep
	// working), so a Team Lead following one would otherwise render a body whose
	// query the service refuses — a blank panel and a 403 in the console.
	const requested = search.tab ?? "time";
	const tab: TabId = visibleTabs.some((t) => t.id === requested)
		? requested
		: "time";
	// Team Lead is the floor: below it there is nothing to show, and letting the
	// page render would just fire a query the service refuses.
	const canSeeAnything = access.isAdmin || access.isLeadSomewhere;

	if (!canSeeAnything) {
		return (
			<Page>
				<PageHeader eyebrow="Reports" title="Nothing here for you" />
				<p className="lede max-w-[62ch]">
					Reports cover a whole project's time, so they're for the people who
					run one. Your own hours are on the timesheet.
				</p>
			</Page>
		);
	}

	return (
		// Eight tables under one strip, all of them at the frame's width — which
		// is sized for exactly this and shared with every other screen, so moving
		// between them never resizes the shell.
		<Page>
			<PageHeader
				eyebrow={formatMonthKey(month)}
				title="Reports"
				className="mb-0"
			/>

			<div className="mt-6 overflow-x-auto">
				<SegmentedControl>
					{visibleTabs.map((t) => (
						<SegmentedControlItem
							key={t.id}
							active={tab === t.id}
							render={
								<Link
									to="/$orgSlug/reports"
									params={{ orgSlug: organization.slug }}
									// Deliberately drops every other search param: a period or
									// drill-down belongs to the tab it was set on, and carrying
									// a client filter into the Absence report would only ever
									// confuse.
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
			<FadeSwap activeKey={tab} className="mt-6">
				<Suspense key={tab} fallback={<TabPending />}>
					{tab === "time" && (
						<TimeTab
							orgSlug={organization.slug}
							search={search}
							today={today}
							thisMonth={thisMonth}
						/>
					)}
					{tab === "budget" && <BudgetBurnTab />}
					{tab === "overtime" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<OvertimeTab
								orgSlug={organization.slug}
								search={search}
								{...period}
							/>
						</MonthFramed>
					)}
					{tab === "compliance" && <ComplianceTab />}
					{tab === "absence" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<AbsenceTab {...period} />
						</MonthFramed>
					)}
					{tab === "variance" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<VarianceTab {...period} />
						</MonthFramed>
					)}
					{tab === "utilization" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<UtilizationTab {...period} />
						</MonthFramed>
					)}
					{tab === "not-on-invoice" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<NotOnInvoiceTab {...period} />
						</MonthFramed>
					)}
				</Suspense>
			</FadeSwap>
		</Page>
	);
}
