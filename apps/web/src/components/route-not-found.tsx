import {
	CaretRightIcon,
	ChartLineIcon,
	ClockIcon,
	FolderIcon,
	HouseIcon,
	LinkSimpleIcon,
} from "@phosphor-icons/react";
import { Link, useLocation, useParams } from "@tanstack/react-router";

import { ErrorCard, ErrorScreen } from "#/components/error-screen.tsx";
import { FeedbackButton } from "#/components/feedback-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useInsideSidebar } from "#/components/ui/sidebar.tsx";

const JUMPS = [
	{ to: "/$orgSlug", label: "Today", Icon: ClockIcon },
	{ to: "/$orgSlug/projects", label: "Projects", Icon: FolderIcon },
	{ to: "/$orgSlug/reports", label: "Reports", Icon: ChartLineIcon },
] as const;

/**
 * App-wide fallback for `defaultNotFoundComponent`. Shown for unmatched
 * routes and explicit `notFound()` throws from loaders, both inside the
 * workspace layout and with no layout at all; `ErrorScreen` draws the frame
 * for each. The card shows the address that failed, so a typo is easy to see.
 */
export function RouteNotFound() {
	const inside = useInsideSidebar();
	const { orgSlug } = useParams({ strict: false });
	const pathname = useLocation({ select: (location) => location.pathname });
	const workspace = inside && orgSlug;
	return (
		<ErrorScreen>
			<ErrorCard
				title="Nothing at this address"
				actions={
					<>
						{!workspace && (
							<Button
								variant="outline"
								nativeButton={false}
								render={
									<Link to="/">
										<HouseIcon aria-hidden />
										Home
									</Link>
								}
							/>
						)}
						<FeedbackButton label="Report a broken link" />
					</>
				}
				after={
					workspace && (
						<nav aria-label="Pages" className="grid border-t">
							{JUMPS.map(({ to, label, Icon }) => (
								<Link
									key={to}
									to={to}
									params={{ orgSlug: workspace }}
									className="flex items-center gap-3 border-t px-7 py-3 text-sm first:border-t-0 hover:bg-muted"
								>
									<Icon
										size={17}
										className="text-muted-foreground"
										aria-hidden
									/>
									{label}
									<CaretRightIcon
										size={14}
										className="ml-auto text-muted-foreground"
										aria-hidden
									/>
								</Link>
							))}
						</nav>
					)
				}
			>
				<p className="mt-1.5 flex min-w-0 items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 font-mono text-[13px]">
					<LinkSimpleIcon
						size={14}
						className="shrink-0 text-muted-foreground"
						aria-hidden
					/>
					<span className="truncate">{pathname}</span>
				</p>
				<p className="mt-1.5 text-sm text-muted-foreground">
					{workspace
						? "Check the address for a typo, or go to one of these pages."
						: "Check the address for a typo."}
				</p>
			</ErrorCard>
		</ErrorScreen>
	);
}
