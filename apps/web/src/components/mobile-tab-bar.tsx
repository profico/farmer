import { DotsThreeIcon, SignOutIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import {
	ADMIN_ITEMS,
	CLIENTS_ITEM,
	CLOSE_ITEM,
	isNavItemActive,
	mobileWorkspaceItems,
	REPORTS_ITEM,
} from "#/components/app-sidebar.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet.tsx";
import { useMediaQuery } from "#/hooks/use-media-query.ts";
import { authClient } from "#/lib/auth-client.ts";
import { springExpressive } from "#/lib/motion.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";

export function MobileTabBar({
	orgSlug,
	isAdmin,
	userName,
	userEmail,
	assistantEnabled,
}: {
	orgSlug: string;
	isAdmin: boolean;
	userName: string;
	userEmail: string;
	/** `ASSISTANT_ENABLED` on this deployment, from the layout's route context. */
	assistantEnabled: boolean;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });
	const router = useRouter();
	const [moreOpen, setMoreOpen] = useState(false);

	// Narrow phones (iPhone SE/mini-class) only comfortably fit 3 tabs + More;
	// give regular-and-up phones a 4th before anything overflows into More.
	const hasRoomForFourth = useMediaQuery("(min-width: 380px)");
	const primaryCount = hasRoomForFourth ? 4 : 3;
	// Not the same list as the sidebar's: there the assistant is the Chat tab
	// rather than a row, and a phone has no such tabs. See mobileWorkspaceItems.
	const items = mobileWorkspaceItems(assistantEnabled);
	const primaryItems = items.slice(0, primaryCount);
	const moreWorkspaceItems = items.slice(primaryCount);

	// Same rationale as AppSidebar: not a suspense query. The close sheet is
	// gated on a per-project PM role, which the org role can't tell us.
	const { data: access } = useQuery(myAccessQuery(orgSlug));
	const canClose = isAdmin || !!access?.isPmSomewhere;
	const canManageClients = isAdmin || !!access?.isLeadSomewhere;

	const moreItems = [
		...moreWorkspaceItems,
		...(canManageClients ? [CLIENTS_ITEM] : []),
		...(canClose ? [CLOSE_ITEM] : []),
		// Reports are scoped for a PM/TL, not admin-only — same gate as Clients.
		...(canManageClients ? [REPORTS_ITEM] : []),
		...(isAdmin ? ADMIN_ITEMS : []),
	];
	const isMoreActive = moreItems.some((item) =>
		isNavItemActive(pathname, item.to, orgSlug),
	);

	const handleLogout = async () => {
		setMoreOpen(false);
		await authClient.signOut();
		await router.invalidate();
	};

	return (
		<>
			<nav
				data-slot="mobile-tab-bar"
				className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
			>
				{/* One lift, the design's only one. The bar floats over the page, so it is
				    the single element in the app entitled to a shadow. */}
				<div className="flex h-16 items-center gap-1 rounded-full border bg-background p-1.5 shadow-lift">
					{primaryItems.map((item) => {
						const active = isNavItemActive(pathname, item.to, orgSlug);
						return (
							<Link
								key={item.to}
								to={item.to}
								params={{ orgSlug }}
								// Re-tapping the tab you're already on is a no-op — skip
								// the navigation entirely so it doesn't re-run the route's
								// loader for no reason.
								onClick={(e) => active && e.preventDefault()}
								className={cn(
									"relative flex h-full w-16 flex-col items-center justify-center gap-0.5 rounded-full transition-transform active:scale-95",
									active ? "text-primary" : "text-muted-foreground",
								)}
							>
								{active && (
									// One shared layoutId across every tab + the More button →
									// motion springs this pill between tabs on navigation
									// instead of the old static bg-accent class snapping.
									<motion.div
										layoutId="tab-bar-active-pill"
										transition={springExpressive}
										className="absolute inset-0 -z-10 rounded-full bg-muted"
									/>
								)}
								<item.icon className="size-[21px]" />
								<span className="w-full truncate px-0.5 text-center text-[10px] leading-none">
									{item.label}
								</span>
							</Link>
						);
					})}
					<button
						type="button"
						onClick={() => setMoreOpen(true)}
						className={cn(
							"relative flex h-full w-16 flex-col items-center justify-center gap-0.5 rounded-full transition-transform active:scale-95",
							isMoreActive ? "text-primary" : "text-muted-foreground",
						)}
					>
						{isMoreActive && (
							<motion.div
								layoutId="tab-bar-active-pill"
								transition={springExpressive}
								className="absolute inset-0 -z-10 rounded-full bg-muted"
							/>
						)}
						<DotsThreeIcon weight="regular" className="size-[21px]" />
						<span className="text-[10px] leading-none">More</span>
					</button>
				</div>
			</nav>

			<Sheet open={moreOpen} onOpenChange={setMoreOpen}>
				<SheetContent
					side="bottom"
					className="max-h-[80svh] rounded-t-2xl pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
				>
					<div className="absolute top-2 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-line" />
					{/* Left-aligned on the rows' own gutter — a centred label over a
					    left-aligned list is the one thing on the sheet that doesn't
					    line up with anything. */}
					<SheetHeader className="shrink-0 px-5 pt-2.5 pb-0">
						<SheetTitle>More</SheetTitle>
						<SheetDescription className="sr-only">
							Additional navigation and account options.
						</SheetDescription>
					</SheetHeader>
					<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2">
						{moreItems.map((item) => {
							const active = isNavItemActive(pathname, item.to, orgSlug);
							return (
								<Link
									key={item.to}
									to={item.to}
									params={{ orgSlug }}
									onClick={() => setMoreOpen(false)}
									className={cn(
										"flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-base transition-colors duration-(--dur-fast) active:scale-[0.985]",
										active
											? "bg-muted font-medium text-foreground"
											: "text-muted-foreground",
									)}
								>
									<item.icon className="size-4.5" />
									{item.label}
								</Link>
							);
						})}
					</div>
					<div className="mt-1 flex shrink-0 items-center gap-2.5 border-t px-4 pt-3">
						<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] text-xs font-medium">
							{getInitials(userName)}
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate text-base font-medium">{userName}</div>
							<div className="truncate text-xs text-faint">{userEmail}</div>
						</div>
						<ThemeToggle className="p-1" iconClassName="size-4" />
						<button
							type="button"
							onClick={handleLogout}
							title="Log out"
							className="quiet shrink-0 p-1"
						>
							<SignOutIcon className="size-4" />
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
