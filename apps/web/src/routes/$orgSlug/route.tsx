import { usePostHog } from "@posthog/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { AssistantRunsProvider } from "#/components/assistant/assistant-runs.tsx";
import { Field } from "#/components/field.tsx";
import { MobileTabBar } from "#/components/mobile-tab-bar.tsx";
import { AppShellLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { isOrgPlaceholder, withOrgSlug } from "#/lib/org-redirect.ts";
import { assistantSettingsQuery } from "#/queries/assistant.ts";
import { directoryQuery } from "#/queries/members.ts";
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
	beforeLoad: async ({ params, location }) => {
		// Two round trips, in parallel, where there used to be four in sequence —
		// and this runs on every client-side navigation into every org route, so
		// it is the fixed cost in front of every screen in the app.
		const [entered, config] = await Promise.all([
			enterOrganization({ data: params.orgSlug }),
			getPublicAppConfig(),
		]);

		// Sign-in comes back to the page that was asked for, placeholder and all,
		// so a shared link survives the round trip through Google.
		if (entered.kind === "signed-out") {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}

		// Single-org mode keeps the `/$orgSlug` prefix — tenancy stays an explicit
		// route parameter rather than becoming ambient, which is the same rule the
		// service layer is built on — and answers any other slug with the same
		// page in its one workspace.
		if (config.org && params.orgSlug !== config.org.slug) {
			throw redirect({ href: withOrgSlug(location.href, config.org.slug) });
		}

		if (entered.kind === "elsewhere") {
			// A placeholder, no such workspace, or not a member of it — the last
			// two deliberately the same outcome. A placeholder with one workspace
			// is the answer without asking. A real slug always goes through the
			// chooser, even with one workspace: rewriting `/acme/projects/p_123`
			// to `/beta/…` in silence lands on a not-found in the wrong workspace
			// with nothing to say why, where the chooser says "You are not a member
			// of acme". None is `/no-access`, which explains it and lists any live
			// invitations — and keeps the link, for a sign-in to another account.
			if (entered.onlySlug && isOrgPlaceholder(params.orgSlug)) {
				throw redirect({ href: withOrgSlug(location.href, entered.onlySlug) });
			}
			if (entered.count > 0) {
				throw redirect({
					to: "/choose-organization",
					search: { redirect: location.href },
				});
			}
			throw redirect({ to: "/no-access", search: { redirect: location.href } });
		}

		return {
			session: entered.session,
			organization: entered.organization,
			role: entered.role,
			// Operates the deployment, as opposed to administering this workspace
			// — `user.role`, not `member.role`. The only thing it opens
			// is Impersonate on Settings → People.
			isPlatformAdmin: entered.isPlatformAdmin,
			// The name of the person this session currently IS, when it got there by
			// impersonation. Null the rest of the time, which is almost always.
			impersonating: entered.impersonating,
			singleOrg: config.singleOrgMode,
			assistantEnabled: config.assistantEnabled,
			// The MCP server's own switch. Nothing in the nav reads it — an MCP
			// client is not a screen — but Settings → Integrations shows the
			// connection URL, and a URL for an endpoint that 404s is worse than no
			// URL at all.
			mcpEnabled: config.mcpEnabled,
			// The CLI's own switch, for the same reason: Settings → Integrations
			// shows the install commands only when the script behind them answers.
			cliEnabled: config.cliEnabled,
			appOrigin: config.appOrigin,
			// Development-only email + password sign-in. Settings → Preferences
			// hides its whole "Sign-in methods" section when this is off, since
			// there is nothing there to change on a deployed instance.
			devAuth: config.devAuth,
			// Whether an object store is configured. The icon picker and Settings →
			// Organization offer an upload only when it is.
			uploadsEnabled: config.uploadsEnabled,
		};
	},
	// The router-wide default renders a lone page skeleton, which is right for a
	// route *inside* this layout — it lands in the Outlet, with the real sidebar
	// already beside it. It is wrong for this route, whose pending state replaces
	// the layout itself: the frame, the sidebar and the ground between them all
	// live in OrgLayout below, so the default left a bare island floating on the
	// page. This one draws the shell it is standing in for.
	pendingComponent: AppShellLoadingSkeleton,
	loader: async ({ context }) => {
		// Not awaited: every avatar in the app reads this (see
		// `components/person-avatar.tsx`) and every one of them degrades to
		// initials while it is in flight, so blocking the whole workspace on a
		// list of faces would trade a readable screen for a pending one.
		void context.queryClient.prefetchQuery(
			directoryQuery(context.organization.slug),
		);
		// The assistant settings ARE awaited, and only fetched when the deployment
		// has the feature at all. Whether this org has connected OpenRouter decides
		// whether the nav shows a Chat tab, so arriving a moment late means the tab
		// appears and then vanishes — the one thing worse than not having it.
		if (!context.assistantEnabled) return;
		await context.queryClient.ensureQueryData(
			assistantSettingsQuery(context.organization.slug),
		);
	},
	component: OrgLayout,
});

function OrgLayout() {
	const {
		session,
		organization,
		role,
		isPlatformAdmin,
		singleOrg,
		assistantEnabled,
		impersonating,
	} = Route.useRouteContext();
	const posthog = usePostHog();
	const isAdmin = role === "owner" || role === "admin";

	useEffect(() => {
		posthog.identify(session.user.id, {
			email: session.user.email,
			name: session.user.name,
			role,
		});
	}, [posthog, role, session.user.email, session.user.id, session.user.name]);

	// Three switches decide whether the assistant exists for this reader, and
	// only the first one was ever consulted here: the deployment flag
	// (`ASSISTANT_ENABLED`), whether an admin has connected a key, and whether
	// they have paused it for this org. A nav that reads only the first offers a
	// Chat tab whose destination is a page explaining it isn't connected.
	//
	// Not a suspense query, like `myAccess` in the sidebar: the whole app must
	// not block on it. The loader above means it is normally already in cache, so
	// the tabs are settled on the first paint rather than popping in.
	const { data: assistantSettings } = useQuery({
		...assistantSettingsQuery(organization.slug),
		enabled: assistantEnabled,
	});
	const assistantAvailable =
		assistantEnabled &&
		Boolean(assistantSettings?.configured && assistantSettings.enabled);

	return (
		// Above the sidebar and the outlet both, because an assistant turn belongs
		// to its thread rather than to the screen that started it: the thread list
		// in the sidebar marks the threads that are working, the assistant page
		// renders the one it has open, and a turn carries on while you go and look
		// at something else.
		<AssistantRunsProvider orgSlug={organization.slug}>
			{/* Outside the frame on purpose: SidebarProvider's element IS
			    `.app-frame`, so anything inside it is a flex child of the two
			    islands. The field is a fixed sibling painted behind them. */}
			<Field timezone={organization.timezone} />
			<SidebarProvider>
				<AppSidebar
					orgSlug={organization.slug}
					organizationName={organization.name}
					organizationLogo={organization.logo}
					isAdmin={isAdmin}
					isPlatformAdmin={isPlatformAdmin}
					userName={session.user.name}
					userEmail={session.user.email}
					userImage={session.user.image ?? null}
					singleOrg={singleOrg}
					assistantAvailable={assistantAvailable}
					timezone={organization.timezone}
					impersonating={impersonating}
				/>
				<SidebarInset>
					<Outlet />
				</SidebarInset>
				<MobileTabBar
					orgSlug={organization.slug}
					isAdmin={isAdmin}
					isPlatformAdmin={isPlatformAdmin}
					userName={session.user.name}
					userEmail={session.user.email}
					userImage={session.user.image ?? null}
					assistantAvailable={assistantAvailable}
					timezone={organization.timezone}
				/>
			</SidebarProvider>
		</AssistantRunsProvider>
	);
}
