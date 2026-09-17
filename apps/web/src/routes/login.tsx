import { createFileRoute, redirect } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { signIn, signUp } from "#/lib/auth-client.ts";
import { getPublicAppConfig } from "#/server/config.ts";

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

/** `/api/login`, carrying whatever destination and invite context we arrived with. */
const signInHref = (search: Search) => {
	const params = new URLSearchParams();

	for (const key of ["redirect", "email", "org", "orgSlug", "role"] as const) {
		const value = search[key];

		if (value) params.set(key, value);
	}

	const query = params.toString();

	return `/api/login${query ? `?${query}` : ""}`;
};

/**
 * Where a successful sign-in lands. Same rule as `/api/login`'s: `redirect`
 * rides in a link and is attacker-supplied in principle, so only a same-site
 * absolute path is accepted — "//evil.com" is a protocol-relative URL, not a
 * path, which is why the second test is not redundant.
 */
const destination = (search: Search) => {
	const requested = search.redirect;

	const target =
		requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";

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
 * The sign-in screen — which, in production, is still not a screen.
 *
 * Google is the only identity a deployed instance accepts, so there is nothing
 * to choose and this route bounces straight into the Google flow, exactly as it
 * always has. It stays a *page* route rather than becoming a second server route
 * so its call sites need no ceremony: `beforeLoad` runs on the server for a
 * document request and in the browser during SPA navigation, and
 * `reloadDocument` turns both into the full-page hop `/api/login` needs.
 *
 * Two cases render instead of redirecting, and both would otherwise be a loop
 * or a dead end:
 *
 *  - `?error=…` — better-auth's `errorCallbackURL`, most usefully the
 *    single-org invite-only gate. Redirecting here would bounce an uninvited
 *    visitor between this route and Google forever.
 *  - development (`config.devAuth`, i.e. the server is not running under
 *    NODE_ENV=production) — where there is a second way in to offer, and where
 *    bouncing to Google is a dead end on a checkout with no OAuth credentials
 *    configured.
 *
 * Resolving the config costs nothing on the redirect path that matters: a
 * document request runs this server function in-process during SSR, not over
 * HTTP.
 */
export const Route = createFileRoute("/login")({
	validateSearch: searchSchema,
	beforeLoad: async ({ search }) => {
		const config = await getPublicAppConfig();

		if (!search.error && !config.devAuth) {
			throw redirect({ href: signInHref(search), reloadDocument: true });
		}

		// Handed to the loader rather than fetched twice.
		return { appConfig: config };
	},
	loader: ({ context }) => context.appConfig,
	component: SignInPage,
});

function SignInPage() {
	const config = Route.useLoaderData();
	const search = Route.useSearch();

	// better-auth forwards our own APIError message as `error_description`, which
	// is the specific, useful sentence (e.g. which account to use on an
	// invite-only instance). The bare code is the fallback for everything else.
	const oauthError = search.error
		? (search.error_description ??
			"Google didn't complete the sign-in. Try again, and if it keeps happening ask an admin to check the workspace's Google configuration.")
		: null;

	return (
		<AuthSplitPanel
			tagline="Every hour, accounted for — without the friction."
			brand={config.org}
		>
			<h1 className="h2">
				{oauthError ? "Couldn't sign you in" : "Welcome back"}
			</h1>
			<p className="lede mt-2">
				{oauthError ?? "Continue with the Google account you work from."}
			</p>

			<Button
				className="mt-6 w-full"
				nativeButton={false}
				render={
					// A plain anchor, not a <Link>: `/api/login` is a server route, so
					// this has to be a document request rather than a client navigation.
					<a href={signInHref(search)}>
						{oauthError ? "Try again with Google" : "Continue with Google"}
					</a>
				}
			/>

			{config.devAuth ? <DevCredentialsForm search={search} /> : null}

			<p className="mt-6 text-sm text-muted-foreground">
				{config.singleOrgMode && config.org
					? `Access to ${config.org.name} is by invitation.`
					: "Signing in with Google creates your account the first time."}
			</p>
		</AuthSplitPanel>
	);
}

/**
 * Development-only email + password, rendered when `getPublicAppConfig` reports
 * `devAuth` (i.e. the server is not running under NODE_ENV=production — see
 * packages/core/src/lib/dev-auth.ts).
 *
 * Deliberately plain `useState` rather than the RHF + Zod resolver every real
 * form in this app uses. There is no shared input schema to reuse here — the
 * two fields are better-auth's, not ours — and this form ships to nobody, so
 * the resolver would buy a second copy of "required, and an email" and nothing
 * else.
 *
 * It labels itself as development-only on screen. That is not decoration: this
 * is the one control in the product whose presence in a deployed environment is
 * a bug, so it should be recognisable as one at a glance.
 */
function DevCredentialsForm({ search }: { search: Search }) {
	const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState(search.email ?? "");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		setPending(true);
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
		// matches what the Google leg does, so both paths arrive the same way.
		// `pending` is deliberately left true: the button stays disabled through the
		// unload rather than flashing back to its idle state.
		window.location.href = callbackURL;
	};

	return (
		<>
			<div className="mt-6 flex items-center gap-3">
				<div className="h-px flex-1 bg-border" />
				<span className="text-xs uppercase tracking-wide text-faint">
					development only
				</span>
				<div className="h-px flex-1 bg-border" />
			</div>

			<form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
				{mode === "sign-up" ? (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="dev-name">Name</Label>
						<Input
							id="dev-name"
							autoComplete="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Ada Lovelace"
						/>
					</div>
				) : null}

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="dev-email">Email</Label>
					<Input
						id="dev-email"
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="you@example.com"
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="dev-password">Password</Label>
					<Input
						id="dev-password"
						type="password"
						required
						minLength={8}
						autoComplete={
							mode === "sign-up" ? "new-password" : "current-password"
						}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="At least 8 characters"
					/>
				</div>

				{error ? (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				) : null}

				<Button type="submit" variant="outline" disabled={pending}>
					{mode === "sign-up"
						? pending
							? "Creating account…"
							: "Create account"
						: pending
							? "Signing in…"
							: "Sign in with password"}
				</Button>
			</form>

			<button
				type="button"
				className="mt-3 self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
				onClick={() => {
					setMode(mode === "sign-in" ? "sign-up" : "sign-in");
					setError(null);
				}}
			>
				{mode === "sign-in"
					? "No account yet? Create one"
					: "Already have an account? Sign in"}
			</button>
		</>
	);
}
