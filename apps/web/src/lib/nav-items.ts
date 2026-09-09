import {
	BriefcaseIcon,
	CalendarCheckIcon,
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
	| "/$orgSlug/close"
	| "/$orgSlug/reports"
	| "/$orgSlug/settings"
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
 * The nav is three groups, and each one answers a different question.
 *
 * It was one group of eleven called "Workspace" plus four called "Admin", and
 * the first label had stopped meaning anything: it held the timesheet, the
 * project list, the close sheet, your own working hours AND your theme. Every
 * page in the app already knew the right taxonomy and printed it as its own
 * eyebrow — "Your account" over Preferences, "Your schedule" over My schedule,
 * "Workspace" over Organization — so the screens agreed on a grouping the menu
 * beside them did not use.
 *
 * - **Work** is what you came here to do, and what a report is read off.
 * - **You** is the shape of your own week, plus the door to everything else.
 * - **Manage** is running the place: people and the companies they bill to.
 *
 * The six configuration pages that used to be rows (Preferences, Integrations,
 * Holidays, Tasks, Hour fund, Organization) now live behind the Settings hub —
 * see `routes/$orgSlug/settings/index.tsx`. They are set once and revisited
 * rarely, which is the definition of a page that belongs one click deeper, and
 * moving them takes an admin's sidebar from fifteen rows to ten.
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

// Beside My schedule rather than behind the hub with the rest of the settings:
// a recurring block is the other half of "what my week looks like", and it
// writes entries onto days by itself — which is not something to hide.
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

export const YOU_ITEMS: NavItem[] = [
	MY_SCHEDULE_ITEM,
	RECURRING_BLOCKS_ITEM,
	SETTINGS_ITEM,
];

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
 * `isNavItemActive` is a prefix test, and the Settings hub is now the prefix of
 * ten rows that are not it — two of which (My schedule, Recurring blocks) are
 * still rows of their own, and six of which are the hub's sub-menu. Asked row by
 * row, `/acme/settings/preferences` lights both the sub-row and the hub above
 * it, which is wrong twice over: it says you are in two places, and the active
 * pill is a shared element, so two carriers of one `layoutId` leave the
 * animation with no single destination to travel to.
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
