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
	 * Kept at `false` on every entry, and kept as a field so the shape of a
	 * catalogue row does not change under anything reading it.
	 *
	 * It used to mark the four pages (My schedule, Recurring blocks, Clients,
	 * People) that ALSO had a top-level sidebar row, which the sub-menu then
	 * had to leave out — so the menu was "every settings page that lacks its own
	 * row", a rule about the code rather than a group a person recognises, and
	 * the sidebar and the hub listed different things in different orders. The
	 * four rows moved into Settings with the rest (see `app-sidebar.tsx`), and
	 * one catalogue now drives both surfaces in one order.
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
		hasNavRow: false,
		show: always,
	},
	{
		item: RECURRING_BLOCKS_ITEM,
		group: "account",
		description:
			"Time that repeats every week, written onto your days for you.",
		hasNavRow: false,
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
			label: "Organization",
			to: "/$orgSlug/settings/organization",
			icon: BuildingsIcon,
		},
		group: "workspace",
		description: "Name, logo, timezone, country and the automation lock date.",
		hasNavRow: false,
		show: (audience) => audience.isAdmin,
	},
	{
		item: CLIENTS_ITEM,
		group: "workspace",
		description: "The companies your projects are billed to.",
		hasNavRow: false,
		show: (audience) => audience.canManageClients,
	},
	{
		item: PEOPLE_ITEM,
		group: "workspace",
		description: "Invite people, set their role and their person type.",
		hasNavRow: false,
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
			label: "Holidays",
			to: "/$orgSlug/settings/holidays",
			icon: CalendarHeartIcon,
		},
		group: "workspace",
		description: "The public holidays this workspace observes.",
		hasNavRow: false,
		show: always,
	},
];

/** The rows this reader may open, in the hub's order. */
export const settingsEntriesFor = (
	audience: SettingsAudience,
): SettingsEntry[] => SETTINGS_ENTRIES.filter((entry) => entry.show(audience));

/** Every settings page this reader may open, flat — what the sidebar matches a
 *  path against to decide which sub-row is lit. */
export const settingsSubNavItems = (audience: SettingsAudience): NavItem[] =>
	settingsEntriesFor(audience).map((entry) => entry.item);

/** The label each of the hub's two sections carries, in both surfaces. */
export const SETTINGS_GROUP_LABEL = {
	account: "Account",
	workspace: "Workspace",
} as const;

/**
 * The sidebar's sub-menu, in the hub's own groups and the hub's own order.
 *
 * One function feeds both, so the menu under the Settings row and the page it
 * leads to can no longer disagree about what exists, what it is called, or
 * which section it belongs to. An empty group is dropped rather than rendered
 * as a heading over nothing.
 */
export const settingsNavGroups = (
	audience: SettingsAudience,
): { key: "account" | "workspace"; label: string; items: NavItem[] }[] => {
	const entries = settingsEntriesFor(audience);
	return (["account", "workspace"] as const)
		.map((key) => ({
			key,
			label: SETTINGS_GROUP_LABEL[key],
			items: entries
				.filter((entry) => entry.group === key)
				.map((entry) => entry.item),
		}))
		.filter((group) => group.items.length > 0);
};

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
 * It is the whole eyebrow: a static section name beside it ("Workspace")
 * only repeated what the hub already said.
 */
export function SettingsEyebrow() {
	const orgSlug = useOrgSlug();
	return (
		<Link
			to={SETTINGS_ITEM.to}
			params={{ orgSlug }}
			// The negative margins buy a real target without moving anything: the
			// link is one 13px line of text, and on a phone it is the ONLY way out
			// of a settings page. `-my-3` pairs with `py-3` so the eyebrow row
			// keeps the height every other screen's does.
			className="-my-3 -ml-1 flex w-fit items-center gap-1 py-3 pr-1 pl-1 transition-colors duration-(--dur-fast) hover:text-foreground"
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
	);
}
