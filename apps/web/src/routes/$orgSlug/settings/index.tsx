import { CaretRightIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import {
	SETTINGS_GROUP_LABEL,
	settingsEntriesFor,
	type SettingsEntry,
} from "#/components/settings-nav.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { myAccessQuery } from "#/queries/access.ts";

/**
 * The index of everything configurable, and the reason six settings pages no
 * longer each need a row in the nav.
 *
 * Before this, `/$orgSlug/settings` was a 404: ten pages shared the prefix and
 * nothing answered at it, so the only way to any of them was a sidebar row, and
 * the sidebar therefore had to carry all ten. That is what made "Workspace" a
 * group of eleven holding both the hour fund and your colour theme.
 *
 * The two sections here are the same split the pages' own eyebrows already
 * state: Account over Preferences, Workspace over Organization. Both the
 * sections and their order come from `components/settings-nav.tsx`, which the
 * sidebar's sub-menu reads too — so the menu and this page can no longer
 * disagree about what exists, what it is called, or which section it is in.
 *
 * **Two columns, not one.** Twelve rows of icon-over-sentence-over-chevron at
 * 125px each made this page 1500px tall for twelve links, which is a lot of
 * scrolling to reach a list of destinations. The rows are the same rows, in two
 * columns, with the icon at the size of the label beside it rather than in a
 * box that outweighed it.
 */
export const Route = createFileRoute("/$orgSlug/settings/")({
	loader: async ({ context, params }) => {
		// Clients is gated on a project role, which the org role cannot answer.
		await context.queryClient.ensureQueryData(myAccessQuery(params.orgSlug));
	},
	component: SettingsIndex,
});

/**
 * One destination: its mark, its name, and the one line saying what is behind
 * it. The row tints under the pointer rather than carrying a permanent
 * chevron — twelve identical chevrons down a page say only that twelve things
 * are links, which the labels already said. The arrow arrives on hover, which
 * is where an affordance belongs.
 */
function SettingsRowLink({ item, description }: SettingsEntry) {
	const orgSlug = useOrgSlug();
	return (
		<Link
			to={item.to}
			params={{ orgSlug }}
			className="group/row -mx-2.5 flex items-start gap-3 rounded-lg px-2.5 py-3 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/16"
		>
			<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors duration-(--dur-fast) group-hover/row:text-foreground">
				<item.icon className="size-4" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-base font-medium">{item.label}</span>
				<span className="mt-0.5 block text-sm leading-normal text-muted-foreground">
					{description}
				</span>
			</span>
			<CaretRightIcon
				weight="regular"
				aria-hidden
				className="row-actions mt-2 size-3.5 shrink-0 text-faint"
			/>
		</Link>
	);
}

function SettingsIndex() {
	const orgSlug = useOrgSlug();
	const { role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const { data: access } = useSuspenseQuery(myAccessQuery(orgSlug));
	// Same gate as the Clients nav row: a Team Lead or PM may run the client
	// list, not just an Admin.
	const canManageClients = isAdmin || access.isLeadSomewhere;

	// Filtered, never rendered as a disabled row: a settings page you may not
	// open is not a setting you have, it is somebody else's.
	const entries = settingsEntriesFor({ isAdmin, canManageClients });
	const account = entries.filter((entry) => entry.group === "account");
	const workspace = entries.filter((entry) => entry.group === "workspace");

	return (
		<Page>
			<PageHeader
				title="Settings"
				lede={
					isAdmin
						? "Your own account, and how this workspace runs."
						: "Your own account, and what this workspace has decided for everyone."
				}
			/>

			<PageSection
				title={SETTINGS_GROUP_LABEL.account}
				contentClassName="grid gap-x-10 sm:grid-cols-2"
			>
				{account.map((entry) => (
					<SettingsRowLink key={entry.item.to} {...entry} />
				))}
			</PageSection>

			{workspace.length > 0 && (
				<PageSection
					title={SETTINGS_GROUP_LABEL.workspace}
					contentClassName="grid gap-x-10 sm:grid-cols-2"
				>
					{workspace.map((entry) => (
						<SettingsRowLink key={entry.item.to} {...entry} />
					))}
				</PageSection>
			)}
		</Page>
	);
}
