import { usePostHog } from "@posthog/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { requireSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import { listMyPendingInvitations } from "#/server/organization.ts";

/**
 * The dead end for a signed-in user who belongs to no organization.
 *
 * It exists to break a redirect loop: without it, `/` sends a member-less user
 * to their workspace, the workspace guard sends them back to `/`, forever. It
 * is reachable in single-org mode (invitation revoked, or an account that
 * predates the mode being switched on) and harmless elsewhere.
 *
 * It also does the recovery, not just the apology: a user who signed in from
 * the front door rather than from their invite link has a live invitation
 * sitting unaccepted, and this is where they can accept it.
 */
export const Route = createFileRoute("/no-access")({
	loader: async () => {
		await requireSession();
		const [config, invitations] = await Promise.all([
			getPublicAppConfig(),
			listMyPendingInvitations(),
		]);
		return { config, invitations };
	},
	component: NoAccessPage,
});

function NoAccessPage() {
	const { config, invitations } = Route.useLoaderData();
	const navigate = useNavigate();
	const posthog = usePostHog();
	const [busyId, setBusyId] = useState<string | null>(null);

	const workspace = config.org?.name ?? "this workspace";

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
		await navigate({ to: "/" });
	};

	const handleSignOut = async () => {
		await authClient.signOut();
		posthog.reset();
		await navigate({ to: "/login" });
	};

	return (
		<div className="flex min-h-[calc(100*var(--svh))] items-center justify-center p-4">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle className="h2">
						{invitations.length ? "One step left" : "No access yet"}
					</CardTitle>
					<CardDescription className="text-base">
						{invitations.length
							? "You have an invitation waiting. Accept it to get in."
							: `Your account isn't a member of ${workspace}. Ask an admin to send you an invitation.`}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{invitations.map((invitation) => (
						<Button
							key={invitation.id}
							onClick={() => handleAccept(invitation.id)}
							disabled={busyId !== null}
						>
							Join {invitation.organizationName} as{" "}
							{invitation.role ?? "member"}
						</Button>
					))}
					<Button variant="outline" onClick={handleSignOut}>
						Sign out
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
