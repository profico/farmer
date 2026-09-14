import {
	BrowserIcon,
	GoogleLogoIcon,
	KeyIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FilingRulesSettings } from "#/components/filing-rules-settings.tsx";
import { NotificationSettings } from "#/components/notification-settings.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
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
import { mySessionsQuery } from "#/queries/sessions.ts";
import { unlinkGoogleLogin } from "#/server/account.ts";
import { type listMySessions, revokeMySession } from "#/server/sessions.ts";

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
			context.queryClient.ensureQueryData(mySessionsQuery(orgSlug)),
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

type MySession = Awaited<ReturnType<typeof listMySessions>>[number];

/**
 * A timestamp in the reader's own timezone and locale conventions.
 *
 * The server renders this page first, in the server's timezone, and the browser
 * then renders it in the reader's — so the two texts can differ, and the
 * browser's is the right one. `suppressHydrationWarning` says that mismatch is
 * expected, for this one element only.
 */
function When({ date }: { date: Date }) {
	const value = new Date(date);
	return (
		<time dateTime={value.toISOString()} suppressHydrationWarning>
			{value.toLocaleString("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
			})}
		</time>
	);
}

function SessionRow({ session }: { session: MySession }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	const revoke = useMutation({
		mutationFn: () => revokeMySession({ data: session.id }),
		onSuccess: async ({ revoked }) => {
			await queryClient.invalidateQueries({
				queryKey: mySessionsQuery(orgSlug).queryKey,
			});
			// `false` is a session that ended between loading this list and the
			// click — expired, or signed out from the device itself. The list is
			// refreshed either way, so the row goes.
			toast.success(
				revoked
					? `Signed out ${session.label}`
					: "That device was already signed out",
			);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not sign out that device"),
	});

	const Icon = session.kind === "cli" ? TerminalWindowIcon : BrowserIcon;

	return (
		<SettingRow
			icon={<Icon className="size-5 text-muted-foreground" />}
			title={session.label}
			badge={
				session.isCurrent ? (
					<Badge variant="secondary">This device</Badge>
				) : undefined
			}
			description={
				<>
					Signed in <When date={session.createdAt} />
					{session.ipAddress ? ` from ${session.ipAddress}` : ""}. Expires{" "}
					<When date={session.expiresAt} />.
				</>
			}
			action={
				// The current session has no Revoke: ending it is signing out, which
				// has its own control. The service refuses it as well.
				session.isCurrent ? undefined : (
					<AlertDialog open={open} onOpenChange={setOpen}>
						<AlertDialogTrigger
							render={
								<Button variant="outline" disabled={revoke.isPending}>
									{revoke.isPending ? "Signing out…" : "Revoke"}
								</Button>
							}
						/>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Sign out {session.label}?</AlertDialogTitle>
								<AlertDialogDescription>
									{session.kind === "cli"
										? "The terminal is signed out at its next command, and it asks you to run farmer login again."
										: "That browser is signed out the next time it loads a page."}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant="destructive"
									onClick={() => {
										setOpen(false);
										revoke.mutate();
									}}
								>
									Revoke
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				)
			}
		/>
	);
}

/**
 * Every browser and terminal signed in to this account, with a way to end each.
 *
 * It exists for the CLI: `farmer login` stores a session token on a machine,
 * and it stays valid for as long as the session does. A person who loses that
 * laptop needs a way to end it that does not involve the laptop, and this is
 * it. Sessions belong to the account, not the workspace, so the list is the
 * same whichever workspace this page is opened from — which the description
 * says, the same way Sign-in methods does.
 */
function SignedInDevicesSection() {
	const orgSlug = useOrgSlug();
	const { data: sessions } = useSuspenseQuery(mySessionsQuery(orgSlug));

	return (
		<PageSection
			title="Signed-in devices"
			description="Every browser and terminal signed in to your account, in every workspace. Revoke any you don't recognise, or one on a device you no longer have."
		>
			<SettingList>
				{sessions.map((session) => (
					<SessionRow key={session.id} session={session} />
				))}
			</SettingList>
		</PageSection>
	);
}

function PreferencesSettingsPage() {
	const { devAuth } = Route.useLoaderData();

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Preferences"
				lede="Your account and this device."
			/>

			{devAuth ? <SignInMethodsSection /> : null}

			<SignedInDevicesSection />
			<NotificationSettings />
			<FilingRulesSettings />
		</Page>
	);
}
