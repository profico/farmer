import { CheckIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { AuthHead, OrgMark } from "#/components/site/auth-parts.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { getSession } from "#/server/auth.ts";

export const Route = createFileRoute("/accept-invite/$invitationId")({
	validateSearch: z.object({
		email: z.string().optional(),
		org: z.string().optional(),
		orgSlug: z.string().optional(),
		role: z.string().optional(),
	}),
	beforeLoad: async () => {
		const session = await getSession();
		return { session };
	},
	component: AcceptInvitePage,
});

function AcceptInvitePage() {
	const { invitationId } = Route.useParams();
	const { email, org, orgSlug, role } = Route.useSearch();
	const { session } = Route.useRouteContext();
	const navigate = useNavigate();
	const posthog = usePostHog();
	const [accepting, setAccepting] = useState(false);

	const redirectTarget = `/accept-invite/${invitationId}`;
	// Forwarded as `/login`'s own search params (not appended to
	// `redirectTarget` itself — TanStack Router's `to` is a bare pathname, it
	// doesn't parse a "?query" suffix out of a plain string) so this page can
	// still render its context once the visitor lands back here post-auth.
	const inviteContext = { email, org, orgSlug, role };

	const emailMismatch =
		!!email &&
		!!session &&
		session.user.email.toLowerCase() !== email.toLowerCase();

	const handleAccept = async () => {
		setAccepting(true);
		const { error } = await authClient.organization.acceptInvitation({
			invitationId,
		});
		setAccepting(false);
		if (error) {
			toast.error(error.message ?? "Could not accept invitation");
			return;
		}
		await navigate({ to: "/" });
	};

	const handleSignOutAndSwitch = async () => {
		await authClient.signOut();
		posthog.reset();
		await navigate({
			to: "/login",
			search: { redirect: redirectTarget, ...inviteContext },
		});
	};

	const orgName = org ?? "the organization";
	const who = session
		? { label: "Signed in as", value: session.user.email }
		: email
			? { label: "Invited as", value: email }
			: null;

	return (
		<AuthSplitPanel>
			<AuthHead title="You've been invited">
				You're invited to track time in {org ? <b>{org}</b> : "a workspace"}.
			</AuthHead>

			<div className="fm-auth-list">
				<div className="fm-auth-org-card-head">
					<OrgMark name={orgName} size="lg" />
					<div className="fm-auth-org-card-name">{orgName}</div>
				</div>
				<div className="fm-auth-facts" data-single={who ? undefined : ""}>
					<div>
						<div className="fm-auth-fact-label">Role</div>
						{roleLabel(role)}
					</div>
					{who ? (
						<div>
							<div className="fm-auth-fact-label">{who.label}</div>
							{who.value}
						</div>
					) : null}
				</div>
			</div>

			{session && emailMismatch ? (
				<div className="fm-auth-actions">
					<p className="fm-auth-note">
						You're signed in as{" "}
						<b className="fm-auth-strong">{session.user.email}</b>, but this
						invite is for <b className="fm-auth-strong">{email}</b>.
					</p>
					<button
						type="button"
						className="fm-btn fm-btn-outline fm-btn-block"
						onClick={handleSignOutAndSwitch}
					>
						Sign out and use a different account
					</button>
				</div>
			) : null}

			<div className="fm-auth-row">
				{/* One button, because signing in with a provider also signs up: a
				    first-time invitee gets an account on the way through. */}
				{!session ? (
					<Link
						to="/login"
						search={{ redirect: redirectTarget, ...inviteContext }}
						className="fm-btn fm-auth-grow"
					>
						Sign in to accept
					</Link>
				) : null}
				{session && !emailMismatch ? (
					<button
						type="button"
						className="fm-btn fm-auth-grow"
						onClick={handleAccept}
						disabled={accepting}
					>
						<CheckIcon size={16} aria-hidden />
						{org ? `Accept and open ${org}` : "Accept invitation"}
					</button>
				) : null}
				<Link
					to="/"
					className={
						session && emailMismatch
							? "fm-btn fm-btn-outline fm-auth-grow"
							: "fm-btn fm-btn-outline"
					}
				>
					Cancel
				</Link>
			</div>
		</AuthSplitPanel>
	);
}

/** "member" → "Member": the role as a person reads it. */
const roleLabel = (role: string | undefined) => {
	const value = role ?? "member";
	return value.charAt(0).toUpperCase() + value.slice(1);
};
