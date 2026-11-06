import { createFileRoute } from "@tanstack/react-router";

// GitHub redirects here after an admin installs (or updates) the app, per the
// app's configured Setup URL. Query params: installation_id, setup_action,
// state. We resolve the target org from the signed `state`, confirm the caller
// is an admin of that org, then attach the installation (which independently
// re-verifies the caller controls it). Then bounce back to Integrations.
//
// Without a state nothing is attached here: the installation id is only handed
// on to Integrations, where the admin confirms it (see below).
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
				// An ABSENT state still resolves to the active org, because GitHub
				// produces it legitimately: an App installed (or its repo selection
				// changed) from GitHub's own UI rather than from our Connect button
				// redirects to the Setup URL with no state, as GitHub only echoes a
				// state we put on the install link. But it connects NOTHING. A
				// crafted link arrives the same way, as a top-level GET that carries
				// the admin's cookie, and `connectInstallation`'s own check (the
				// caller owns the installation's GitHub account) does not say which
				// workspace the admin meant: an admin of two workspaces whose GitHub
				// account sees another tenant's installation would attach it to
				// whichever workspace they last opened, where every other admin of
				// it could list the repositories. So the id only goes on to
				// Integrations as a pending choice, and the admin's explicit POST
				// there (`connectGithubInstallation`, behind the server functions'
				// CSRF check) is what connects it. The Slack callback has no such
				// second step and is strict.
				const { verifyOrgState } = await import("@farmer/core/lib/oauth-state");
				const orgId = state
					? verifyOrgState(state, session.user.id)
					: session.session.activeOrganizationId;
				if (!orgId) return redirectTo("/_");

				const { db } = await import("@farmer/core/db");
				const membership = await db.query.member.findFirst({
					where: (m, { and, eq }) =>
						and(eq(m.userId, session.user.id), eq(m.organizationId, orgId)),
				});
				if (
					!membership ||
					(membership.role !== "owner" && membership.role !== "admin")
				) {
					return redirectTo("/_");
				}

				// Set only for a stateless callback: the id Integrations asks about.
				let pendingInstallationId: number | null = null;
				if (
					installationIdRaw &&
					(setupAction === "install" || setupAction === "update")
				) {
					if (!state) {
						const id = Number(installationIdRaw);
						if (Number.isSafeInteger(id) && id > 0) pendingInstallationId = id;
					} else {
						const { githubService } = await import("@farmer/core/services");
						try {
							await githubService.connectInstallation(
								{ organizationId: orgId, userId: session.user.id },
								{ installationId: Number(installationIdRaw) },
							);
						} catch (error) {
							const { loggableError } =
								await import("@farmer/core/lib/loggable-error");
							console.error(
								"[github] setup connect failed",
								loggableError(error),
							);
						}
					}
				}

				const org = await db.query.organization.findFirst({
					where: (o, { eq }) => eq(o.id, orgId),
				});
				if (!org) return redirectTo("/_");
				const back = `/${org.slug}/settings/workspace-integrations`;
				return redirectTo(
					pendingInstallationId === null
						? back
						: `${back}?githubInstallation=${pendingInstallationId}`,
				);
			},
		},
	},
});
