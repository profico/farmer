import {
	ArrowLeftIcon,
	EnvelopeSimpleIcon,
	GearSixIcon,
	GoogleLogoIcon,
	type Icon,
	KeyIcon,
	LinkSimpleIcon,
	LockSimpleIcon,
	WarningCircleIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { MenuPath } from "#/components/menu-path.tsx";
import { AuthError, AuthHead } from "#/components/site/auth-parts.tsx";
import { signIn, signUp } from "#/lib/auth-client.ts";
import { safeRedirectPath } from "#/lib/org-redirect.ts";
import { getPasswordSignIn, getPublicAppConfig } from "#/server/config.ts";

const searchSchema = z.object({
	redirect: z.string().optional(),
	email: z.string().optional(),
	org: z.string().optional(),
	orgSlug: z.string().optional(),
	role: z.string().optional(),
	// Set by better-auth when the OAuth round-trip fails — see `errorCallbackURL`
	// in routes/api/login.ts. snake_case because that is what OAuth sends.
	error: z.string().optional(),
	error_description: z.string().optional(),
});

type Search = z.infer<typeof searchSchema>;

/** `/api/login` (or `path`), carrying whatever destination and invite
 *  context we arrived with. */
const signInHref = (search: Search, path = "/api/login") => {
	const params = new URLSearchParams();
	for (const key of ["redirect", "email", "org", "orgSlug", "role"] as const) {
		const value = search[key];
		if (value) params.set(key, value);
	}
	const query = params.toString();
	return `${path}${query ? `?${query}` : ""}`;
};

/**
 * Where a successful sign-in lands. Same rule as `/api/login`'s: `redirect`
 * rides in a link and is attacker-supplied in principle, so only a same-site
 * absolute path is accepted (`safeRedirectPath`).
 */
const destination = (search: Search) => {
	const target = safeRedirectPath(search.redirect) ?? "/";
	const context = new URLSearchParams();
	for (const key of ["email", "org", "orgSlug", "role"] as const) {
		const value = search[key];
		if (value) context.set(key, value);
	}
	const query = context.toString();
	return query
		? `${target}${target.includes("?") ? "&" : "?"}${query}`
		: target;
};

/**
 * What a failed round trip says. better-auth sends our own APIError's `code`
 * as `error` and its message as `error_description` (see
 * `packages/core/src/auth/registration.ts`), so the description is the
 * specific sentence when there is one. The titles and the fallbacks are for
 * the codes a person can do something about.
 */
type SignInFailure = { title: string; fallback: string };

const ERRORS = new Map<string, SignInFailure>([
	[
		"REGISTRATION_CLOSED",
		{
			title: "Registration is closed",
			fallback:
				"This instance does not accept new accounts. Ask an administrator to invite you, then sign in with the address the invitation was sent to.",
		},
	],
	[
		"INVITE_ONLY",
		{
			title: "You need an invitation",
			fallback:
				"This workspace is invite-only. Sign in with the account the invitation was sent to, or ask an admin to invite you.",
		},
	],
	// better-auth's own code: the email has an account here, and the account
	// is not connected to this provider. Most often the first account, made
	// with a password before any provider existed.
	[
		"account_not_linked",
		{
			title: "Connect this provider first",
			fallback:
				"This email already has an account here, and the account is not connected to this provider. Sign in the way you did before, then connect the provider under Sign-in methods, in Preferences.",
		},
	],
]);

/** The icon beside each known failure; anything else gets a warning. */
const ERROR_ICONS = new Map<string, Icon>([
	["REGISTRATION_CLOSED", LockSimpleIcon],
	["INVITE_ONLY", EnvelopeSimpleIcon],
	["account_not_linked", LinkSimpleIcon],
]);

const GENERIC_ERROR: SignInFailure = {
	title: "Couldn't sign you in",
	fallback:
		"The provider didn't complete the sign-in. Try again, and if it keeps happening ask an admin to check the sign-in configuration.",
};

/**
 * The sign-in screen — which, when Google is the only way in, is still not a
 * screen.
 *
 * With Google as the one provider, and no password form to offer, this route
 * bounces straight into the Google flow, exactly as it always has. It stays a
 * *page* route rather than becoming a second server route so its call sites
 * need no ceremony: `beforeLoad` runs on the server for a document request and
 * in the browser during SPA navigation, and `reloadDocument` turns both into
 * the full-page hop `/api/login` needs.
 *
 * Everything else renders:
 *
 *  - `?error=…` — better-auth's `errorCallbackURL`, most usefully the
 *    registration and invite-only gates. Redirecting here would bounce a
 *    refused visitor between this route and the provider forever.
 *  - more than one provider (Google and the OpenID Connect sources from
 *    Infrastructure → Sign-in), or one that is not Google: a button each.
 *  - no provider at all: "sign-in is not configured yet", and the password
 *    form for the first account or the administrator (`getPasswordSignIn`).
 *  - development (`config.devAuth`): the development password form.
 *
 * Resolving the config costs nothing on the redirect path that matters: a
 * document request runs these server functions in-process during SSR, not
 * over HTTP.
 */
export const Route = createFileRoute("/login")({
	validateSearch: searchSchema,
	beforeLoad: async ({ search }) => {
		const [config, passwordSignIn] = await Promise.all([
			getPublicAppConfig(),
			getPasswordSignIn(),
		]);
		const googleOnly =
			config.googleSignIn &&
			config.signInProviders.length === 1 &&
			!config.devAuth &&
			passwordSignIn === null;
		if (!search.error && googleOnly) {
			throw redirect({ href: signInHref(search), reloadDocument: true });
		}
		// Handed to the loader rather than fetched twice.
		return { appConfig: config, passwordSignIn };
	},
	loader: ({ context }) => ({
		config: context.appConfig,
		passwordSignIn: context.passwordSignIn,
	}),
	component: SignInPage,
});

function SignInPage() {
	const { config, passwordSignIn } = Route.useLoaderData();
	const search = Route.useSearch();

	// `error` is a code this app defined and better-auth echoed back; `error_
	// description` is attacker-controlled query-string text once it crosses the
	// redirect. A code this app KNOWS gets this app's own sentence, never the
	// query string's — otherwise `?error=REGISTRATION_CLOSED&error_description=…`
	// renders whatever text rides along. Only a code this app does not
	// recognize falls back to showing what the provider said.
	const knownFailure = search.error ? ERRORS.get(search.error) : undefined;
	const failure = search.error ? (knownFailure ?? GENERIC_ERROR) : null;
	const oauthError = failure
		? knownFailure
			? failure.fallback
			: (search.error_description ?? failure.fallback)
		: null;
	const providers = config.signInProviders;
	const notConfigured = providers.length === 0 && !config.devAuth;
	const org = config.singleOrgMode ? config.org : null;

	// The password form sits behind a link when there are buttons: the
	// administrator is one person, and everybody else reads the page too.
	const [passwordOpen, setPasswordOpen] = useState(providers.length === 0);

	const providerButtons =
		providers.length > 0 ? (
			<div className="fm-auth-actions">
				{providers.map((provider, index) => (
					<ProviderButton
						key={provider.id}
						provider={provider}
						search={search}
						retry={oauthError !== null}
						primary={index === 0}
					/>
				))}
			</div>
		) : null;

	if (failure) {
		// The same page without the error: every button, and the password or
		// development form. Only worth a link when there is more than the one
		// button already on screen.
		const otherOptions =
			providers.length > 1 || config.devAuth || passwordSignIn !== null;
		return (
			<AuthSplitPanel brand={config.org}>
				<AuthHead
					icon={
						(knownFailure && search.error
							? ERROR_ICONS.get(search.error)
							: undefined) ?? WarningCircleIcon
					}
					tone="warn"
					title={failure.title}
				>
					{oauthError}
				</AuthHead>
				{providerButtons}
				{otherOptions ? (
					<a
						href={signInHref(search, "/login")}
						className="fm-auth-link fm-auth-back"
						data-tone="muted"
					>
						Use another sign-in option
					</a>
				) : null}
			</AuthSplitPanel>
		);
	}

	if (passwordSignIn && !config.devAuth && passwordOpen) {
		const back =
			providers.length > 0 ? (
				<button
					type="button"
					className="fm-auth-link fm-auth-back"
					data-tone="muted"
					onClick={() => setPasswordOpen(false)}
				>
					<ArrowLeftIcon size={14} aria-hidden />
					All sign-in options
				</button>
			) : null;
		return (
			<AuthSplitPanel brand={config.org}>
				{passwordSignIn === "first-account" ? (
					<AuthHead
						back={back}
						title={
							<>
								Set up <em>Farmer</em>
							</>
						}
					>
						No account exists yet. This first account administers the instance.
						Sign-in providers and invitations come after.
					</AuthHead>
				) : notConfigured ? (
					<AuthHead icon={GearSixIcon} title="Sign-in is not configured yet">
						This instance has no sign-in provider. The administrator signs in
						with a password and adds Google or an OpenID Connect provider under
						<MenuPath steps={["Settings", "Infrastructure"]} />.
					</AuthHead>
				) : (
					<AuthHead back={back} title="Administrator sign-in">
						For the instance administrator. Everyone else signs in with a
						provider.
					</AuthHead>
				)}
				<PasswordForm
					search={search}
					kind={passwordSignIn}
					submitLabel={
						passwordSignIn === "first-account"
							? "Create administrator account"
							: notConfigured
								? "Sign in as administrator"
								: "Sign in"
					}
				/>
				{passwordSignIn === "administrator" && notConfigured ? (
					<p className="fm-auth-fine">
						Not the administrator? Ask them to finish setup, then come back.
					</p>
				) : null}
			</AuthSplitPanel>
		);
	}

	if (notConfigured && !passwordSignIn) {
		return (
			<AuthSplitPanel brand={config.org}>
				<AuthHead icon={GearSixIcon} title="Sign-in is not configured yet">
					This instance has no sign-in provider. Ask the person who runs this
					instance to add one.
				</AuthHead>
			</AuthSplitPanel>
		);
	}

	return (
		<AuthSplitPanel brand={config.org}>
			{passwordSignIn === "first-account" ? (
				<AuthHead
					title={
						<>
							Set up <em>Farmer</em>
						</>
					}
				>
					Create the first account. It administers this instance: it adds the
					sign-in providers, email and storage.
				</AuthHead>
			) : (
				<AuthHead title="Welcome back">
					{org
						? `Sign in to ${org.name}'s timesheet.`
						: "Sign in with the account you work from."}
				</AuthHead>
			)}

			{providerButtons}

			{providers.length > 0 ? (
				<p className="fm-auth-note">
					{org
						? `Access to ${org.name} is by invitation.`
						: "Your first sign-in creates your account when you have an invitation."}
				</p>
			) : null}

			{config.devAuth ? (
				<DevelopmentForm search={search} />
			) : passwordSignIn ? (
				<button
					type="button"
					className="fm-auth-link fm-auth-divided"
					data-tone="faint"
					onClick={() => setPasswordOpen(true)}
				>
					{passwordSignIn === "first-account"
						? "Create the first account with a password"
						: "Administrator: sign in with your password"}
				</button>
			) : null}
		</AuthSplitPanel>
	);
}

/**
 * One sign-in button. Google is a plain anchor to `/api/login`, a server
 * route, so it has to be a document request rather than a client navigation.
 * An OpenID Connect source goes through the client's `signIn.oauth2`, which
 * asks better-auth for the authorize URL and sends the browser there.
 */
function ProviderButton({
	provider,
	search,
	retry,
	primary,
}: {
	provider: { id: string; name: string };
	search: Search;
	retry: boolean;
	primary: boolean;
}) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const label = `${retry ? "Try again with" : "Continue with"} ${provider.name}`;
	const className = primary
		? "fm-btn fm-btn-block"
		: "fm-btn fm-btn-outline fm-btn-block";

	if (provider.id === "google") {
		return (
			<a className={className} href={signInHref(search)}>
				<GoogleLogoIcon size={18} aria-hidden />
				{label}
			</a>
		);
	}

	const start = async () => {
		setPending(true);
		setError(null);
		const { error: authError } = await signIn.oauth2({
			providerId: provider.id,
			callbackURL: destination(search),
			// The same landing as Google's: errors on the far side come back as
			// /login?error=…, the one case this page renders for a provider.
			errorCallbackURL: "/login",
		});
		// On success the client is already leaving for the provider, so
		// `pending` stays true through the unload.
		if (authError) {
			setPending(false);
			setError(authError.message ?? `${provider.name} is not available.`);
		}
	};

	return (
		<>
			<button
				type="button"
				className={className}
				disabled={pending}
				onClick={start}
			>
				<KeyIcon size={18} weight="duotone" aria-hidden />
				{label}
			</button>
			{error ? <AuthError>{error}</AuthError> : null}
		</>
	);
}

type Credentials = { name: string; email: string; password: string };

/**
 * Email + password, in three cases:
 *
 * - `development`: `getPublicAppConfig` reports `devAuth` (the server runs
 *   under NODE_ENV=development — see packages/core/src/lib/dev-auth.ts). Sign
 *   in or create an account. The box says "Development only", because this
 *   form in a deployed environment is a bug and should be recognisable as one.
 * - `first-account`: a deployed instance with no user. Create only.
 * - `administrator`: a platform admin who has no provider connected yet.
 *   Sign in only.
 *
 * The server decides, not this form: the gates are in
 * `packages/core/src/auth/index.ts` (`emailAndPassword`) and a form typed
 * into by hand gets the same refusal.
 *
 * Deliberately plain `useState` rather than the RHF + Zod resolver every real
 * form in this app uses. There is no shared input schema to reuse here — the
 * two fields are better-auth's, not ours — so the resolver would buy a second
 * copy of "required, and an email" and nothing else.
 */
function usePasswordSubmit(search: Search) {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async (
		mode: "sign-in" | "sign-up",
		{ name, email, password }: Credentials,
	) => {
		setError(null);
		setPending(true);
		// The first account lands on `/`, which finds the workspace its signup
		// made; there is no invite context to carry.
		const callbackURL = destination(search);
		const { error: authError } =
			mode === "sign-up"
				? await signUp.email({
						name: name.trim() || email.split("@")[0] || "Developer",
						email,
						password,
					})
				: await signIn.email({ email, password });
		if (authError) {
			setPending(false);
			setError(authError.message ?? "Sign-in failed.");
			return;
		}
		// A document request rather than a router navigation. The session lands in
		// a cookie, and every guard that decides where this person may go
		// (`$orgSlug`'s beforeLoad, `/`'s loader) reads it server-side — a client
		// navigation would run them against the router's pre-sign-in state. It also
		// matches what the provider legs do, so every path arrives the same way.
		// `pending` is deliberately left true: the button stays disabled through the
		// unload rather than flashing back to its idle state.
		window.location.href = callbackURL;
	};

	return { submit, error, setError, pending };
}

/** The first account, or the administrator's password sign-in. */
function PasswordForm({
	search,
	kind,
	submitLabel,
}: {
	search: Search;
	kind: "first-account" | "administrator";
	submitLabel: string;
}) {
	const mode = kind === "first-account" ? "sign-up" : "sign-in";
	const [name, setName] = useState("");
	const [email, setEmail] = useState(search.email ?? "");
	const [password, setPassword] = useState("");
	const { submit, error, pending } = usePasswordSubmit(search);

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		void submit(mode, { name, email, password });
	};

	return (
		<form className="fm-auth-form" onSubmit={onSubmit}>
			{mode === "sign-up" ? (
				<label className="fm-field">
					Name
					<input
						className="fm-input"
						autoComplete="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Ada Lovelace"
					/>
				</label>
			) : null}
			<label className="fm-field">
				Email
				<input
					className="fm-input"
					type="email"
					required
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@company.com"
				/>
			</label>
			<label className="fm-field">
				Password
				<input
					className="fm-input"
					type="password"
					required
					minLength={8}
					autoComplete={
						mode === "sign-up" ? "new-password" : "current-password"
					}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder={
						mode === "sign-up" ? "At least 8 characters" : "Your password"
					}
				/>
			</label>
			{error ? <AuthError>{error}</AuthError> : null}
			<button type="submit" className="fm-btn fm-btn-block" disabled={pending}>
				{pending
					? mode === "sign-up"
						? "Creating account…"
						: "Signing in…"
					: submitLabel}
			</button>
		</form>
	);
}

/** The development form: compact, dashed, and labelled with the reason it
 *  exists, below the provider buttons. */
function DevelopmentForm({ search }: { search: Search }) {
	const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState(search.email ?? "");
	const [password, setPassword] = useState("");
	const { submit, error, setError, pending } = usePasswordSubmit(search);

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		void submit(mode, { name, email, password });
	};

	return (
		<form className="fm-auth-dev" onSubmit={onSubmit}>
			<div className="fm-auth-dev-head">
				<WrenchIcon size={14} weight="duotone" aria-hidden />
				Development only
				<span className="fm-auth-dev-env">NODE_ENV=development</span>
			</div>
			<div className="fm-auth-dev-fields">
				{mode === "sign-up" ? (
					<input
						className="fm-input"
						aria-label="Name"
						autoComplete="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Name"
					/>
				) : null}
				<input
					className="fm-input"
					aria-label="Email"
					type="email"
					required
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email"
				/>
				<input
					className="fm-input"
					aria-label="Password"
					type="password"
					required
					minLength={8}
					autoComplete={
						mode === "sign-up" ? "new-password" : "current-password"
					}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
				/>
				<button
					type="submit"
					className="fm-btn fm-btn-outline"
					disabled={pending}
				>
					{mode === "sign-up"
						? pending
							? "Creating…"
							: "Create account"
						: pending
							? "Signing in…"
							: "Sign in"}
				</button>
			</div>
			{error ? <AuthError>{error}</AuthError> : null}
			<button
				type="button"
				className="fm-auth-link"
				data-tone="muted"
				onClick={() => {
					setMode(mode === "sign-in" ? "sign-up" : "sign-in");
					setError(null);
				}}
			>
				{mode === "sign-in"
					? "Create a test account"
					: "Sign in to a test account"}
			</button>
		</form>
	);
}
