import {
	BellIcon,
	BuildingsIcon,
	CalendarHeartIcon,
	CaretLeftIcon,
	GearSixIcon,
	HashIcon,
	PlugIcon,
	TagIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	CLIENTS_ITEM,
	MY_SCHEDULE_ITEM,
	type NavItem,
	PEOPLE_ITEM,
	RECURRING_BLOCKS_ITEM,
	SETTINGS_ITEM,
} from "#/lib/nav-items.ts";

/**
 * The one catalogue of settings pages, read by both surfaces that list them.
 *
 * The hub (`routes/$orgSlug/settings/index.tsx`) draws every row of it with its
 * description; the sidebar draws the sub-menu under the Settings row from the
 * same array. Spelled out twice, the two lists drift the first time a page is
 * added — which reads on screen as a settings page you can reach from the index
 * and not from the menu beside it.
 */
export type SettingsAudience = {
	isAdmin: boolean;
	/** A Team Lead or PM on any project, or an admin. */
	canManageClients: boolean;
};

export type SettingsEntry = {
	item: NavItem;
	/** Which of the hub's two sections the row belongs to. */
	group: "account" | "workspace";
	description: string;
	/**
	 * True when the page also has a nav row of its own.
	 *
	 * Those four rows are listed by the hub and left out of the sub-menu: an
	 * index that omitted them would not be an index, while a menu that repeated
	 * them would put the same destination twice in one sidebar — and, since the
	 * active pill is resolved by matching a path against a list of `to`s, two
	 * rows carrying one `to` are two rows that light together.
	 */
	hasNavRow: boolean;
	show: (audience: SettingsAudience) => boolean;
};

const always = () => true;

export const SETTINGS_ENTRIES: SettingsEntry[] = [
	{
		item: {
			label: "Preferences",
			to: "/$orgSlug/settings/preferences",
			icon: GearSixIcon,
		},
		group: "account",
		description:
			"Appearance, notifications and how you sign in to this account.",
		hasNavRow: false,
		show: always,
	},
	{
		item: MY_SCHEDULE_ITEM,
		group: "account",
		description:
			"Your working hours. They size the fill-rest-of-day block and the behind-pace reminder.",
		hasNavRow: true,
		show: always,
	},
	{
		item: RECURRING_BLOCKS_ITEM,
		group: "account",
		description:
			"Time that repeats every week, written onto your days for you.",
		hasNavRow: true,
		show: always,
	},
	{
		item: {
			label: "Integrations",
			to: "/$orgSlug/settings/integrations",
			icon: PlugIcon,
		},
		group: "account",
		description:
			"Connect GitHub and Google Calendar so your meetings and commits log themselves.",
		hasNavRow: false,
		show: always,
	},
	{
		item: {
			label: "Holidays",
			to: "/$orgSlug/settings/holidays",
			icon: CalendarHeartIcon,
		},
		group: "workspace",
		description: "The public holidays this workspace observes.",
		hasNavRow: false,
		show: always,
	},
	{
		item: CLIENTS_ITEM,
		group: "workspace",
		description: "The companies your projects are billed to.",
		hasNavRow: true,
		show: (audience) => audience.canManageClients,
	},
	{
		item: PEOPLE_ITEM,
		group: "workspace",
		description: "Invite people, set their role and their person type.",
		hasNavRow: true,
		show: (audience) => audience.isAdmin,
	},
	{
		item: {
			label: "Tasks",
			to: "/$orgSlug/settings/tasks",
			icon: TagIcon,
		},
		group: "workspace",
		description:
			"The task list every project picks from, plus the built-in absence tasks.",
		hasNavRow: false,
		show: (audience) => audience.isAdmin,
	},
	{
		item: {
			label: "Hour fund",
			to: "/$orgSlug/settings/hour-fund",
			icon: HashIcon,
		},
		group: "workspace",
		description:
			"The monthly hours each person is expected to deliver. Tracking reads Expected off this.",
		hasNavRow: false,
		show: (audience) => audience.isAdmin,
	},
	{
		item: {
			label: "Reminders",
			to: "/$orgSlug/settings/reminders",
			icon: BellIcon,
		},
		group: "workspace",
		description:
			"When the log reminder, the Slack nudge, the month-end reminder and the admin digest go out, and to whom.",
		hasNavRow: false,
		show: (audience) => audience.isAdmin,
	},
	{
		item: {
			label: "Import",
			to: "/$orgSlug/settings/import",
			icon: UploadSimpleIcon,
		},
		group: "workspace",
		description:
			"Bring clients, projects, people and time in from Harvest's CSV exports.",
		hasNavRow: false,
		show: (audience) => audience.isAdmin,
	},
	{
		item: {
			label: "Organization",
			to: "/$orgSlug/settings/organization",
			icon: BuildingsIcon,
		},
		group: "workspace",
		description: "Name, logo, timezone, country and the automation lock date.",
		hasNavRow: false,
		show: (audience) => audience.isAdmin,
	},
];

/** The rows this reader may open, in the hub's order. */
export const settingsEntriesFor = (
	audience: SettingsAudience,
): SettingsEntry[] => SETTINGS_ENTRIES.filter((entry) => entry.show(audience));

/**
 * The sidebar's sub-menu: the settings pages that have no nav row of their own.
 *
 * Three rows for a member, six for an admin — short enough to open under the
 * Settings row without the sidebar becoming the fifteen-row list the hub exists
 * to replace.
 */
export const settingsSubNavItems = (audience: SettingsAudience): NavItem[] =>
	settingsEntriesFor(audience)
		.filter((entry) => !entry.hasNavRow)
		.map((entry) => entry.item);

/**
 * The way back up, in the one place every settings page already has a line of
 * its own: the eyebrow over the title.
 *
 * A settings page reached from the hub had no route back to it. The sidebar's
 * Settings row is the way on a desktop, but it is lit while you stand on one of
 * its children, and a lit row reads as "you are here" rather than as a control.
 * A phone had nothing at all — no sidebar, and the tab bar's More sheet lists
 * the hub two taps away.
 *
 * It replaces the eyebrow rather than sitting above it, so the title still
 * begins at the same height as on every other screen (see `PageHeader`).
 */
export function SettingsEyebrow({ children }: { children: ReactNode }) {
	const orgSlug = useOrgSlug();
	return (
		<span className="flex min-w-0 items-center gap-2">
			<Link
				to={SETTINGS_ITEM.to}
				params={{ orgSlug }}
				// The negative margins buy a real target without moving anything: the
				// link is one 13px line of text, and on a phone it is the ONLY way out
				// of a settings page. `-my-3` pairs with `py-3` so the eyebrow row
				// keeps the height every other screen's does.
				className="-my-3 -ml-1 flex shrink-0 items-center gap-1 py-3 pr-1 pl-1 transition-colors duration-(--dur-fast) hover:text-foreground"
			>
				{/* Nudged up off the flex centre. `items-center` centres the glyph on
				    the LINE BOX, which is symmetric about the font's em square — but
				    the label beside it is uppercase and has no descenders, so it is
				    read as centred on its cap height, which sits higher. The
				    correction is half that difference, and it is what stops the arrow
				    sitting visibly low against SETTINGS. */}
				<CaretLeftIcon weight="bold" className="-mt-px size-2.5" />
				{SETTINGS_ITEM.label}
			</Link>
			<span aria-hidden className="opacity-40">
				/
			</span>
			<span className="truncate">{children}</span>
		</span>
	);
}
