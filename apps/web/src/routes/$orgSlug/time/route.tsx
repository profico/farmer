import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useRouterState,
} from "@tanstack/react-router";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
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
	// is clicked (responsive), while the FadeSwap keys on the *resolved* location
	// so the crossfade only fires once the new view's loader has committed —
	// otherwise the transition plays out against the still-old Outlet and the new
	// content blinks in unanimated after it lands.
	const pathname = useLocation({ select: (location) => location.pathname });
	const resolvedPathname = useRouterState({
		select: (state) =>
			state.resolvedLocation?.pathname ?? state.location.pathname,
	});

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
										viewTransition={false}
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
			<FadeSwap
				activeKey={resolvedPathname}
				className="mt-5 flex min-h-0 flex-1 flex-col"
			>
				<Outlet />
			</FadeSwap>
		</div>
	);
}
