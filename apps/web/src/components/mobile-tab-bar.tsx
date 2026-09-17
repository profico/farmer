import { DotsThreeIcon, SignOutIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";

import { PersonAvatar } from "#/components/person-avatar.tsx";
import { settingsNavGroups } from "#/components/settings-nav.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { useMediaQuery } from "#/hooks/use-media-query.ts";
import { useUnfiledCount } from "#/hooks/use-unfiled-count.ts";
import { authClient } from "#/lib/auth-client.ts";
import { springExpressive } from "#/lib/motion.ts";
import {
	activeNavTo,
	mobileWorkItems,
	type NavItem,
	REPORTS_ITEM,
	YOU_ITEMS,
} from "#/lib/nav-items.ts";
import { cn } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";

export function MobileTabBar({
	orgSlug,
	isAdmin,
	isPlatformAdmin,
	userName,
	userEmail,
	userImage,
	assistantAvailable,
	timezone,
}: {
	orgSlug: string;
	isAdmin: boolean;
	/** See the same prop on `AppSidebar`. */
	isPlatformAdmin: boolean;
	userName: string;
	userEmail: string;
	/** Off the session — see the same prop on `AppSidebar`. */
	userImage: string | null;
	/** Deployment flag AND connected AND not paused — resolved in the layout
	 *  route. See the same prop on `AppSidebar`. */
	assistantAvailable: boolean;
	/** The organization's timezone — see the same prop on `AppSidebar`. */
	timezone: string;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });
	const router = useRouter();
	const posthog = usePostHog();
	const [moreOpen, setMoreOpen] = useState(false);

	// Narrow phones (iPhone SE/mini-class) only comfortably fit 3 tabs + More;
	// give regular-and-up phones a 4th before anything overflows into More.
	const hasRoomForFourth = useMediaQuery("(min-width: 380px)");
	const primaryCount = hasRoomForFourth ? 4 : 3;
	// Not the same list as the sidebar's: there the assistant is the Chat tab
	// rather than a row, and a phone has no such tabs. See mobileWorkItems.
	const items = mobileWorkItems(assistantAvailable);
	const primaryItems = items.slice(0, primaryCount);
	const overflowWorkItems = items.slice(primaryCount);

	// Same rationale as AppSidebar: not a suspense query. Clients are gated on
	// a per-project lead role, which the org role can't tell us.
	const { data: access } = useQuery(myAccessQuery(orgSlug));
	const canManageClients = isAdmin || !!access?.isLeadSomewhere;

	// The sheet carries the sidebar's groups rather than one flat run of rows.
	// It was up to eleven undifferentiated links, which is the phone showing
	// less structure than the desktop for exactly the same nav — and the place
	// where a person is most likely to be hunting rather than aiming.
	const groups: { label: string; items: NavItem[] }[] = [
		{
			label: "Work",
			items: [
				...overflowWorkItems,
				// Reports are for everyone: scoped by the services, a Member sees
				// their own row.
				REPORTS_ITEM,
			],
		},
		// Settings, then everything behind it, in the hub's own groups — the
		// same catalogue the sidebar's sub-menu draws (`settingsNavGroups`), so a
		// phone reaches every settings page in the order a desktop lists them.
		// Before this the sheet showed "You" and "Manage", which were four of the
		// twelve; the other eight were two taps away behind the hub.
		{ label: "Settings", items: YOU_ITEMS },
		...settingsNavGroups({ isAdmin, canManageClients, isPlatformAdmin }).map(
			(group) => ({ label: group.label, items: group.items }),
		),
	].filter((group) => group.items.length > 0);

	const moreItems = groups.flatMap((group) => group.items);

	// One resolution over every row the bar can reach, primary and overflow
	// alike: the Settings hub is a URL prefix of every row listed under it, so
	// asked row by row it lights two at once. See `activeNavTo`.
	const activeTo = activeNavTo(
		pathname,
		[...primaryItems, ...moreItems],
		orgSlug,
	);

	const isMoreActive = moreItems.some((item) => item.to === activeTo);

	// Unattributed time, on the tab that leads to the screen that files it —
	// the same count and the same fetch as the sidebar's.
	const unfiledCount = useUnfiledCount(orgSlug, timezone);

	const handleLogout = async () => {
		setMoreOpen(false);
		await authClient.signOut();
		posthog.reset();
		await router.invalidate();
	};

	return (
		<>
			<nav
				data-slot="mobile-tab-bar"
				className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(0.75rem+var(--safe-b))] md:hidden"
			>
				{/* One lift, the design's only one. The bar floats over the page, so it is
				    the single element in the app entitled to a shadow. */}
				<div className="flex h-16 items-center gap-1 rounded-full border bg-background p-1.5 shadow-lift">
					{primaryItems.map((item) => {
						const active = item.to === activeTo;
						const badge = item.to === "/$orgSlug/time" ? unfiledCount : 0;

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
									"relative flex h-full w-16 flex-col items-center justify-center gap-0.5 rounded-full transition-transform duration-(--dur-fast) active:scale-[0.97]",
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
								{/* The badge hangs off the icon rather than the label,
								    which is 10px and already truncates. It carries its own
								    ground so it stays legible over the active pill. */}
								<span className="relative">
									<item.icon className="size-[21px]" />
									{badge > 0 && (
										<span className="absolute -top-1 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full border bg-background px-1 text-[10px] leading-none font-medium text-muted-foreground tabular-nums">
											{badge > 99 ? "99+" : badge}
										</span>
									)}
								</span>
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
							"relative flex h-full w-16 flex-col items-center justify-center gap-0.5 rounded-full transition-transform duration-(--dur-fast) active:scale-[0.97]",
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

			<Drawer open={moreOpen} onOpenChange={setMoreOpen}>
				<DrawerContent className="max-h-[calc(80*var(--svh))] pb-[calc(0.75rem+var(--safe-b))]">
					{/* Left-aligned on the rows' own gutter — a centred label over a
					    left-aligned list is the one thing on the sheet that doesn't
					    line up with anything. */}
					<DrawerHeader className="shrink-0 px-5 pt-2.5 pb-0">
						<DrawerTitle>More</DrawerTitle>
						<DrawerDescription className="sr-only">
							Additional navigation and account options.
						</DrawerDescription>
					</DrawerHeader>
					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1">
						{groups.map((group) => (
							<div key={group.label} className="flex flex-col gap-1 pb-2">
								{/* The same eyebrow the sidebar's groups carry, so the two
								    navs read as one nav seen at two widths. */}
								<div className="eyebrow px-3 pt-2 pb-1">{group.label}</div>
								{group.items.map((item) => {
									const active = item.to === activeTo;

									return (
										<Link
											key={item.to}
											to={item.to}
											params={{ orgSlug }}
											onClick={() => setMoreOpen(false)}
											className={cn(
												// `transition-colors` does not cover `transform`, so the
												// press scale below was snapping in and out with no
												// easing at all. The two primary tab rows above get this
												// right; this row in the More sheet did not.
												"flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-base transition-[background-color,color,transform] duration-(--dur-fast) active:scale-[0.97]",
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
						))}
					</div>
					<div className="mt-1 flex shrink-0 items-center gap-2.5 border-t px-4 pt-3">
						<PersonAvatar name={userName} image={userImage} />
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
				</DrawerContent>
			</Drawer>
		</>
	);
}
