import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { Button } from "#/components/ui/button.tsx";
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
 * There is no login screen. Google is the only identity (see
 * packages/core/src/auth), so this route's whole job is to bounce into the
 * Google flow — every `redirect({ to: "/login" })` in the app, every sign-out,
 * every invite link still points here and keeps working.
 *
 * It stays a page route rather than becoming a second server route so those
 * call sites need no ceremony: `beforeLoad` runs on the server for a document
 * request and in the browser during SPA navigation, and `reloadDocument` turns
 * both into the full-page hop `/api/login` needs.
 *
 * The one time it renders is the OAuth error above — most often the invite-only
 * gate. That case must not redirect, or an uninvited visitor would bounce
 * between here and Google forever.
 */
export const Route = createFileRoute("/login")({
	validateSearch: searchSchema,
	beforeLoad: ({ search }) => {
		if (search.error) return;
		throw redirect({ href: signInHref(search), reloadDocument: true });
	},
	loader: () => getPublicAppConfig(),
	component: SignInErrorPage,
});

function SignInErrorPage() {
	const config = Route.useLoaderData();
	const search = Route.useSearch();

	// better-auth forwards our own APIError message as `error_description`, which
	// is the specific, useful sentence (e.g. which account to use on an
	// invite-only instance). The bare code is the fallback for everything else.
	const message =
		search.error_description ??
		"Google didn't complete the sign-in. Try again, and if it keeps happening ask an admin to check the workspace's Google configuration.";

	return (
		<AuthSplitPanel
			tagline="Every hour, accounted for — without the friction."
			brand={config.org}
		>
			<div className="eyebrow-lg">Sign in</div>
			<h1 className="h2 mt-3">Couldn't sign you in</h1>
			<p className="lede mt-2">{message}</p>
			<Button
				className="mt-6 w-full"
				nativeButton={false}
				render={
					// A plain anchor, not a <Link>: `/api/login` is a server route, so
					// this has to be a document request rather than a client navigation.
					<a href={signInHref(search)}>Try again with Google</a>
				}
			/>
			<p className="mt-6 text-sm text-muted-foreground">
				{config.singleOrgMode && config.org
					? `Access to ${config.org.name} is by invitation.`
					: "Signing in with Google creates your account the first time."}
			</p>
		</AuthSplitPanel>
	);
}
