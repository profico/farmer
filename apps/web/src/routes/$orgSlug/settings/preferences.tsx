import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AnimationSpeedSlider } from "#/components/animation-speed-slider.tsx";
import { GoogleIcon } from "#/components/google-sign-in-button.tsx";
import { NotificationSettings } from "#/components/notification-settings.tsx";
import { TransitionPicker } from "#/components/transition-picker.tsx";
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
import { usePreferences } from "#/hooks/use-preferences.ts";
import { authClient } from "#/lib/auth-client.ts";
import { savePreferences } from "#/lib/preferences.ts";
import { signInMethodsQuery } from "#/queries/account.ts";
import { notificationSettingsQuery } from "#/queries/notifications.ts";
import { unlinkGoogleLogin } from "#/server/account.ts";

export const Route = createFileRoute("/$orgSlug/settings/preferences")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(signInMethodsQuery()),
			context.queryClient.ensureQueryData(notificationSettingsQuery()),
		]);
	},
	component: PreferencesSettingsPage,
});

// A single sign-in method (how the user authenticates), rendered as an
// icon + label + status badge + optional action. Kept generic so the password
// and Google rows share one layout.
function SignInMethodRow({
	icon,
	title,
	description,
	badge,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	badge?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex items-center gap-3">
				<span className="flex size-5 items-center justify-center">{icon}</span>
				<div>
					<div className="flex items-center gap-2 text-sm font-semibold">
						{title}
						{badge}
					</div>
					<p className="mt-1 text-xs text-muted-foreground">{description}</p>
				</div>
			</div>
			{action}
		</div>
	);
}

function GoogleSignInMethod() {
	const queryClient = useQueryClient();
	const { data: methods } = useSuspenseQuery(signInMethodsQuery());
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
			queryKey: signInMethodsQuery().queryKey,
		});
		toast.success("Google disconnected");
	};

	if (!methods.google.linked) {
		return (
			<SignInMethodRow
				icon={<GoogleIcon />}
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
			icon={<GoogleIcon />}
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

function PreferencesSettingsPage() {
	const { pageTransition, animationSpeed } = usePreferences();
	const { data: methods } = useSuspenseQuery(signInMethodsQuery());

	return (
		<div className="page-shell">
			<h1 className="font-display text-xl">Preferences</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Your account and this device.
			</p>

			{/* Sign-in methods — account-level auth, applies across every workspace */}
			<div className="-mx-4 mt-8 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="text-sm font-semibold">Sign-in methods</span>
				<p className="mt-1 text-xs text-muted-foreground">
					How you sign in to Farmer. These apply to your account everywhere, not
					just this workspace.
				</p>
				<div className="mt-5 flex flex-col gap-5">
					<SignInMethodRow
						icon={<KeyRound className="size-5 text-muted-foreground" />}
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
				</div>
			</div>

			<NotificationSettings />

			<div className="-mx-4 mt-6 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="text-sm font-semibold">Animation responsiveness</span>
				<p className="mt-1 text-xs text-muted-foreground">
					Stored on this device only. How lively motion feels across the app —
					the tab switches, panel changes, and page transitions all follow this.
				</p>
				<div className="mt-4">
					<AnimationSpeedSlider
						value={animationSpeed}
						onChange={(animationSpeed) => savePreferences({ animationSpeed })}
					/>
				</div>
			</div>

			<div className="-mx-4 mt-6 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
				<span className="text-sm font-semibold">Page transition</span>
				<p className="mt-1 text-xs text-muted-foreground">
					Stored on this device only. Hover a style to preview it — applied when
					navigating between pages.
				</p>
				<div className="mt-3 max-w-xl">
					<TransitionPicker
						value={pageTransition}
						onChange={(pageTransition) => savePreferences({ pageTransition })}
					/>
				</div>
			</div>
		</div>
	);
}
