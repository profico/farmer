import { CaretRightIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import {
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
 * group of eleven holding both the close sheet and your colour theme.
 *
 * The two sections here are the same split the pages' own eyebrows already
 * state — "Your account" over Preferences, "Workspace" over Organization. My
 * schedule, Recurring blocks, Clients and People are listed here AND kept as
 * nav rows: an index that omitted a settings page would not be an index.
 *
 * The rows themselves come from `components/settings-nav.tsx`, which the
 * sidebar's sub-menu reads too, so the two lists cannot disagree about what
 * exists.
 */
export const Route = createFileRoute("/$orgSlug/settings/")({
	loader: async ({ context, params }) => {
		// Clients is gated on a project role, which the org role cannot answer.
		await context.queryClient.ensureQueryData(myAccessQuery(params.orgSlug));
	},
	component: SettingsIndex,
});

function SettingsRowLink({ item, description }: SettingsEntry) {
	const orgSlug = useOrgSlug();
	return (
		<Link
			to={item.to}
			params={{ orgSlug }}
			className="group flex items-center gap-4 border-t border-line2 py-4 transition-colors duration-(--dur-fast) first:border-t-0 first:pt-0 last:pb-0"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors duration-(--dur-fast) group-hover:text-foreground">
				<item.icon className="size-4.5" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-base font-medium">{item.label}</span>
				<span className="mt-0.5 block max-w-[68ch] text-sm leading-normal text-muted-foreground">
					{description}
				</span>
			</span>
			<CaretRightIcon
				weight="regular"
				className="size-4 shrink-0 text-faint transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
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
				eyebrow="Settings"
				title="Settings"
				lede={
					isAdmin
						? "Your own account, and how this workspace runs."
						: "Your own account, and what this workspace has decided for everyone."
				}
			/>

			<PageSection title="Your account">
				{account.map((entry) => (
					<SettingsRowLink key={entry.item.to} {...entry} />
				))}
			</PageSection>

			{workspace.length > 0 && (
				<PageSection title="Workspace">
					{workspace.map((entry) => (
						<SettingsRowLink key={entry.item.to} {...entry} />
					))}
				</PageSection>
			)}
		</Page>
	);
}
