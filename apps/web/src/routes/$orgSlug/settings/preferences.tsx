import {
	BrowserIcon,
	GoogleLogoIcon,
	IdentificationCardIcon,
	KeyIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { ApiTokensSection } from "#/components/api-tokens-settings.tsx";
import { ColorWheel } from "#/components/color-wheel.tsx";
import { FilingRulesSettings } from "#/components/filing-rules-settings.tsx";
import { NotificationSettings } from "#/components/notification-settings.tsx";
import { YourTasksSection } from "#/components/pickers/your-tasks.tsx";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { When } from "#/components/when.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { authClient } from "#/lib/auth-client.ts";
import { type DisplayPref, useDisplayPref } from "#/lib/display-prefs.ts";
import { FACES, type FaceRole, useFace } from "#/lib/fonts.ts";
import { supportsCustomPalette, usePalette } from "#/lib/palette.ts";
import { SCALES, useScale } from "#/lib/scale.ts";
import { signInMethodsQuery } from "#/queries/account.ts";
import { myApiTokensQuery } from "#/queries/api-tokens.ts";
import { notificationSettingsQuery } from "#/queries/notifications.ts";
import { mySessionsQuery } from "#/queries/sessions.ts";
import { hiddenTasksQuery, selectableTasksQuery } from "#/queries/tasks.ts";
import { unlinkGoogleLogin } from "#/server/account.ts";
import { type listMySessions, revokeMySession } from "#/server/sessions.ts";

export const Route = createFileRoute("/$orgSlug/settings/preferences")({
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			// Always: whether the section renders depends on it (see
			// PreferencesSettingsPage).
			context.queryClient.ensureQueryData(signInMethodsQuery(orgSlug)),
			context.queryClient.ensureQueryData(notificationSettingsQuery(orgSlug)),
			context.queryClient.ensureQueryData(mySessionsQuery(orgSlug)),
			// Only where the section renders: the tokens call the API, and the
			// API is off with the CLI (see ApiTokensSection).
			context.cliEnabled
				? context.queryClient.ensureQueryData(myApiTokensQuery(orgSlug))
				: null,
			// Your tasks, so its chips are there on first paint instead of
			// pushing every section below them down when they arrive.
			context.queryClient.ensureQueryData(selectableTasksQuery(orgSlug)),
			context.queryClient.ensureQueryData(hiddenTasksQuery(orgSlug)),
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
							<Button
								variant="outline"
								className="hover:text-destructive"
								disabled={!canDisconnect}
							>
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
				{methods.google.configured || methods.google.linked ? (
					<GoogleSignInMethod />
				) : null}
				{methods.providers.map((provider) => (
					<ProviderSignInMethod key={provider.id} provider={provider} />
				))}
			</SettingList>
		</PageSection>
	);
}

/**
 * An OpenID Connect source from Infrastructure → Sign-in. Connect only: there
 * is no guarded unlink for these yet, unlike Google's.
 */
function ProviderSignInMethod({
	provider,
}: {
	provider: { id: string; name: string; linked: boolean };
}) {
	const connect = async () => {
		const { error } = await authClient.oauth2.link({
			providerId: provider.id,
			callbackURL: window.location.href,
		});
		if (error)
			toast.error(error.message ?? `Could not connect ${provider.name}`);
	};

	return (
		<SignInMethodRow
			icon={<IdentificationCardIcon className="size-5 text-muted-foreground" />}
			title={provider.name}
			description={
				provider.linked
					? `You can sign in with ${provider.name}.`
					: `Connect your ${provider.name} account to sign in with it.`
			}
			badge={
				provider.linked ? (
					<Badge variant="secondary">Connected</Badge>
				) : undefined
			}
			action={
				provider.linked ? undefined : (
					<Button onClick={connect}>Connect {provider.name}</Button>
				)
			}
		/>
	);
}

type MySession = Awaited<ReturnType<typeof listMySessions>>[number];

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
								<Button
									variant="outline"
									className="hover:text-destructive"
									disabled={revoke.isPending}
								>
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

function DisplayPrefRow({
	pref,
	title,
	description,
}: {
	pref: DisplayPref;
	title: string;
	description: string;
}) {
	const [on, setOn] = useDisplayPref(pref);
	return (
		<SettingRow
			title={title}
			description={description}
			action={
				<Switch aria-label={title} checked={on} onCheckedChange={setOn} />
			}
		/>
	);
}

/**
 * How the app looks on this device. Every setting below is per device rather
 * than per account, like the light/dark switch, because each has to apply
 * before the first paint and only localStorage is there that early — see
 * `lib/display-prefs.ts`.
 */

/** The shell a valued Display setting sits in: the same divider and rhythm
 *  `SettingRow` draws, for a control too tall to sit beside its label. */
function SettingBlock({
	title,
	description,
	labelId,
	children,
}: {
	title: string;
	description: string;
	labelId: string;
	children: React.ReactNode;
}) {
	return (
		<div className="border-t border-line2 py-4 first:border-t-0 first:pt-0 last:pb-0">
			<div id={labelId} className="text-base font-medium">
				{title}
			</div>
			<p className="mt-1 max-w-[68ch] text-sm leading-normal text-muted-foreground">
				{description}
			</p>
			<div className="mt-3">{children}</div>
		</div>
	);
}

/** A row of radios that read as one segmented control. Native radios rather
 *  than buttons: arrow keys move between them and the group is announced as
 *  one choice, for free. */
function RadioChips<T extends string>({
	name,
	value,
	options,
	onChange,
}: {
	name: string;
	value: T;
	options: readonly { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{options.map((option) => (
				<label
					key={option.value}
					className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground has-checked:bg-secondary has-checked:font-medium has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/40"
				>
					<input
						type="radio"
						name={name}
						value={option.value}
						checked={value === option.value}
						onChange={() => onChange(option.value)}
						className="sr-only"
					/>
					{option.label}
				</label>
			))}
		</div>
	);
}

/** `oklch()` and `mod()` are the whole of the custom palette, so a browser
 *  without them is offered Vanilla and told why, rather than a choice that
 *  silently does nothing. Server-renders as supported, because the markup a
 *  browser that CAN do it should get is the normal one. */
const subscribeNothing = () => () => {};

/**
 * Which color the app is drawn from. Vanilla is the palette the app has
 * always had; Custom derives every neutral, the accent and the status colors
 * from one seed — see `lib/palette.ts` and the custom palette in `styles.css`.
 */
function ColorsRow() {
	const { mode, seed, setVanilla, setCustom } = usePalette();
	const supported = useSyncExternalStore(
		subscribeNothing,
		supportsCustomPalette,
		() => true,
	);

	return (
		<SettingBlock
			labelId="colors-label"
			title="Colors"
			description="Vanilla is the palette Farmer ships with. Custom draws the whole app from one color you pick: round the wheel is the color, and out from the middle is how much of it. The ring is a set to start from."
		>
			{supported ? (
				<div
					role="radiogroup"
					aria-labelledby="colors-label"
					className="space-y-4"
				>
					<RadioChips
						name="palette"
						value={mode}
						options={[
							{ value: "vanilla", label: "Vanilla" },
							{ value: "custom", label: "Custom" },
						]}
						onChange={(next) =>
							next === "vanilla" ? setVanilla() : setCustom(seed)
						}
					/>
					{mode === "custom" ? (
						<ColorWheel seed={seed} onChange={setCustom} />
					) : null}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					This browser cannot draw a custom palette. Farmer stays on Vanilla
					here.
				</p>
			)}
		</SettingBlock>
	);
}

/** One face selector. The prop is `face` and not `role`, because `role` on a
 *  JSX element is the ARIA attribute as far as the linter is concerned. */
function FaceSelect({ face, label }: { face: FaceRole; label: string }) {
	const role = face;
	const [id, setId] = useFace(role);
	// A face not on the page yet is fetched before it is applied (see
	// `setFace`), so for that moment the pick is in the trigger and nowhere
	// else. Say so, or the pick reads as ignored. The counter lets only the
	// latest pick clear it.
	const [loading, setLoading] = useState(false);
	const latestPick = useRef(0);
	const pick = (next: string) => {
		const n = ++latestPick.current;
		setLoading(true);
		void setId(next).finally(() => {
			if (latestPick.current === n) setLoading(false);
		});
	};
	const items = FACES[role].map((face) => ({
		value: face.id,
		label: face.label,
	}));
	return (
		<label className="flex flex-col gap-1.5">
			<span className="flex items-baseline gap-2 text-sm text-muted-foreground">
				{label}
				{/* Always mounted: a live region announces a change to its text,
				    not its own arrival. */}
				<span className="text-xs text-faint" aria-live="polite">
					{loading ? "Loading…" : null}
				</span>
			</span>
			<Select
				value={id}
				// Base UI's `onValueChange` is nullable because a Select may be
				// clearable. This one is not — every role always has a face.
				onValueChange={(value) => pick(value ?? id)}
				items={items}
			>
				<SelectTrigger className="w-full bg-card sm:w-56">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{items.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</label>
	);
}

/**
 * The three faces. Display disappears while "Boring font" is on, because that
 * switch IS the answer to which display face to use — it points the display
 * face at the body face — and offering a choice that the switch below
 * overrules would be two controls for one thing.
 */
function FontRow() {
	const [boring] = useDisplayPref("boringFont");
	return (
		<SettingBlock
			labelId="font-label"
			title="Font"
			description="A face for text, one for page titles and large numbers, and one for durations and code. A face that is not already here is fetched the first time you pick it."
		>
			<div className="flex flex-wrap gap-4">
				<FaceSelect face="body" label="Text" />
				{boring ? null : <FaceSelect face="display" label="Titles" />}
				<FaceSelect face="mono" label="Durations" />
			</div>
		</SettingBlock>
	);
}

/**
 * How large the app is drawn. It is the browser's own zoom, so it moves the
 * layout as well as the type — see `lib/scale.ts`.
 */
function ScaleRow() {
	const [scale, setScale] = useScale();
	return (
		<SettingBlock
			labelId="scale-label"
			title="Scale"
			description="Draw everything larger or smaller, the way the browser's own zoom does. At a large scale a narrow window switches to the phone layout, which is the same thing zooming does."
		>
			<div role="radiogroup" aria-labelledby="scale-label">
				<RadioChips
					name="scale"
					value={String(scale)}
					options={SCALES.map((step) => ({
						value: String(step),
						label: `${step}%`,
					}))}
					onChange={(next) => setScale(Number(next))}
				/>
			</div>
		</SettingBlock>
	);
}

function DisplaySection() {
	return (
		<PageSection
			title="Display"
			description="How Farmer looks on this device. Other devices keep their own setting."
		>
			<SettingList>
				<ColorsRow />
				<FontRow />
				<ScaleRow />
				<DisplayPrefRow
					pref="highContrast"
					title="High contrast"
					description="Draw text, lines and focus rings harder. Captions, placeholders and the rules between table rows stop being quiet."
				/>
				<DisplayPrefRow
					pref="boringFont"
					title="Boring font"
					description="Set page titles and large numbers in the text face, rather than in their own."
				/>
				<DisplayPrefRow
					pref="lessMotion"
					title="Less movement"
					description="Turn off animations. Menus, dialogs and lists appear at once."
				/>
				<DisplayPrefRow
					pref="compactTables"
					title="Compact tables"
					description="Put less space in table rows, so more rows fit on the screen."
				/>
			</SettingList>
		</PageSection>
	);
}

function PreferencesSettingsPage() {
	const { devAuth } = Route.useLoaderData();
	const { cliEnabled } = Route.useRouteContext();
	const orgSlug = useOrgSlug();
	const { data: methods } = useSuspenseQuery(signInMethodsQuery(orgSlug));
	// In development, and for an account that holds a password. Outside
	// development that is the first account, made with a password on an
	// instance that had no sign-in provider; this section is where it connects
	// one, which also closes its password (see
	// packages/core/src/auth/sign-in-methods.ts). better-auth will not connect
	// it on a sign-in by email alone, because the address was never verified.
	const showSignInMethods = devAuth || methods.hasPassword;

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Preferences"
				lede="Your account and this device."
			/>

			<DisplaySection />
			<YourTasksSection />

			{showSignInMethods ? <SignInMethodsSection /> : null}

			<SignedInDevicesSection />
			{cliEnabled ? <ApiTokensSection /> : null}
			<NotificationSettings />
			<FilingRulesSettings />
		</Page>
	);
}
