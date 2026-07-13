import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import {
	Building2,
	CalendarCheck,
	CalendarDays,
	CalendarHeart,
	Clock,
	Folder,
	LayoutDashboard,
	LineChart,
	LogOut,
	Plug,
	Settings,
	Tags,
	Users,
} from "lucide-react";
import { type ComponentType, useRef } from "react";
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
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { getInitials } from "#/lib/utils.ts";
import {
	isTimeOffApproverQuery,
	pendingTimeOffCountQuery,
} from "#/queries/time-off.ts";

export type OrgRoutePath =
	| "/$orgSlug"
	| "/$orgSlug/projects"
	| "/$orgSlug/time"
	| "/$orgSlug/settings/my-schedule"
	| "/$orgSlug/settings/holidays"
	| "/$orgSlug/settings/integrations"
	| "/$orgSlug/settings/entry-types"
	| "/$orgSlug/settings/time-off"
	| "/$orgSlug/settings/organization"
	| "/$orgSlug/settings/preferences"
	| "/$orgSlug/settings/members"
	| "/$orgSlug/reports";

export type NavItem = {
	label: string;
	to: OrgRoutePath;
	icon: ComponentType<{ className?: string }>;
};

// First 3 are the primary mobile tab-bar destinations (mobile-tab-bar.tsx);
// the rest surface in its "More" sheet, alongside ADMIN_ITEMS.
export const WORKSPACE_ITEMS: NavItem[] = [
	{ label: "Home", to: "/$orgSlug", icon: LayoutDashboard },
	{ label: "Projects", to: "/$orgSlug/projects", icon: Folder },
	{ label: "Time", to: "/$orgSlug/time", icon: Clock },
	{
		label: "My schedule",
		to: "/$orgSlug/settings/my-schedule",
		icon: CalendarDays,
	},
	{ label: "Holidays", to: "/$orgSlug/settings/holidays", icon: CalendarHeart },
	{
		label: "Integrations",
		to: "/$orgSlug/settings/integrations",
		icon: Plug,
	},
	{
		label: "Preferences",
		to: "/$orgSlug/settings/preferences",
		icon: Settings,
	},
];

export const ADMIN_ITEMS: NavItem[] = [
	{ label: "Reports", to: "/$orgSlug/reports", icon: LineChart },
	{ label: "Entry types", to: "/$orgSlug/settings/entry-types", icon: Tags },
	{
		label: "Time off requests",
		to: "/$orgSlug/settings/time-off",
		icon: CalendarCheck,
	},
	{
		label: "Organization",
		to: "/$orgSlug/settings/organization",
		icon: Building2,
	},
	{ label: "Members", to: "/$orgSlug/settings/members", icon: Users },
];

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
}: {
	orgSlug: string;
	organizationName: string;
	organizationLogo?: string | null;
	isAdmin: boolean;
	userName: string;
	userEmail: string;
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
			viewTransition={!isActive}
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
				if (!isActive)
					navigate({ to: item.to, params: { orgSlug }, viewTransition: true });
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
			<item.icon className="size-4" />
			<span>{item.label}</span>
		</Link>
	);

	// Non-admins who approve time off for a project get an "Approvals" link too.
	const { data: isApprover = false } = useQuery({
		...isTimeOffApproverQuery(),
		enabled: !isAdmin,
		staleTime: 60_000,
	});
	const canReview = isAdmin || isApprover;

	// Not a suspense query: the sidebar is always mounted and shouldn't block
	// or suspend on this. `enabled: canReview` keeps members who can't review
	// from ever hitting the server fn from here.
	const { data: pendingTimeOffCount } = useQuery({
		...pendingTimeOffCountQuery(),
		enabled: canReview,
		staleTime: 60_000,
	});

	const handleLogout = async () => {
		await authClient.signOut();
		await router.invalidate();
	};

	return (
		<Sidebar
			collapsible="none"
			className="sticky top-0 hidden h-svh border-r md:flex"
		>
			<SidebarHeader className="shrink-0 p-3">
				<OrgSwitcher
					orgSlug={orgSlug}
					organizationName={organizationName}
					organizationLogo={organizationLogo}
				/>
			</SidebarHeader>
			<SidebarContent className="px-1.5">
				<SidebarGroup>
					<SidebarGroupLabel>Workspace</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{WORKSPACE_ITEMS.map((item) => {
								const isActive = isNavItemActive(pathname, item.to, orgSlug);
								return (
									<SidebarMenuItem key={item.to}>
										<SidebarMenuButton
											isActive={isActive}
											render={navLink(item, isActive)}
										/>
									</SidebarMenuItem>
								);
							})}
							{!isAdmin && isApprover && (
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={isNavItemActive(
											pathname,
											"/$orgSlug/settings/time-off",
											orgSlug,
										)}
										render={navLink(
											{
												label: "Approvals",
												to: "/$orgSlug/settings/time-off",
												icon: CalendarCheck,
											},
											isNavItemActive(
												pathname,
												"/$orgSlug/settings/time-off",
												orgSlug,
											),
										)}
									/>
									{!!pendingTimeOffCount && pendingTimeOffCount > 0 && (
										<SidebarMenuBadge className="bg-primary text-primary-foreground peer-data-active/menu-button:text-primary-foreground peer-hover/menu-button:text-primary-foreground">
											{pendingTimeOffCount}
										</SidebarMenuBadge>
									)}
								</SidebarMenuItem>
							)}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				{isAdmin && (
					<SidebarGroup>
						<SidebarGroupLabel>Admin</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{ADMIN_ITEMS.map((item) => {
									const isActive = isNavItemActive(pathname, item.to, orgSlug);
									return (
										<SidebarMenuItem key={item.to}>
											<SidebarMenuButton
												isActive={isActive}
												render={navLink(item, isActive)}
											/>
											{item.to === "/$orgSlug/settings/time-off" &&
												!!pendingTimeOffCount &&
												pendingTimeOffCount > 0 && (
													<SidebarMenuBadge className="bg-primary text-primary-foreground peer-data-active/menu-button:text-primary-foreground peer-hover/menu-button:text-primary-foreground">
														{pendingTimeOffCount}
													</SidebarMenuBadge>
												)}
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>
			<SidebarFooter className="shrink-0 gap-0 p-0">
				<div className="flex items-center gap-2.5 border-t p-3">
					<span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
						{getInitials(userName)}
					</span>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-semibold">{userName}</div>
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
						className="shrink-0 text-muted-foreground hover:text-foreground"
					>
						<LogOut className="size-3.75" />
					</button>
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
