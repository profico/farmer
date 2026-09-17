import {
	BriefcaseIcon,
	CalendarDotsIcon,
	ChartLineIcon,
	ChatCircleDotsIcon,
	ClockIcon,
	FolderIcon,
	GearSixIcon,
	RepeatIcon,
	SquaresFourIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

/**
 * Every destination either navigation can reach, and the two functions that say
 * which one you are looking at.
 *
 * Data, not a component, and therefore not in `app-sidebar.tsx` any more: three
 * surfaces read this list — the sidebar, the mobile tab bar and the settings
 * hub — and the hub's own catalogue (`components/settings-nav.tsx`) is read back
 * by the sidebar to draw its settings sub-menu. Left where it was, that last
 * step is an import cycle between a component and a page.
 */
export type OrgRoutePath =
	| "/$orgSlug"
	| "/$orgSlug/projects"
	| "/$orgSlug/time"
	| "/$orgSlug/assistant"
	| "/$orgSlug/reports"
	| "/$orgSlug/settings"
	| "/$orgSlug/settings/clients"
	| "/$orgSlug/settings/my-schedule"
	| "/$orgSlug/settings/recurring-blocks"
	| "/$orgSlug/settings/holidays"
	| "/$orgSlug/settings/integrations"
	| "/$orgSlug/settings/workspace-integrations"
	| "/$orgSlug/settings/tasks"
	| "/$orgSlug/settings/hour-fund"
	| "/$orgSlug/settings/reminders"
	| "/$orgSlug/settings/import"
	| "/$orgSlug/settings/organization"
	| "/$orgSlug/settings/preferences"
	| "/$orgSlug/settings/members";

/**
 * A destination that belongs to the DEPLOYMENT rather than to a workspace.
 *
 * It carries no `$orgSlug`, which is the whole difference: everything in
 * `OrgRoutePath` is drawn with `params={{ orgSlug }}`, and these routes have no
 * such param to fill. Every surface that draws a `NavItem` passes the params
 * anyway — an extra key for a route that declares none is inert — so the one
 * place the distinction has to be made is `isNavItemActive`, where a path with
 * no `$orgSlug` to substitute simply matches itself.
 */
export type InstanceRoutePath = "/infrastructure/admins";

export type NavItem = {
	label: string;
	to: OrgRoutePath | InstanceRoutePath;
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

/**
 * The nav is one group of work, plus the door to everything else.
 *
 * It was three groups and fifteen destinations for an admin — Work, then "You"
 * (My schedule, Recurring blocks, Settings), then "Manage" (Clients, People) —
 * with four of those rows ALSO listed inside Settings, in a different order and
 * under different headings. Two lists of the same pages that disagreed.
 *
 * Everything configurable now sits behind the Settings row, and the sub-menu
 * that opens under it carries the whole catalogue in the hub's two groups and
 * the hub's order (`components/settings-nav.tsx`) — so the sidebar lost four
 * duplicate rows and every settings page stayed one click from any other.
 *
 * Reports joins Work rather than standing alone: a report is read off the same
 * work the three rows above it are about.
 */
export const WORK_ITEMS: NavItem[] = [
	{ label: "Home", to: "/$orgSlug", icon: SquaresFourIcon },
	// Ahead of Projects, unlike before: this is a time tracker, and the timesheet
	// is the screen its people open every day.
	{ label: "Time", to: "/$orgSlug/time", icon: ClockIcon },
	{ label: "Projects", to: "/$orgSlug/projects", icon: FolderIcon },
];

export const MY_SCHEDULE_ITEM: NavItem = {
	label: "My schedule",
	to: "/$orgSlug/settings/my-schedule",
	icon: CalendarDotsIcon,
};

export const RECURRING_BLOCKS_ITEM: NavItem = {
	label: "Recurring blocks",
	to: "/$orgSlug/settings/recurring-blocks",
	icon: RepeatIcon,
};

// The one row every reader gets, whatever their role — for a Member the pages
// behind it are entirely their own, and for an admin it is also where the
// workspace is configured.
export const SETTINGS_ITEM: NavItem = {
	label: "Settings",
	to: "/$orgSlug/settings",
	icon: GearSixIcon,
};

/**
 * The rows under the work group: the one door to everything else.
 *
 * It held My schedule and Recurring blocks too. Both are settings pages, both
 * were also listed inside Settings, and keeping them here made the sidebar say
 * the same thing twice in two places.
 */
export const YOU_ITEMS: NavItem[] = [SETTINGS_ITEM];

/**
 * The mobile tab bar's rows, which are Work plus the assistant.
 *
 * There is no Browse/Chat switch on a phone — the bar is three tabs and a "More"
 * sheet — so the assistant needs a row there or it is unreachable. It goes after
 * the three work screens, which on a regular-width phone makes it the fourth
 * primary tab and on a narrow one puts it first in "More". Previously it was
 * appended to a list of eight, so a narrow phone buried the feature under seven
 * settings pages. The bar slices by POSITION, so a conditional row has to be
 * placed before the slice.
 */
export const mobileWorkItems = (assistantAvailable: boolean): NavItem[] =>
	assistantAvailable ? [...WORK_ITEMS, ASSISTANT_ITEM] : WORK_ITEMS;

// Gated on a PROJECT role rather than the org role: clients are creatable by
// PMs and Team Leads (PRD 3.3), not just Admins. It lives inside Settings now,
// so the gate is `SettingsAudience.canManageClients`.
export const CLIENTS_ITEM: NavItem = {
	label: "Clients",
	to: "/$orgSlug/settings/clients",
	icon: BriefcaseIcon,
};

// Not an admin row: a Team Lead or PM gets the Time and Overtime reports
// scoped to their own projects (PRD 6.1/6.5). The services have
// always scoped them — the page was simply unreachable from the nav, so the
// only way in was to type the URL.
export const REPORTS_ITEM: NavItem = {
	label: "Reports",
	to: "/$orgSlug/reports",
	icon: ChartLineIcon,
};

export const PEOPLE_ITEM: NavItem = {
	label: "People",
	to: "/$orgSlug/settings/members",
	icon: UsersIcon,
};

export function isNavItemActive(pathname: string, to: string, orgSlug: string) {
	const resolved = to.replace("$orgSlug", orgSlug);
	if (resolved === `/${orgSlug}`) return pathname === resolved;
	return pathname === resolved || pathname.startsWith(`${resolved}/`);
}

/**
 * Which single row a path belongs to: the longest match wins.
 *
 * `isNavItemActive` is a prefix test, and the Settings hub is the prefix of
 * every row in its sub-menu. Asked row by row, `/acme/settings/preferences`
 * lights both the sub-row and the hub above it, which is wrong twice over: it
 * says you are in two places, and the active pill is a shared element, so two
 * carriers of one `layoutId` leave the animation with no single destination to
 * travel to.
 *
 * Resolving it here rather than per row also gives the hub the behaviour it
 * wants for free — Settings stays lit while its sub-menu is closed, and hands
 * the highlight down to a sub-row as soon as one opens.
 */
export function activeNavTo(
	pathname: string,
	items: NavItem[],
	orgSlug: string,
): string | null {
	let best: string | null = null;
	for (const item of items) {
		if (!isNavItemActive(pathname, item.to, orgSlug)) continue;
		if (best === null || item.to.length > best.length) best = item.to;
	}
	return best;
}
