import {
	BriefcaseIcon,
	BuildingsIcon,
	CalendarCheckIcon,
	CalendarDotsIcon,
	CalendarHeartIcon,
	ChartLineIcon,
	ChatCircleDotsIcon,
	ClockIcon,
	FolderIcon,
	GearSixIcon,
	HashIcon,
	PlugIcon,
	RepeatIcon,
	SignOutIcon,
	SquaresFourIcon,
	TagIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ComponentType, useEffect, useRef, useState } from "react";

import { ChatRail } from "#/components/assistant/chat-rail.tsx";
import { OrgSwitcher } from "#/components/org-switcher.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
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
import { authClient } from "#/lib/auth-client.ts";
import { springLayout, springProductive } from "#/lib/motion.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";

export type OrgRoutePath =
	| "/$orgSlug"
	| "/$orgSlug/projects"
	| "/$orgSlug/time"
	| "/$orgSlug/assistant"
	| "/$orgSlug/close"
	| "/$orgSlug/reports"
	| "/$orgSlug/settings/clients"
	| "/$orgSlug/settings/my-schedule"
	| "/$orgSlug/settings/recurring-blocks"
	| "/$orgSlug/settings/holidays"
	| "/$orgSlug/settings/integrations"
	| "/$orgSlug/settings/tasks"
	| "/$orgSlug/settings/hour-fund"
	| "/$orgSlug/settings/organization"
	| "/$orgSlug/settings/preferences"
	| "/$orgSlug/settings/members";

type SidebarTab = "browse" | "chat";

export type NavItem = {
	label: string;
	to: OrgRoutePath;
	icon: ComponentType<{ className?: string }>;
};

// Not a row in the desktop sidebar: there, the Chat tab IS the assistant, and a
// nav entry beside it would be a second door to the same room. It survives as an
// item for the MOBILE tab bar (below), which has no tabs and would otherwise
// have no way in at all.
//
// Ungated by ROLE on purpose — the assistant answers through the caller's own
// Access, so a Member's is simply a narrower assistant, not a forbidden one —
// but gated on the feature being available at all: the deployment flag, a
// connected key, and not paused for this org (see `assistantAvailable`).
export const ASSISTANT_ITEM: NavItem = {
	label: "Assistant",
	to: "/$orgSlug/assistant",
	icon: ChatCircleDotsIcon,
};

// First 3 are the primary mobile tab-bar destinations (mobile-tab-bar.tsx);
// the rest surface in its "More" sheet, alongside ADMIN_ITEMS.
export const WORKSPACE_ITEMS: NavItem[] = [
	{ label: "Home", to: "/$orgSlug", icon: SquaresFourIcon },
	{ label: "Projects", to: "/$orgSlug/projects", icon: FolderIcon },
	{ label: "Time", to: "/$orgSlug/time", icon: ClockIcon },
	{
		label: "My schedule",
		to: "/$orgSlug/settings/my-schedule",
		icon: CalendarDotsIcon,
	},
	// Next to My schedule rather than buried in settings: a recurring block is
	// the other half of "what my week looks like", and it writes entries onto
	// days by itself — which is not something to hide behind two clicks.
	{
		label: "Recurring blocks",
		to: "/$orgSlug/settings/recurring-blocks",
		icon: RepeatIcon,
	},
	{
		label: "Holidays",
		to: "/$orgSlug/settings/holidays",
		icon: CalendarHeartIcon,
	},
	{
		label: "Integrations",
		to: "/$orgSlug/settings/integrations",
		icon: PlugIcon,
	},
	{
		label: "Preferences",
		to: "/$orgSlug/settings/preferences",
		icon: GearSixIcon,
	},
];

/**
 * The mobile tab bar's rows, which are the desktop sidebar's plus the assistant.
 *
 * There is no Browse/Chat switch on a phone — the bar is three tabs and a "More"
 * sheet — so the assistant needs a row there or it is unreachable. It goes LAST:
 * the bar turns the first three (or four, on a wider phone) entries into its
 * primary tabs, and in a time-tracking app those slots belong to the screens the
 * work happens on. Appended rather than filtered because the bar slices by
 * POSITION, so a conditional row has to be placed before the slice.
 */
export const mobileWorkspaceItems = (assistantAvailable: boolean): NavItem[] =>
	assistantAvailable ? [...WORKSPACE_ITEMS, ASSISTANT_ITEM] : WORKSPACE_ITEMS;

// Gated on a PROJECT role rather than the org role, so neither list fits: the
// close sheet belongs to whoever runs a project, and clients are creatable by
// PMs and Team Leads (PRD 3.3), not just Admins.
export const CLOSE_ITEM: NavItem = {
	label: "Monthly close",
	to: "/$orgSlug/close",
	icon: CalendarCheckIcon,
};

export const CLIENTS_ITEM: NavItem = {
	label: "Clients",
	to: "/$orgSlug/settings/clients",
	icon: BriefcaseIcon,
};

// Not an admin row: a Team Lead or PM gets the Time, Overtime and Budget burn
// reports scoped to their own projects (PRD 6.1/6.5/6.6). The services have
// always scoped them — the page was simply unreachable from the nav, so the
// only way in was to type the URL.
export const REPORTS_ITEM: NavItem = {
	label: "Reports",
	to: "/$orgSlug/reports",
	icon: ChartLineIcon,
};

export const ADMIN_ITEMS: NavItem[] = [
	{ label: "Tasks", to: "/$orgSlug/settings/tasks", icon: TagIcon },
	{ label: "Hour fund", to: "/$orgSlug/settings/hour-fund", icon: HashIcon },
	{
		label: "Organization",
		to: "/$orgSlug/settings/organization",
		icon: BuildingsIcon,
	},
	{ label: "People", to: "/$orgSlug/settings/members", icon: UsersIcon },
];

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
function EnteringMenuItem({ children }: { children: React.ReactNode }) {
	const [settled, setSettled] = useState(false);
	return (
		<motion.li
			data-sidebar="menu-item"
			className={cn("group/menu-item relative", !settled && "overflow-hidden")}
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: "auto", opacity: 1 }}
			transition={springProductive}
			onAnimationComplete={() => setSettled(true)}
		>
			{children}
		</motion.li>
	);
}

export function isNavItemActive(pathname: string, to: string, orgSlug: string) {
	const resolved = to.replace("$orgSlug", orgSlug);
	if (resolved === `/${orgSlug}`) return pathname === resolved;
	return pathname === resolved || pathname.startsWith(`${resolved}/`);
}

export function AppSidebar({
	orgSlug,
	organizationName,
	organizationLogo,
	isAdmin,
	userName,
	userEmail,
	singleOrg = false,
	assistantAvailable,
}: {
	orgSlug: string;
	organizationName: string;
	organizationLogo?: string | null;
	isAdmin: boolean;
	userName: string;
	userEmail: string;
	singleOrg?: boolean;
	/**
	 * Whether the assistant exists for this reader at all — the deployment flag
	 * AND a connected key AND not paused for this org, resolved once in the
	 * layout route. Deliberately not just `ASSISTANT_ENABLED`: a Chat tab whose
	 * destination explains that it isn't connected is a tab that shouldn't be
	 * there.
	 */
	assistantAvailable: boolean;
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

	const navLink = (item: NavItem, isActive: boolean) => (
		<Link
			to={item.to}
			params={{ orgSlug }}
			// `data-active:*` on the shared button variant paints the pill directly
			// on whichever row is active, which means the pill blinks off one row and
			// on at another. Neutralised here so the shared-layout span below can
			// draw it instead and carry it between rows. This is the only consumer of
			// SidebarMenuButton, so nothing else is affected.
			className="data-active:bg-transparent data-active:shadow-none"
			onMouseDown={(e) => {
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
			}}
			onClick={(e) => {
				// A mouse press already navigated on mousedown — swallow its click
				// so we don't navigate twice. Keyboard Enter reaches here with no
				// preceding mousedown (flag false) and navigates normally, except
				// on the active tab, which stays a no-op.
				if (swallowClickRef.current || isActive) e.preventDefault();
				swallowClickRef.current = false;
			}}
		>
			{/* The active pill, as a shared element rather than a background on the
			    row — so moving between destinations slides it down the nav instead
			    of blinking it out here and in there. Same spring as the
			    SegmentedControl pill; `reducedMotion="user"` on the root
			    <MotionConfig> makes it jump instead of glide.

			    First child, with the icon and label made `relative` so they paint
			    over it — cheaper than a wrapper, and it keeps the label the last
			    `<span>` so the variant's `[&>span:last-child]:truncate` still bites. */}
			{isActive && (
				<motion.span
					aria-hidden
					layoutId="sidebar-active-nav"
					transition={springLayout}
					className="absolute inset-0 rounded-2xl bg-sidebar-accent shadow-[0_1px_2px_color-mix(in_srgb,var(--fg)_5%,transparent)]"
				/>
			)}
			<item.icon className="relative size-4" />
			<span className="relative">{item.label}</span>
		</Link>
	);

	const navRow = (item: NavItem) => {
		const isActive = isNavItemActive(pathname, item.to, orgSlug);
		return (
			<SidebarMenuItem key={item.to}>
				<SidebarMenuButton
					isActive={isActive}
					render={navLink(item, isActive)}
				/>
			</SidebarMenuItem>
		);
	};

	// Clients and Monthly close are gated on `myAccess`, which is a plain
	// `useQuery` (see below) — so unlike every other row they arrive a moment
	// after the sidebar has already painted, popping in at the end of Workspace
	// and knocking the whole Admin group down a notch. These two open instead.
	const lateNavRow = (item: NavItem) => {
		const isActive = isNavItemActive(pathname, item.to, orgSlug);
		return (
			<EnteringMenuItem key={item.to}>
				<SidebarMenuButton
					isActive={isActive}
					render={navLink(item, isActive)}
				/>
			</EnteringMenuItem>
		);
	};

	// Not a suspense query: the sidebar is always mounted and shouldn't block or
	// suspend on this. A PM on any project reaches the close sheet, so it can't
	// be inferred from the org role alone.
	const { data: access } = useQuery(myAccessQuery(orgSlug));
	const canClose = isAdmin || !!access?.isPmSomewhere;
	const canManageClients = isAdmin || !!access?.isLeadSomewhere;
	// Team Lead is the floor for any report at all — a plain Member sees strictly
	// their own entries and nothing at project level.
	const canSeeReports = isAdmin || !!access?.isLeadSomewhere;

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
				{tab === "chat" ? (
					<ChatRail orgSlug={orgSlug} />
				) : (
					<>
						<SidebarGroup>
							<SidebarGroupLabel>Workspace</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									{WORKSPACE_ITEMS.map(navRow)}
									{[
										...(canManageClients ? [CLIENTS_ITEM] : []),
										...(canClose ? [CLOSE_ITEM] : []),
										...(canSeeReports ? [REPORTS_ITEM] : []),
									].map(lateNavRow)}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
						{isAdmin && (
							<SidebarGroup>
								<SidebarGroupLabel>Admin</SidebarGroupLabel>
								<SidebarGroupContent>
									<SidebarMenu>{ADMIN_ITEMS.map(navRow)}</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						)}
					</>
				)}
			</SidebarContent>
			<SidebarFooter className="shrink-0 gap-0 p-0">
				{/* Fixed height, not padding: the row is one line tall for an admin
				    and two for everyone else, and the timesheet's footer aligns to
				    this rule (see `--footer-h`). */}
				<div className="flex h-(--footer-h) items-center gap-2.5 border-t px-3.5">
					<span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] text-[11px] font-medium text-muted-foreground">
						{getInitials(userName)}
					</span>
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
