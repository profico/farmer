import { ArrowRightIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { AuthHead, OrgMark } from "#/components/site/auth-parts.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { orgSlugOf, safeRedirectPath } from "#/lib/org-redirect.ts";
import { requireSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import {
	acceptImportClaim,
	declineImportClaim,
	listMyImportClaims,
	listMyPendingInvitations,
} from "#/server/organization.ts";

/**
 * The dead end for a signed-in user who belongs to no organization.
 *
 * It exists to break a redirect loop: without it, `/` sends a member-less user
 * to their workspace, the workspace guard sends them back to `/`, forever. It
 * is reachable in single-org mode (invitation revoked, or an account that
 * predates the mode being switched on) and harmless elsewhere.
 *
 * It also does the recovery, not just the apology: a user who signed in from
 * `/` rather than from their invite link has a live invitation
 * sitting unaccepted, and this is where they can accept it.
 *
 * It also answers a Harvest import's pending claims: a workspace that imported
 * this person's history made a membership they never asked for, and they
 * cannot open it until they join here (`importClaimsService`). Declining
 * leaves the workspace; the history stays with it.
 */
const searchSchema = z.object({
	// The page the reader was trying to open, when a workspace guard sent them
	// here. Kept through sign-out, so switching to the account that IS a member
	// still lands on the link.
	redirect: z.string().optional(),
});

export const Route = createFileRoute("/no-access")({
	validateSearch: searchSchema,
	loader: async () => {
		const session = await requireSession();
		const [config, invitations, claims] = await Promise.all([
			getPublicAppConfig(),
			listMyPendingInvitations(),
			listMyImportClaims(),
		]);
		return { config, invitations, claims, email: session.user.email };
	},
	component: NoAccessPage,
});

function NoAccessPage() {
	const { config, invitations, claims, email } = Route.useLoaderData();
	const target = safeRedirectPath(Route.useSearch().redirect);
	const navigate = useNavigate();
	const router = useRouter();
	const posthog = usePostHog();
	const [busyId, setBusyId] = useState<string | null>(null);
	const [declining, setDeclining] = useState(false);

	const handleAccept = async (invitationId: string) => {
		setBusyId(invitationId);
		const { error } = await authClient.organization.acceptInvitation({
			invitationId,
		});
		setBusyId(null);
		if (error) {
			toast.error(error.message ?? "Could not accept invitation");
			return;
		}
		// Into the link that was asked for, which the guard resolves against the
		// workspace just joined.
		if (target) await navigate({ href: target });
		else await navigate({ to: "/" });
	};

	const handleClaim = async (
		organizationId: string,
		answer: "join" | "decline",
	) => {
		setBusyId(organizationId);
		setDeclining(answer === "decline");
		try {
			if (answer === "decline") {
				await declineImportClaim({ data: { organizationId } });
				await router.invalidate();
				return;
			}
			const { slug } = await acceptImportClaim({ data: { organizationId } });
			// The link that was asked for when it points into this workspace,
			// else the workspace's home. `enterOrganization` points the session
			// at it on the way in.
			if (target && orgSlugOf(target) === slug) {
				await navigate({ href: target });
			} else {
				await navigate({ to: "/$orgSlug", params: { orgSlug: slug } });
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not answer the claim",
			);
		} finally {
			setBusyId(null);
		}
	};

	const handleSignOut = async () => {
		await authClient.signOut();
		posthog.reset();
		await navigate({
			to: "/login",
			search: target ? { redirect: target } : {},
		});
	};

	return (
		<AuthSplitPanel brand={config.org}>
			<AuthHead title="You're signed in, but not in a workspace">
				{config.org ? (
					<>
						{config.org.name} is invite-only, and <b>{email}</b> isn't a member
						yet.
					</>
				) : (
					<>
						<b>{email}</b> isn't a member of a workspace here yet.
					</>
				)}
			</AuthHead>

			{claims.length > 0 && (
				<div className="fm-auth-actions">
					{claims.map((claim) => (
						<div key={claim.organizationId} className="fm-auth-invite">
							<OrgMark name={claim.name} logo={claim.logo} size="md" />
							<div className="fm-auth-invite-text">
								<div className="fm-auth-strong">{claim.name}</div>
								<div className="fm-auth-ws-meta">
									{claim.name} imported your history from Harvest. Join to see
									it.
								</div>
							</div>
							<button
								type="button"
								className="fm-btn fm-btn-sm fm-btn-outline"
								onClick={() => handleClaim(claim.organizationId, "decline")}
								disabled={busyId !== null}
							>
								{busyId === claim.organizationId && declining
									? "Declining…"
									: "Decline"}
							</button>
							<button
								type="button"
								className="fm-btn fm-btn-sm"
								onClick={() => handleClaim(claim.organizationId, "join")}
								disabled={busyId !== null}
							>
								{busyId === claim.organizationId && !declining
									? "Joining…"
									: "Join"}
								<ArrowRightIcon size={14} aria-hidden />
							</button>
						</div>
					))}
				</div>
			)}

			{invitations.length ? (
				<div className="fm-auth-actions">
					<p className="fm-auth-note" data-tone="fg">
						{invitations.length === 1
							? "You have an invitation waiting. Accept it to get in."
							: "You have invitations waiting. Accept one to get in."}
					</p>
					{invitations.map((invitation) => (
						<div key={invitation.id} className="fm-auth-invite">
							<OrgMark name={invitation.organizationName} size="md" />
							<div className="fm-auth-invite-text">
								<div className="fm-auth-strong">
									{invitation.organizationName}
								</div>
								<div className="fm-auth-ws-meta">
									{roleLabel(invitation.role)}
								</div>
							</div>
							<button
								type="button"
								className="fm-btn fm-btn-sm"
								onClick={() => handleAccept(invitation.id)}
								disabled={busyId !== null}
							>
								{busyId === invitation.id ? "Joining…" : "Accept"}
								<ArrowRightIcon size={14} aria-hidden />
							</button>
						</div>
					))}
				</div>
			) : claims.length > 0 ? null : (
				<div className="fm-auth-callout">
					<EnvelopeSimpleIcon size={20} weight="duotone" aria-hidden />
					<span>
						Ask an administrator to invite{" "}
						<b className="fm-auth-strong">{email}</b>. The invitation arrives by
						email, and in Slack when the workspace has Slack connected.
					</span>
				</div>
			)}

			<div className="fm-auth-switch">
				<span className="fm-muted">Wrong account?</span>
				<button type="button" className="fm-auth-link" onClick={handleSignOut}>
					Sign out
				</button>
			</div>
		</AuthSplitPanel>
	);
}

/** "member" → "Member": the role as a person reads it. */
const roleLabel = (role: string | null) => {
	const value = role ?? "member";
	return value.charAt(0).toUpperCase() + value.slice(1);
};
