import {
	ArrowUpRightIcon,
	GithubLogoIcon,
	SignOutIcon,
} from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import {
	Link,
	useLocation,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { ChatRail } from "#/components/assistant/chat-rail.tsx";
import { OrgSwitcher } from "#/components/org-switcher.tsx";
import { PersonAvatar } from "#/components/person-avatar.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { useScrollFade } from "#/components/ui/scroll-fade.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";
import { useUnfiledCount } from "#/hooks/use-unfiled-count.ts";
import { authClient } from "#/lib/auth-client.ts";
import { GITHUB_NEW_ISSUE_URL } from "#/lib/links.ts";
import { springLayout, springProductive } from "#/lib/motion.ts";
import {
	activeNavTo,
	ASSISTANT_ITEM,
	isNavItemActive,
	type NavItem,
	REPORTS_ITEM,
	WORK_ITEMS,
	YOU_ITEMS,
} from "#/lib/nav-items.ts";
import { cn } from "#/lib/utils.ts";

type SidebarTab = "browse" | "chat";

/**
 * The opening used by a row that arrives late and by the settings sub-menu:
 * height and opacity together, or opacity alone for a reader who has asked for
 * less motion.
 *
 * `MotionConfig reducedMotion="user"` (see `__root.tsx`) is the app's only
 * reduced-motion mechanism, and it drops transform, scale and slide. A height
 * animation is none of those, so it is the one piece of motion in the app that
 * would keep unrolling for somebody who asked all of it to stop — hence the
 * only per-component branch on the preference.
 */
function useUnroll(reduced: boolean | null) {
	if (reduced) {
		return {
			initial: { opacity: 0 },
			animate: { opacity: 1 },
			exit: { opacity: 0 },
		};
	}
	return {
		initial: { height: 0, opacity: 0 },
		animate: { height: "auto", opacity: 1 },
		exit: { height: 0, opacity: 0 },
	};
}

/**
 * A `SidebarMenuItem` that opens rather than appears, for the two rows whose
 * visibility depends on a query that resolves after first paint.
 *
 * `overflow-hidden` is what makes it read as the row opening instead of its
 * label spilling out of a 0px box — but the button inside carries a
 * `focus-visible:ring-2` that sits *outside* its border, and this `li` is
 * exactly the button's size, so leaving the clip on permanently would shave the
 * focus ring off two of the fourteen nav rows. It comes off once the row has
 * settled, which is the only moment it was needed.
 */
function EnteringMenuItem({
	onSettled,
	children,
}: {
	/** Called once the row has finished opening. See `lateRowsSettled`. */
	onSettled?: () => void;
	children: React.ReactNode;
}) {
	const [settled, setSettled] = useState(false);
	const { initial, animate } = useUnroll(useReducedMotion());
	return (
		<motion.li
			data-sidebar="menu-item"
			className={cn("group/menu-item relative", !settled && "overflow-hidden")}
			initial={initial}
			animate={animate}
			transition={springProductive}
			onAnimationComplete={() => {
				setSettled(true);
				onSettled?.();
			}}
		>
			{children}
		</motion.li>
	);
}

export function AppSidebar({
	orgSlug,
	organizationName,
	organizationLogo,
	isAdmin,
	userName,
	userEmail,
	userImage,
	singleOrg = false,
	assistantAvailable,
	timezone,
}: {
	orgSlug: string;
	organizationName: string;
	organizationLogo?: string | null;
	isAdmin: boolean;
	userName: string;
	userEmail: string;
	/** Straight off the session rather than through the org directory: this is
	 *  the one face on screen we already hold, and the sidebar paints before any
	 *  query resolves. */
	userImage: string | null;
	singleOrg?: boolean;
	/**
	 * Whether the assistant exists for this reader at all — the deployment flag
	 * AND a connected key AND not paused for this org, resolved once in the
	 * layout route. Deliberately not just `ASSISTANT_ENABLED`: a Chat tab whose
	 * destination explains that it isn't connected is a tab that shouldn't be
	 * there.
	 */
	assistantAvailable: boolean;
	/** The organization's timezone, for the unfiled worklist's "today". */
	timezone: string;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });
	const router = useRouter();
	const navigate = useNavigate();
	const posthog = usePostHog();

	// Which list the sidebar is showing.
	//
	// It FOLLOWS THE ROUTE by default — on the assistant you get your threads,
	// anywhere else you get the nav — with a temporary override so you can peek
	// at the other tab without navigating. The override is cleared by the next
	// navigation, so the tab always settles back to describing where you are
	// rather than becoming a third thing to keep track of.
	const navScrollRef = useRef<HTMLDivElement>(null);
	useScrollFade(navScrollRef);

	const onAssistant = isNavItemActive(pathname, ASSISTANT_ITEM.to, orgSlug);
	const [tabOverride, setTabOverride] = useState<SidebarTab | null>(null);
	// With no assistant there is no second list, so the tab is pinned rather than
	// merely unswitchable — otherwise an admin who pauses it mid-session is left
	// looking at an empty thread rail with no control to leave it by.
	const tab: SidebarTab = !assistantAvailable
		? "browse"
		: (tabOverride ?? (onAssistant ? "chat" : "browse"));
	// oxlint-disable-next-line react-hooks/exhaustive-deps -- it exists to clear the override on navigation, and `pathname` is the navigation
	useEffect(() => {
		setTabOverride(null);
	}, [pathname]);

	// Navigate on mouse *press* rather than the full click (press + release) so
	// the sidebar feels instant. Only one link is ever mid-interaction at a
	// time, so a single shared flag — set on the press we handle, read+cleared on
	// the trailing click — is enough to swallow that click's duplicate navigation.
	const swallowClickRef = useRef(false);

	// Navigation happens on the press, for every row and sub-row alike: a nav
	// that waits for the release feels slower than the one beside it, and two
	// lists that look the same must answer the same way.
	const pressToNavigate = (item: NavItem, isActive: boolean) => ({
		onMouseDown: (e: React.MouseEvent) => {
			swallowClickRef.current = false;
			// Only fast-path a plain primary-button press. Modifier / middle
			// clicks fall through so the browser can open a new tab; keyboard
			// activation has no mousedown and navigates on click below.
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
				return;
			// This press owns the interaction, so its click is a duplicate.
			swallowClickRef.current = true;
			// Re-pressing the tab you're on stays a no-op (matches onClick).
			if (!isActive) navigate({ to: item.to, params: { orgSlug } });
		},
		onClick: (e: React.MouseEvent) => {
			// A mouse press already navigated on mousedown — swallow its click
			// so we don't navigate twice. Keyboard Enter reaches here with no
			// preceding mousedown (flag false) and navigates normally, except
			// on the active tab, which stays a no-op.
			if (swallowClickRef.current || isActive) e.preventDefault();
			swallowClickRef.current = false;
		},
	});

	const navLink = (item: NavItem, isActive: boolean, badge?: number) => (
		<Link
			to={item.to}
			params={{ orgSlug }}
			// `data-active:*` on the shared button variant paints the pill directly
			// on whichever row is active, which means the pill blinks off one row and
			// on at another. Neutralised here so the shared-layout span below can
			// draw it instead and carry it between rows. This is the only consumer of
			// SidebarMenuButton, so nothing else is affected.
			className="data-active:bg-transparent data-active:shadow-none"
			{...pressToNavigate(item, isActive)}
		>
			{/* The active pill, as a shared element rather than a background on the
			    row — so moving between destinations slides it down the nav instead
			    of blinking it out here and in there. Same spring as the
			    SegmentedControl pill; `reducedMotion="user"` on the root
			    <MotionConfig> makes it jump instead of glide.

			    First child, with the icon and label made `relative` so they paint
			    over it — cheaper than a wrapper. The label used to lean on the
			    variant's `[&>span:last-child]:truncate`; a row with a badge has a
			    later span than the label, so it carries `truncate` itself now. */}
			{isActive && (
				<motion.span
					aria-hidden
					layoutId="sidebar-active-nav"
					transition={springLayout}
					className="absolute inset-0 rounded-[10px] bg-sidebar-accent"
				/>
			)}
			<item.icon className="relative size-4" />
			<span className="relative min-w-0 flex-1 truncate">{item.label}</span>
			{/* A count, not a dot: how much unattributed time is waiting decides
			    whether you deal with it now, and "some" does not. Quiet rather than
			    the loud `default` badge — this is a standing worklist that is
			    normally non-empty, so a red-adjacent fill on it would be permanent
			    alarm rather than information. */}
			{badge !== undefined && badge > 0 && (
				<Badge
					variant="secondary"
					className="relative h-5 min-w-5 px-1.5 text-2xs tabular-nums"
				>
					{badge > 99 ? "99+" : badge}
				</Badge>
			)}
		</Link>
	);

	const navRow = (item: NavItem) => {
		const isActive = activeTo === item.to;
		return (
			<SidebarMenuItem key={item.to}>
				<SidebarMenuButton
					isActive={isActive}
					render={navLink(item, isActive, badgeFor(item))}
				/>
			</SidebarMenuItem>
		);
	};

	// Clients and Reports are gated on `myAccess`, which is a plain
	// `useQuery` (see below) — so unlike every other row they arrive a moment
	// after the sidebar has already painted, popping in at the end of Workspace
	// and knocking the whole Admin group down a notch. These two open instead.
	//
	// That is ONE moment, though, and the rows live inside the swapped panel:
	// every return to the Browse tab remounts them, so without this latch three
	// row heights spring open again underneath a crossfade that has already
	// faded them in. The latch sits on the sidebar, which the swap never
	// unmounts, and flips on the animation's own completion rather than on the
	// query resolving — an unrelated re-render landing mid-flight would
	// otherwise snap the rows to full height halfway through.
	const lateRowsSettled = useRef(false);
	const lateNavRow = (item: NavItem) => {
		const isActive = activeTo === item.to;
		const button = (
			<SidebarMenuButton
				isActive={isActive}
				render={navLink(item, isActive, badgeFor(item))}
			/>
		);
		return lateRowsSettled.current ? (
			<SidebarMenuItem key={item.to}>{button}</SidebarMenuItem>
		) : (
			<EnteringMenuItem
				key={item.to}
				onSettled={() => {
					lateRowsSettled.current = true;
				}}
			>
				{button}
			</EnteringMenuItem>
		);
	};

	// The gated rows, resolved once: the render needs them twice over (which
	// group draws which row, and which row the path belongs to) and they must be
	// the same answer both times.
	// Reports are for everyone — the services scope them, a Member sees their
	// own row — so the item is not gated.
	const lateWorkItems = [REPORTS_ITEM];

	// Settings is a plain row like every other, and the pages behind it live on
	// the hub it leads to.
	//
	// It was a disclosure: the row opened a sub-menu of all twelve settings
	// pages under it. That made one row in a five-row nav taller than the rest
	// of the nav put together, and it put the same twelve destinations in two
	// places — the menu and the hub — which is the duplication the hub exists to
	// remove. The hub is one click away and lists them with a sentence each,
	// which a nav row cannot do.
	const activeTo = activeNavTo(
		pathname,
		[...WORK_ITEMS, ...lateWorkItems, ...YOU_ITEMS],
		orgSlug,
	);

	// Unattributed time, on the row that leads to the screen that files it.
	// Everything the sync engines write lands project-less, so this is the one
	// number in the app that grows while nobody is looking at it.
	const unfiledCount = useUnfiledCount(orgSlug, timezone);
	const badgeFor = (item: NavItem) =>
		item.to === "/$orgSlug/time" ? unfiledCount : undefined;

	const handleLogout = async () => {
		await authClient.signOut();
		posthog.reset();
		await router.invalidate();
	};

	return (
		<Sidebar
			collapsible="none"
			// Sticks to the top of the frame rather than the viewport, and stops a
			// frame-padding short of the bottom, so the island keeps ground visible
			// on all four sides as the page scrolls past it.
			className="sticky top-(--frame-pad) hidden h-[calc(100svh-2*var(--frame-pad))] md:flex"
		>
			<SidebarHeader className="shrink-0 gap-2.5 p-2.5">
				<OrgSwitcher
					orgSlug={orgSlug}
					organizationName={organizationName}
					organizationLogo={organizationLogo}
					singleOrg={singleOrg}
				/>
				{assistantAvailable && (
					<SegmentedControl className="w-full">
						{/* Browse only switches the list — you may want the nav while
						    staying in a conversation. */}
						<SegmentedControlItem
							active={tab === "browse"}
							onClick={() => setTabOverride("browse")}
							className="flex-1"
						>
							Browse
						</SegmentedControlItem>
						{/* Chat is a destination, because it is now the ONLY door to the
						    assistant. Navigating only when you aren't already there keeps
						    it from throwing away the thread you have open. */}
						<SegmentedControlItem
							active={tab === "chat"}
							onClick={() => {
								setTabOverride("chat");
								if (!onAssistant) {
									navigate({
										to: "/$orgSlug/assistant",
										params: { orgSlug },
										search: {},
									});
								}
							}}
							className="flex-1"
						>
							Chat
						</SegmentedControlItem>
					</SegmentedControl>
				)}
			</SidebarHeader>
			{/* Same fade as the page beside it. It earns its keep on the Chat tab,
			    where the thread list is as long as your history — but it is the nav's
			    too, since fourteen rows plus an Admin group already overflows a
			    laptop. */}
			<SidebarContent ref={navScrollRef} className="scroll-fade px-2.5">
				{/* The two lists are a swap, not a replacement — the same crossfade the
				    rest of the app uses for a panel change, because that is what this
				    is. It travels along the switch that caused it: the Chat segment
				    sits to the RIGHT of Browse, so arriving at Chat sends the content
				    left and going back sends it right. There are only two tabs, so the
				    one being entered names the one being left and no previous-tab ref
				    is needed. */}
				<FadeSwap
					activeKey={tab}
					direction={tab === "chat" ? "left" : "right"}
					className="flex flex-col"
				>
					{tab === "chat" ? (
						<ChatRail orgSlug={orgSlug} />
					) : (
						<>
							<SidebarGroup>
								<SidebarGroupLabel>Work</SidebarGroupLabel>
								<SidebarGroupContent>
									<SidebarMenu>
										{WORK_ITEMS.map(navRow)}
										{lateWorkItems.map(lateNavRow)}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
							{/* No label over the Settings row: a heading over a single
							    row names a group of one. The gap above it is the
							    separation, the way the hub separates its two sections. */}
							<SidebarGroup>
								<SidebarGroupContent>
									<SidebarMenu>{YOU_ITEMS.map(navRow)}</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</>
					)}
				</FadeSwap>
			</SidebarContent>
			<SidebarFooter className="shrink-0 gap-0 p-0">
				{/* Outside the swapped panel, so it stays put on both tabs. A new tab,
				    since it leaves the app, and the arrow says so before the click. */}
				<SidebarMenu className="px-2.5 pb-2.5">
					<SidebarMenuItem>
						<SidebarMenuButton
							render={
								<a href={GITHUB_NEW_ISSUE_URL} target="_blank" rel="noreferrer">
									<GithubLogoIcon className="size-4" />
									<span className="min-w-0 flex-1 truncate">
										Report a problem
									</span>
									<ArrowUpRightIcon
										weight="regular"
										className="size-3.5 text-muted-foreground"
									/>
								</a>
							}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
				{/* Fixed height, not padding: the row is one line tall for an admin
				    and two for everyone else, and the timesheet's footer aligns to
				    this rule (see `--footer-h`). */}
				<div className="flex h-(--footer-h) items-center gap-2.5 border-t px-3.5">
					<PersonAvatar
						name={userName}
						image={userImage}
						size="sm"
						className="size-6.5"
					/>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">{userName}</div>
						{!isAdmin && (
							<div className="truncate text-2xs text-muted-foreground">
								Member
							</div>
						)}
					</div>
					<ThemeToggle />
					<button
						type="button"
						onClick={handleLogout}
						title={`Log out (${userEmail})`}
						className="quiet shrink-0"
					>
						<SignOutIcon weight="fill" className="size-3.75" />
					</button>
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
