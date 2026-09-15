import {
	ArrowUpRightIcon,
	GithubLogoIcon,
	SignOutIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";

import { ChatRail } from "#/components/assistant/chat-rail.tsx";
import { OrgSwitcher } from "#/components/org-switcher.tsx";
import { PersonAvatar } from "#/components/person-avatar.tsx";
import {
	settingsNavGroups,
	settingsSubNavItems,
} from "#/components/settings-nav.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { DisclosureChevron } from "#/components/ui/disclosure.tsx";
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
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
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
	SETTINGS_ITEM,
	WORK_ITEMS,
	YOU_ITEMS,
} from "#/lib/nav-items.ts";
import { cn } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";

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

/**
 * The settings sub-menu's opening, and the reason it is not a plain `<div>`.
 *
 * The same shape as `EnteringMenuItem` above: `overflow-hidden` is what makes
 * the list read as unrolling under the Settings row rather than six labels
 * arriving at once, and it comes off the moment the animation ends, because a
 * sub-row's `focus-visible:ring-2` sits outside its border and this box is
 * exactly the list's size.
 */
function ExpandingSub({ children }: { children: React.ReactNode }) {
	const [settled, setSettled] = useState(false);
	const { initial, animate, exit } = useUnroll(useReducedMotion());
	return (
		<motion.div
			className={cn(!settled && "overflow-hidden")}
			initial={initial}
			animate={animate}
			// It leaves the way it arrived, rolling back up under the row it
			// belongs to. Unmounting it on the frame the route changes made the
			// list vanish where it had unrolled, which is the one thing a person
			// reads as "that was not a place".
			exit={exit}
			transition={springProductive}
			// The clip is only wanted while the box is moving: a sub-row's
			// focus ring sits outside its border, and this box is exactly the
			// list's size. It comes back for the exit.
			onAnimationStart={() => setSettled(false)}
			onAnimationComplete={() => setSettled(true)}
		>
			{children}
		</motion.div>
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

	// Not a suspense query: the sidebar is always mounted and shouldn't block or
	// suspend on this. Clients are gated on a per-project lead role (or a people
	// list), which the org role alone can't tell us.
	const { data: access } = useQuery(myAccessQuery(orgSlug));
	const canManageClients = isAdmin || !!access?.isLeadSomewhere;

	// The gated rows, resolved once: the render needs them twice over (which
	// group draws which row, and which row the path belongs to) and they must be
	// the same answer both times.
	// Reports are for everyone — the services scope them, a Member sees their
	// own row — so the item is not gated.
	const lateWorkItems = [REPORTS_ITEM];

	// The settings sub-menu: every settings page this reader may open, in the
	// hub's own two groups and the hub's own order.
	//
	// A settings page used to be a leaf: you arrived from the hub, and the only
	// way to the next one was back to the hub first. The sub-menu turns them into
	// siblings you can walk between, and it is what makes the Settings row read
	// as a place rather than a link.
	//
	// **It is a disclosure the reader controls now.** It used to open by route
	// and have no way to close — twelve rows you could not put away, on a screen
	// whose nav is meant to be four. It still opens itself when you navigate into
	// settings, because that is what the sidebar looks like at that address, and
	// closing it while you stand inside is allowed: the row stays lit, so nothing
	// is lost.
	const inSettings = isNavItemActive(pathname, SETTINGS_ITEM.to, orgSlug);
	const settingsGroups = settingsNavGroups({ isAdmin, canManageClients });
	const settingsItems = settingsSubNavItems({ isAdmin, canManageClients });
	const [settingsOpenOverride, setSettingsOpenOverride] = useState<
		boolean | null
	>(null);
	// The route wins on arrival, the reader wins after that, and walking OUT of
	// settings clears the override so the next visit opens fresh.
	const settingsWasIn = useRef(inSettings);
	if (settingsWasIn.current !== inSettings) {
		settingsWasIn.current = inSettings;
		if (settingsOpenOverride !== null) setSettingsOpenOverride(null);
	}
	const settingsOpen = settingsOpenOverride ?? inSettings;

	const activeTo = activeNavTo(
		pathname,
		[
			...WORK_ITEMS,
			...lateWorkItems,
			...YOU_ITEMS,
			...(inSettings ? settingsItems : []),
		],
		orgSlug,
	);

	// Unattributed time, on the row that leads to the screen that files it.
	// Everything the sync engines write lands project-less, so this is the one
	// number in the app that grows while nobody is looking at it.
	const unfiledCount = useUnfiledCount(orgSlug, timezone);
	const badgeFor = (item: NavItem) =>
		item.to === "/$orgSlug/time" ? unfiledCount : undefined;

	// A sub-row: the same shared pill as a top-level row, one indent in.
	//
	// `SidebarMenuSubButton` paints its own `data-active` background, which would
	// blink the highlight off a nav row and on down here. Neutralised so the
	// shared-layout span can draw it instead and carry it into the sub-menu, the
	// same way it already travels between the groups above.
	const settingsSubLink = (item: NavItem, isActive: boolean) => (
		<Link
			to={item.to}
			params={{ orgSlug }}
			className="relative data-active:bg-transparent"
			{...pressToNavigate(item, isActive)}
		>
			{isActive && (
				<motion.span
					aria-hidden
					layoutId="sidebar-active-nav"
					transition={springLayout}
					// Matching the sub button's own corner — the pill and the hover
					// background are the same shape at the same size, or the corner
					// changes as you move onto the row you are already on.
					className="absolute inset-0 rounded-lg bg-sidebar-accent"
				/>
			)}
			{/* No icon, unlike the rows above and unlike the hub's list: the rail at
			    the left already says these belong to the row over them, and a second
			    column of glyphs at this indent leaves the labels nowhere to go. */}
			<span className="relative min-w-0 flex-1 truncate">{item.label}</span>
		</Link>
	);

	const settingsRow = (item: NavItem) => {
		const isActive = activeTo === item.to;
		return (
			<SidebarMenuItem key={item.to}>
				{/* The row is still a link to the hub — a phone has no sub-menu and
				    the hub is where its rows live — with the chevron beside it as the
				    disclosure's own control. A caret that navigated would be a
				    control that did two things; one that only turned would leave the
				    hub unreachable from the sidebar. So: label navigates, caret
				    toggles, and the caret stops the click from reaching the link. */}
				<SidebarMenuButton
					isActive={isActive}
					render={navLink(item, isActive)}
				/>
				<button
					type="button"
					aria-expanded={settingsOpen}
					aria-label={settingsOpen ? "Collapse settings" : "Expand settings"}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setSettingsOpenOverride(!settingsOpen);
					}}
					className="absolute top-1.5 right-1 flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
				>
					<DisclosureChevron open={settingsOpen} />
				</button>
				{/* `initial={false}` so a cold load that lands inside settings paints
				    the sub-menu already open. It is not an entrance there — it is
				    what the sidebar looks like at that address. */}
				<AnimatePresence initial={false}>
					{settingsOpen && (
						<ExpandingSub>
							<SidebarMenuSub className="mt-1">
								{settingsGroups.map((group) => (
									<Fragment key={group.key}>
										{/* The hub's own section labels, so the menu and the
										    page it leads to name the same groups. */}
										<li className="eyebrow px-2.5 pt-2.5 pb-1 first:pt-1">
											{group.label}
										</li>
										{group.items.map((subItem) => (
											<SidebarMenuSubItem key={subItem.to}>
												<SidebarMenuSubButton
													isActive={activeTo === subItem.to}
													render={settingsSubLink(
														subItem,
														activeTo === subItem.to,
													)}
												/>
											</SidebarMenuSubItem>
										))}
									</Fragment>
								))}
							</SidebarMenuSub>
						</ExpandingSub>
					)}
				</AnimatePresence>
			</SidebarMenuItem>
		);
	};

	const handleLogout = async () => {
		await authClient.signOut();
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
									<SidebarMenu>
										{YOU_ITEMS.map((item) =>
											item.to === SETTINGS_ITEM.to
												? settingsRow(item)
												: navRow(item),
										)}
									</SidebarMenu>
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
