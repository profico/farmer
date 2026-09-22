import {
	addDaysToKey,
	dayKeyInTz,
	endOfMonthKey,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useSearch,
} from "@tanstack/react-router";

import { TargetsStrip } from "#/components/targets.tsx";
import { UnfiledEntriesBanner } from "#/components/time/unfiled-entries-banner.tsx";
import { PageFull } from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";

export const Route = createFileRoute("/$orgSlug/time")({
	component: TimeLayout,
});

const TABS = [
	{ label: "Day", to: "/$orgSlug/time" as const },
	{ label: "Week", to: "/$orgSlug/time/week" as const },
	{ label: "Month", to: "/$orgSlug/time/month" as const },
];

function TimeLayout() {
	const { organization } = Route.useRouteContext();
	// The active pill tracks the *pending* location so it moves the instant a tab
	// is clicked, before the new view's loader has committed.
	const pathname = useLocation({ select: (location) => location.pathname });
	// The range the person is looking at, for the banner above the views. Each
	// view keeps its own date in the URL (`date`, `weekStart`, `month`), so the
	// layout reads whichever is there; the Day view's banner covers the day's
	// whole week, since that is what the strip above it shows.
	const search = useSearch({ strict: false });
	const todayKey = dayKeyInTz(new Date(), organization.timezone);
	const viewed = (() => {
		if (pathname.endsWith("/time/month")) {
			const month = search.month ?? todayKey.slice(0, 7);
			const from = `${month}-01`;
			return { from, to: endOfMonthKey(from), label: "this month" };
		}
		const anchor = pathname.endsWith("/time/week")
			? (search.weekStart ?? todayKey)
			: (search.date ?? todayKey);
		const from = startOfWeekKey(anchor, organization.weekStartsOn);
		return { from, to: addDaysToKey(from, 6), label: "this week" };
	})();

	return (
		// One island, one width. Day, Week and Month all fill it — previously each
		// view capped itself, so stepping between the three tabs changed the
		// page's width and left Day's rules stopping short of where Week's and
		// Month's did.
		<PageFull className="min-h-0 flex-1">
			<div className="flex shrink-0 flex-wrap items-baseline justify-between gap-3">
				<h1 className="h1">Timesheet</h1>
				<SegmentedControl>
					{TABS.map((tab) => {
						const resolved = tab.to.replace("$orgSlug", organization.slug);
						const active = pathname === resolved;
						return (
							<SegmentedControlItem
								key={tab.to}
								active={active}
								render={
									<Link
										to={tab.to}
										params={{ orgSlug: organization.slug }}
										aria-current={active ? "page" : undefined}
									/>
								}
							>
								{tab.label}
							</SegmentedControlItem>
						);
					})}
				</SegmentedControl>
			</div>
			{/* This week and this month against the rule, on every view — the
			    figure a person is filling the timesheet towards. */}
			<TargetsStrip orgSlug={organization.slug} />
			{/* Above the tabs' content, scoped to the week or month on screen: it is
			    about the time you are looking at, and goes away when that range is
			    clean. The nav badge keeps the wider count, so nothing older is lost
			    from view entirely. */}
			<div className="mt-6 flex min-h-0 flex-1 flex-col">
				<UnfiledEntriesBanner
					range={viewed}
					scopeLabel={viewed.label}
					timezone={organization.timezone}
				/>
				<Outlet />
			</div>
		</PageFull>
	);
}
