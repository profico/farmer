import {
	BriefcaseIcon,
	BuildingsIcon,
	CalendarCheckIcon,
	CalendarDotsIcon,
	CalendarHeartIcon,
	ChartLineIcon,
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
import { type ComponentType, useRef, useState } from "react";
import { OrgSwitcher } from "#/components/org-switcher.tsx";
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

export type NavItem = {
	label: string;
	to: OrgRoutePath;
	icon: ComponentType<{ className?: string }>;
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
}: {
	orgSlug: string;
	organizationName: string;
	organizationLogo?: string | null;
	isAdmin: boolean;
	userName: string;
	userEmail: string;
	singleOrg?: boolean;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });
	const router = useRouter();
	const navigate = useNavigate();

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
			<SidebarHeader className="shrink-0 p-2.5">
				<OrgSwitcher
					orgSlug={orgSlug}
					organizationName={organizationName}
					organizationLogo={organizationLogo}
					singleOrg={singleOrg}
				/>
			</SidebarHeader>
			<SidebarContent className="px-2.5">
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
