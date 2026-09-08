import { dayKeyInTz } from "@farmer/core/lib/time";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

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
			{/* Above the tabs' content rather than inside a view, because unfiled time
			    isn't scoped to the day/week/month you happen to be looking at — it's
			    a standing worklist that follows you across all three. */}
			<div className="mt-6 flex min-h-0 flex-1 flex-col">
				<UnfiledEntriesBanner
					todayKey={dayKeyInTz(new Date(), organization.timezone)}
				/>
				<Outlet />
			</div>
		</PageFull>
	);
}
