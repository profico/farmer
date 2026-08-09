import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
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
		<div className="flex h-[calc(100svh-var(--mobile-nav-h))] flex-col p-4 sm:p-8">
			<div className="flex shrink-0 items-center gap-3.5">
				<h1 className="font-display text-xl">Time</h1>
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
			<div className="mt-5 flex min-h-0 flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
