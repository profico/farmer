import { createFileRoute } from "@tanstack/react-router";

// Slack redirects here after an admin approves the install, per the app's
// configured Redirect URL. Query params: code, state (or error, if they hit
// Cancel). We resolve the target org from the signed `state`, confirm the caller
// is still an admin of that org, then trade the code for a bot token. Then
// bounce back to Integrations.
//
// This mirrors api/github/setup.ts deliberately — same signed-state helper, same
// re-check of the membership rather than trusting the redirect, same landing
// page — because they are the same problem: an admin leaves the app, approves
// something at a third party, and comes back holding a credential we must
// attribute to exactly one org.
export const Route = createFileRoute("/api/slack/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");

				const redirectTo = (path: string) =>
					Response.redirect(new URL(path, url.origin).toString(), 302);

				const { auth } = await import("@farmer/core/auth");
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) return redirectTo("/login");

				// No valid state, no install — and in particular no falling back to the
				// session's active org. That fallback was a login CSRF in reverse: any
				// page could send a signed-in admin to this URL with the attacker's
				// OWN Slack `code`, and the attacker's workspace would be installed
				// into the admin's org, receiving every reminder and the name of
				// everyone it matched by email. Unlike the GitHub setup redirect,
				// nothing downstream re-checks that the code belongs to this person,
				// so the signed, user-bound, expiring state is the only proof the
				// admin started this round trip.
				const { verifyOrgState } = await import("@farmer/core/lib/oauth-state");
				const orgId = state ? verifyOrgState(state, session.user.id) : null;
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

				const org = await db.query.organization.findFirst({
					where: (o, { eq }) => eq(o.id, orgId),
				});
				const back = org
					? `/${org.slug}/settings/workspace-integrations`
					: "/_";

				// Cancelled at Slack's consent screen, or no code came back. Nothing to
				// undo — the install simply didn't happen.
				if (!code) return redirectTo(back);

				const { slackService } = await import("@farmer/core/services");
				try {
					await slackService.completeInstall(
						{ organizationId: orgId, userId: session.user.id },
						code,
					);
				} catch (error) {
					const { loggableError } =
						await import("@farmer/core/lib/loggable-error");
					console.error("[slack] oauth callback failed", loggableError(error));
					return redirectTo(`${back}?slack=failed`);
				}

				return redirectTo(`${back}?slack=connected`);
			},
		},
	},
});
