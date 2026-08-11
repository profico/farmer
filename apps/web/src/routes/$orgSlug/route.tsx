import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { MobileTabBar } from "#/components/mobile-tab-bar.tsx";
import { AppShellLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { getMyRole, requireSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import { setActiveOrgBySlug } from "#/server/organization.ts";

// Query keys are org-blind (["projects"], ["time-entries", from, to], …), so
// the cache must not survive a workspace switch — it would serve the previous
// org's data under the new org. The org the cache belongs to is stamped onto
// the QueryClient instance itself, not a module variable: route code-splitting
// compiles `component` into a separate module from the rest of the route
// options, so a module-level variable here would be two disconnected copies.
// OrgLayout seeds the stamp on hydration (beforeLoad doesn't re-run on the
// client for the SSR'd initial match); beforeLoad then compares and clears on
// later navigations, before the new org's loaders repopulate the cache. On the
// server each SSR request gets a fresh QueryClient, so no stamp survives
// between requests there.
type OrgStampedQueryClient = QueryClient & { lastOrganizationId?: string };

export const Route = createFileRoute("/$orgSlug")({
	beforeLoad: async ({ params, context }) => {
		const session = await requireSession();
		const config = await getPublicAppConfig();
		// Single-org mode keeps the `/$orgSlug` prefix — tenancy stays an explicit
		// route parameter rather than becoming ambient, which is the same rule the
		// service layer is built on — and simply refuses to answer under any other
		// slug.
		if (config.org && params.orgSlug !== config.org.slug) {
			throw redirect({ to: "/$orgSlug", params: { orgSlug: config.org.slug } });
		}
		const organization = await setActiveOrgBySlug({ data: params.orgSlug });
		if (!organization) {
			// `/` resolves where a session with no active org belongs: the marketing
			// page in multi-tenant mode, the no-access dead end in single-org mode.
			throw redirect({ to: "/" });
		}
		const role = await getMyRole();
		const queryClient = context.queryClient as OrgStampedQueryClient;
		if (
			queryClient.lastOrganizationId &&
			queryClient.lastOrganizationId !== organization.id
		) {
			// Don't clear(): removing actively-observed queries makes the
			// still-mounted outgoing page re-render with undefined data (and a
			// dead route context) mid-transition instead of suspending. Purge
			// only what nothing is watching; actively-watched queries are
			// refetched under the new org and awaited, so observers swap old-org
			// data for new-org data in one step before the navigation commits.
			queryClient.removeQueries({ type: "inactive" });
			await queryClient.invalidateQueries();
		}
		queryClient.lastOrganizationId = organization.id;
		return { session, organization, role, singleOrg: config.singleOrgMode };
	},
	// The router-wide default renders a lone page skeleton, which is right for a
	// route *inside* this layout — it lands in the Outlet, with the real sidebar
	// already beside it. It is wrong for this route, whose pending state replaces
	// the layout itself: the frame, the sidebar and the ground between them all
	// live in OrgLayout below, so the default left a bare island floating on the
	// page. This one draws the shell it is standing in for.
	pendingComponent: AppShellLoadingSkeleton,
	component: OrgLayout,
});

function OrgLayout() {
	const { session, organization, role, singleOrg } = Route.useRouteContext();
	const queryClient = useQueryClient() as OrgStampedQueryClient;
	queryClient.lastOrganizationId ??= organization.id;
	const isAdmin = role === "owner" || role === "admin";

	return (
		<SidebarProvider>
			<AppSidebar
				orgSlug={organization.slug}
				organizationName={organization.name}
				organizationLogo={organization.logo}
				isAdmin={isAdmin}
				userName={session.user.name}
				userEmail={session.user.email}
				singleOrg={singleOrg}
			/>
			<SidebarInset>
				<Outlet />
			</SidebarInset>
			<MobileTabBar
				orgSlug={organization.slug}
				isAdmin={isAdmin}
				userName={session.user.name}
				userEmail={session.user.email}
			/>
		</SidebarProvider>
	);
}
