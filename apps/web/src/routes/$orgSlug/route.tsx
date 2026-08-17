import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { MobileTabBar } from "#/components/mobile-tab-bar.tsx";
import { AppShellLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { getPublicAppConfig } from "#/server/config.ts";
import { enterOrganization } from "#/server/organization.ts";

// Nothing here has to reconcile the query cache with the workspace any more.
//
// Query keys used to be org-blind (["projects"], ["time-entries", from, to]),
// so an entry cached under one workspace was a valid-looking answer under the
// next, and this route carried the machinery to stop that: the org id stamped
// onto the QueryClient instance (not a module variable — route code-splitting
// compiles `component` into a separate module from the route options, so a
// module-level one would have been two disconnected copies), compared on every
// navigation, then a staged purge on mismatch that removed only inactive
// queries and invalidated the rest, because clear() made the still-mounted
// outgoing page re-render against a dead cache mid-transition.
//
// Every key now names its organization (queries/keys.ts), so the previous
// workspace's entries are unreachable rather than dangerous. There is nothing
// to purge and no ordering to get right.

export const Route = createFileRoute("/$orgSlug")({
	beforeLoad: async ({ params }) => {
		// Two round trips, in parallel, where there used to be four in sequence —
		// and this runs on every client-side navigation into every org route, so
		// it is the fixed cost in front of every screen in the app.
		const [entered, config] = await Promise.all([
			enterOrganization({ data: params.orgSlug }),
			getPublicAppConfig(),
		]);

		// Single-org mode keeps the `/$orgSlug` prefix — tenancy stays an explicit
		// route parameter rather than becoming ambient, which is the same rule the
		// service layer is built on — and simply refuses to answer under any other
		// slug.
		if (config.org && params.orgSlug !== config.org.slug) {
			throw redirect({ to: "/$orgSlug", params: { orgSlug: config.org.slug } });
		}

		if (!entered) {
			// No such workspace, or not a member of it — deliberately the same
			// outcome. `/` resolves where a session with no active org belongs: the
			// marketing page in multi-tenant mode, the no-access dead end in
			// single-org mode.
			throw redirect({ to: "/" });
		}

		return {
			session: entered.session,
			organization: entered.organization,
			role: entered.role,
			singleOrg: config.singleOrgMode,
			assistantEnabled: config.assistantEnabled,
		};
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
	const { session, organization, role, singleOrg, assistantEnabled } =
		Route.useRouteContext();
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
				assistantEnabled={assistantEnabled}
			/>
			<SidebarInset>
				<Outlet />
			</SidebarInset>
			<MobileTabBar
				orgSlug={organization.slug}
				isAdmin={isAdmin}
				userName={session.user.name}
				userEmail={session.user.email}
				assistantEnabled={assistantEnabled}
			/>
		</SidebarProvider>
	);
}
