import { CaretRightIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ContributorsCard } from "#/components/contributors-card.tsx";
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
 * group of eleven holding both the hour fund and your color theme.
 *
 * The two sections here are the same split the pages' own eyebrows already
 * state: Account over Preferences, Workspace over Organization. Both the
 * sections and their order come from `components/settings-nav.tsx`, which the
 * sidebar's sub-menu reads too — so the menu and this page cannot disagree
 * about what exists, what it is called, or which section it is in.
 *
 * **Two columns, not one.** Twelve rows of icon-and-sentence at 80px each made
 * this page a long scroll for a list of destinations, and the right two thirds
 * of every row were empty. The rows are the same rows, in two columns.
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
 * it. The row tints under the pointer instead of carrying a permanent chevron —
 * twelve identical chevrons down a page say only that twelve things are links,
 * which the labels already said. The arrow arrives on hover, which is where an
 * affordance belongs.
 *
 * No hairline between rows: a two-column grid of ruled rows draws a ladder down
 * each column and nothing across, so the rules stop separating anything and
 * only add lines. The gap is the separation here.
 */
function SettingsRowLink({ item, description }: SettingsEntry) {
	const orgSlug = useOrgSlug();
	return (
		<Link
			to={item.to}
			params={{ orgSlug }}
			className="group/row -mx-2.5 flex items-start gap-3 rounded-lg px-2.5 py-3 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
		>
			<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors duration-(--dur-fast) group-hover/row:text-foreground">
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
				className="mt-2 size-3.5 shrink-0 text-faint opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
			/>
		</Link>
	);
}

function SettingsIndex() {
	const orgSlug = useOrgSlug();
	const { role, isPlatformAdmin } = Route.useRouteContext();
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

			{/* The deployment's own settings, which are not this workspace's — and
			    the only way into them, because `NavItem.to` is typed `OrgRoutePath`
			    and every surface that draws one passes an `orgSlug` it would not
			    have (see `routes/infrastructure/route.tsx`).

			    Drawn as its own section rather than a row under Workspace: it
			    leaves this workspace, and it is the one section here that most
			    people never see at all. */}
			{isPlatformAdmin && (
				<PageSection
					title="Instance"
					contentClassName="grid gap-x-10 sm:grid-cols-2"
				>
					<Link
						to="/infrastructure/admins"
						className="group/row -mx-2.5 flex items-start gap-3 rounded-lg px-2.5 py-3 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
					>
						<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors duration-(--dur-fast) group-hover/row:text-foreground">
							<ShieldCheckIcon className="size-4" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-base font-medium">
								Infrastructure
							</span>
							<span className="mt-0.5 block text-sm leading-normal text-muted-foreground">
								How this deployment runs, starting with who operates it.
							</span>
						</span>
						<CaretRightIcon
							weight="regular"
							aria-hidden
							className="mt-2 size-3.5 shrink-0 text-faint opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
						/>
					</Link>
				</PageSection>
			)}

			{/* The same colophon the sidebar panel closes with, and ONLY below the
			    width where that panel exists (`md`, the sidebar's own breakpoint):
			    on a phone this page IS Settings, so without this the four faces and
			    the commit hash would be desktop-only. On a desktop the panel is
			    already showing them a column away, and two copies of one colophon
			    on one screen is one too many.

			    Full width here rather than the panel's narrow column, because a
			    band sized for a 240px rail reads as a fragment in a page's measure.

			    Bled to the island's own edges, so its rule ends where a
			    `PageSection`'s does — the numbers are `.island-pad`'s, and the
			    inner margin it hands back is the same pair. This renders below
			    `md` only, so the `sm` step is the only one it can meet. */}
			<ContributorsCard className="mt-2 -mx-4 sm:-mx-8 sm:[--colophon-px:2rem] md:hidden" />
		</Page>
	);
}
