import { createFileRoute } from "@tanstack/react-router";

// GitHub redirects here after an admin installs (or updates) the app, per the
// app's configured Setup URL. Query params: installation_id, setup_action,
// state. We resolve the target org from the signed `state`, confirm the caller
// is an admin of that org, then attach the installation (which independently
// re-verifies the caller controls it). Then bounce back to Integrations.
export const Route = createFileRoute("/api/github/setup")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const installationIdRaw = url.searchParams.get("installation_id");
				const setupAction = url.searchParams.get("setup_action");
				const state = url.searchParams.get("state");

				const redirectTo = (path: string) =>
					Response.redirect(new URL(path, url.origin).toString(), 302);

				const { auth } = await import("@farmer/core/auth");
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) return redirectTo("/login");

				// A state that is present must verify: signed by us, for THIS user,
				// recently. An invalid one is refused outright rather than falling
				// back, since it can only be stale, someone else's, or forged.
				//
				// An ABSENT state is the one case that still falls back to the active
				// org, because GitHub produces it legitimately: an App installed (or
				// its repo selection changed) from GitHub's own UI rather than from
				// our Connect button redirects to the Setup URL with no state, as
				// GitHub only echoes a state we put on the install link. Refusing it
				// would leave those installs unreachable. It stays safe because
				// `connectInstallation` independently requires the installation to
				// appear in the caller's OWN GitHub installation list, read with
				// their own token — so a crafted link can at most attach something
				// this admin already controls to an org they already administer,
				// which is not a thing an attacker gains from. The Slack callback has
				// no such second check and is strict.
				const { verifyOrgState } = await import("@farmer/core/lib/oauth-state");
				const orgId = state
					? verifyOrgState(state, session.user.id)
					: session.session.activeOrganizationId;
				if (!orgId) return redirectTo("/");

				const { db } = await import("@farmer/core/db");
				const membership = await db.query.member.findFirst({
					where: (m, { and, eq }) =>
						and(eq(m.userId, session.user.id), eq(m.organizationId, orgId)),
				});
				if (
					!membership ||
					(membership.role !== "owner" && membership.role !== "admin")
				) {
					return redirectTo("/");
				}

				if (
					installationIdRaw &&
					(setupAction === "install" || setupAction === "update")
				) {
					const { githubService } = await import("@farmer/core/services");
					try {
						await githubService.connectInstallation(
							{ organizationId: orgId, userId: session.user.id },
							{ installationId: Number(installationIdRaw) },
						);
					} catch (error) {
						console.error("[github] setup connect failed", error);
					}
				}

				const org = await db.query.organization.findFirst({
					where: (o, { eq }) => eq(o.id, orgId),
				});
				return redirectTo(org ? `/${org.slug}/settings/integrations` : "/");
			},
		},
	},
});
