import { usePostHog } from "@posthog/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
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

	return (
		<div className="flex min-h-[calc(100*var(--svh))] items-center justify-center p-4">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle className="h2">You've been invited</CardTitle>
					<CardDescription className="text-base">
						Join{" "}
						<strong className="text-foreground">
							{org ?? "the organization"}
						</strong>{" "}
						as {role ?? "member"}
						{email ? ` — invited as ${email}` : ""}.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{/* One button, because Google both signs in and signs up: a
					    first-time invitee gets an account on the way through. */}
					{!session && (
						<Button
							nativeButton={false}
							render={
								<Link
									to="/login"
									search={{ redirect: redirectTarget, ...inviteContext }}
								>
									Continue with Google
								</Link>
							}
						/>
					)}
					{session && emailMismatch && (
						<>
							<p className="text-sm text-muted-foreground">
								You're signed in as{" "}
								<span className="font-medium text-foreground">
									{session.user.email}
								</span>
								, but this invite is for a different address.
							</p>
							<Button variant="outline" onClick={handleSignOutAndSwitch}>
								Sign out and use a different account
							</Button>
						</>
					)}
					{session && !emailMismatch && (
						<Button onClick={handleAccept} disabled={accepting}>
							Accept invitation
						</Button>
					)}
					<Button
						variant="ghost"
						nativeButton={false}
						render={<Link to="/">Cancel</Link>}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
