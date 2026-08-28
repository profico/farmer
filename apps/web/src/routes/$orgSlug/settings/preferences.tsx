import { GoogleLogoIcon, KeyIcon } from "@phosphor-icons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { NotificationSettings } from "#/components/notification-settings.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Page,
	PageHeader,
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { authClient } from "#/lib/auth-client.ts";
import { signInMethodsQuery } from "#/queries/account.ts";
import { notificationSettingsQuery } from "#/queries/notifications.ts";
import { unlinkGoogleLogin } from "#/server/account.ts";

export const Route = createFileRoute("/$orgSlug/settings/preferences")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			// Only worth fetching when the section that reads it renders — see
			// PreferencesSettingsPage.
			context.devAuth
				? context.queryClient.ensureQueryData(signInMethodsQuery(orgSlug))
				: null,
			context.queryClient.ensureQueryData(notificationSettingsQuery(orgSlug)),
		]);
		return { devAuth: context.devAuth };
	},
	component: PreferencesSettingsPage,
});

// A single sign-in method is just a SettingRow — the same ruled row the
// notification toggles directly below it use. This file used to define its own
// undivided row and stack the two with `gap-5`, so one screen answered "how do
// I separate settings?" two different ways within a scroll of each other.
const SignInMethodRow = SettingRow;

function GoogleSignInMethod() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: methods } = useSuspenseQuery(signInMethodsQuery(orgSlug));
	const [disconnectOpen, setDisconnectOpen] = useState(false);

	const connect = async () => {
		// Links the identity-only "google" provider (email/profile) — the same
		// provider the login-page button uses, distinct from the Google Calendar
		// integration grant. Returns here after Google.
		await authClient.linkSocial({
			provider: "google",
			callbackURL: window.location.href,
		});
	};

	const disconnect = async () => {
		setDisconnectOpen(false);
		try {
			await unlinkGoogleLogin();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not disconnect Google",
			);
			return;
		}
		await queryClient.invalidateQueries({
			queryKey: signInMethodsQuery(orgSlug).queryKey,
		});
		toast.success("Google disconnected");
	};

	if (!methods.google.linked) {
		return (
			<SignInMethodRow
				icon={<GoogleLogoIcon className="size-5 text-muted-foreground" />}
				title="Google"
				description="Connect your Google account to sign in with one click."
				action={<Button onClick={connect}>Connect Google</Button>}
			/>
		);
	}

	// A Google-only account (no password) can't unlink its last way in — the
	// server enforces this too, but disable the control so it never 400s.
	const canDisconnect = methods.hasPassword;

	return (
		<SignInMethodRow
			icon={<GoogleLogoIcon className="size-5 text-muted-foreground" />}
			title="Google"
			description={
				canDisconnect
					? "You can sign in with Google."
					: "You can sign in with Google. Set a password before disconnecting — it's your only way in."
			}
			badge={<Badge variant="secondary">Connected</Badge>}
			action={
				<AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
					<AlertDialogTrigger
						render={
							<Button variant="outline" disabled={!canDisconnect}>
								Disconnect
							</Button>
						}
					/>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Disconnect Google sign-in?</AlertDialogTitle>
							<AlertDialogDescription>
								You'll no longer be able to sign in with Google. Your email and
								password will still work, and you can reconnect any time.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction variant="destructive" onClick={disconnect}>
								Disconnect
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			}
		/>
	);
}

/**
 * Password + Google, and only where either is a real choice — i.e. development,
 * where email/password sign-in is switched on (packages/core/src/lib/dev-auth.ts).
 *
 * On a deployed instance Google is the *only* identity: there is no endpoint
 * that could set the password this section reports on, and disconnecting Google
 * is refused because it would be the account's last way in. Both rows were
 * therefore permanently "Not set" and permanently disabled — a section that
 * asks to be read and then offers nothing to do.
 */
function SignInMethodsSection() {
	const orgSlug = useOrgSlug();
	const { data: methods } = useSuspenseQuery(signInMethodsQuery(orgSlug));

	return (
		<PageSection
			title="Sign-in methods"
			description="How you sign in to Farmer. These apply to your account everywhere, not just this workspace."
		>
			<SettingList>
				<SignInMethodRow
					icon={<KeyIcon className="size-5 text-muted-foreground" />}
					title="Password"
					description={
						methods.hasPassword
							? "Sign in with your email and password."
							: "No password set — you sign in with Google."
					}
					badge={
						<Badge variant="secondary">
							{methods.hasPassword ? "Set" : "Not set"}
						</Badge>
					}
				/>
				<GoogleSignInMethod />
			</SettingList>
		</PageSection>
	);
}

function PreferencesSettingsPage() {
	const { devAuth } = Route.useLoaderData();

	return (
		<Page className="screen">
			<PageHeader
				eyebrow="Your account"
				title="Preferences"
				lede="Your account and this device."
				className="mb-0"
			/>

			{devAuth ? <SignInMethodsSection /> : null}

			<NotificationSettings />
		</Page>
	);
}
