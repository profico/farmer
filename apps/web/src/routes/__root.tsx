import { setting } from "@farmer/core/lib/instance-settings";
import { IconContext } from "@phosphor-icons/react";
import { PostHogProvider, usePostHog } from "@posthog/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createIsomorphicFn } from "@tanstack/react-start";
import { MotionConfig } from "motion/react";
import { useEffect, useRef } from "react";

import { RouteError } from "../components/route-error";
import { RouteNotFound } from "../components/route-not-found";
import { RoutePending } from "../components/route-pending";
import { Toaster } from "../components/ui/sonner";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { authClient } from "../lib/auth-client";
import { logConsoleGreeting } from "../lib/console-greeting";
import { displayInitScript } from "../lib/display-prefs";
import { unzoomPagePoint } from "../lib/motion";
import { navInitScript } from "../lib/nav-collapse";
import { startPostHog } from "../lib/posthog-client";
import { themeInitScript } from "../lib/theme";
import { startThemeColorSync, themeColorInitScript } from "../lib/theme-color";

import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const DESCRIPTION = "Farmer — a simple, open-source time tracker.";

/**
 * Where the browser's PostHog credentials come from, and why they are not a
 * `VITE_` variable.
 *
 * `import.meta.env.VITE_*` is substituted by `vite build`, and that build runs
 * inside the Docker image — so a `VITE_` value can only ever be what CI was
 * given, never what the deployment is configured with. One image runs several
 * environments here, which is why `ASSISTANT_ENABLED` and `SINGLE_ORG_SLUG` are
 * instance settings read per request (`server/config.ts` says the same thing).
 *
 * So the server reads the instance settings (the environment, else the
 * Infrastructure page) and writes the pair into the inline script
 * below, beside the theme; the browser reads it back off `window`. Not through
 * `getPublicAppConfig`, which is a server FUNCTION: the root route has no
 * loader to call one from, and `RootDocument` is the `shellComponent`, which
 * renders on the error and not-found paths where no loader has run. An inline
 * script is a value the document always carries.
 *
 * The project token is public by design — it ships in the page either way.
 *
 * Development answers null, whatever the variables hold, so the browser never
 * receives the credentials and the provider below is never mounted. The reason
 * is in `lib/posthog-server.ts`, which gates its half on the same `NODE_ENV`.
 */
type PostHogConfig = { token: string; host: string } | null;

declare global {
	interface Window {
		__FARMER_POSTHOG__?: PostHogConfig;
	}
}

const posthogConfig = createIsomorphicFn()
	.server((): PostHogConfig => {
		if (process.env.NODE_ENV !== "production") return null;
		const token = setting("POSTHOG_PROJECT_TOKEN");
		const host = setting("POSTHOG_HOST");
		return token && host ? { token, host } : null;
	})
	.client((): PostHogConfig => window.__FARMER_POSTHOG__ ?? null);

/** The server's answer, as a statement the browser runs before React exists.
 *
 *  `JSON.stringify` of an object with two string fields, so there is nothing
 *  here for a value to break out of; `</script>` inside a JSON string would,
 *  which is what the `<` escape covers.
 *
 *  The browser builds the same string from the value the script left on
 *  `window`, so the `<script>` hydrates with the `__html` the server sent.
 *  An empty string on the client is a hydration mismatch on every load. */
const posthogInitScript = () =>
	`window.__FARMER_POSTHOG__=${JSON.stringify(posthogConfig()).replace(/</g, "\\u003c")};`;

// A link preview only follows an absolute image URL, and the crawlers that
// fetch one never run JavaScript, so the server's answer is the one that
// counts. It is `BETTER_AUTH_URL`, as in `getPublicAppConfig`; the browser
// renders the same tags on hydration and answers with its own origin, which a
// working deployment has made the same value for OAuth's sake.
const appOrigin = createIsomorphicFn()
	.server(() => URL.parse(process.env.BETTER_AUTH_URL ?? "")?.origin ?? "")
	.client(() => window.location.origin);

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				title: "Farmer",
			},
			{
				name: "description",
				content: DESCRIPTION,
			},
			// `public/og.png`: the wordmark on a white gradient, "by Profico" under it.
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Farmer" },
			{ property: "og:title", content: "Farmer" },
			{ property: "og:description", content: DESCRIPTION },
			{ property: "og:image", content: `${appOrigin()}/og.png` },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:alt", content: "Farmer, by Profico" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:image", content: `${appOrigin()}/og.png` },
			// No `theme-color` here: the browser chrome takes the page's ground,
			// which depends on the theme and the palette, so the inline script
			// below writes the meta and `lib/theme-color.ts` keeps it current.
		],
		links: [
			{
				rel: "icon",
				href: "/Icon.svg",
				type: "image/svg+xml",
			},
			{
				rel: "manifest",
				href: "/manifest.json",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	// Explicit even though `router.tsx` sets matching router-wide defaults:
	// these are what actually catch a throw from the root route itself
	// (beforeLoad/loader/component), rendered inside `shellComponent` below —
	// the <html>/<head>/<body> chrome always renders; only the inner content
	// area is replaced.
	errorComponent: RouteError,
	pendingComponent: RoutePending,
	notFoundComponent: RouteNotFound,
	shellComponent: RootDocument,
});

/** Light/dark, every Preferences → Display setting, the chrome's color and
 *  PostHog's credentials, in one inline script before paint.
 *  `displayInitScript` carries the color seed, the three faces and the scale
 *  with the switches — see `lib/display-prefs.ts`. `themeColorInitScript`
 *  reads `data-theme`, so it comes after the theme script.
 *
 *  Built per render rather than once at module scope, because the PostHog half
 *  is read from the environment on the server and a module-scope constant in a
 *  route file is evaluated in the browser too. */
const headInitScript = () =>
	themeInitScript +
	displayInitScript +
	themeColorInitScript +
	navInitScript +
	posthogInitScript();

function RootDocument({ children }: { children: React.ReactNode }) {
	useEffect(logConsoleGreeting, []);
	useEffect(startThemeColorSync, []);

	// `suppressHydrationWarning`: the script below writes `data-theme` (and the
	// Display preferences' `data-font`, `data-motion`, `data-density`,
	// `data-contrast` and `data-palette`, the nav column's `data-nav`, and
	// the inline properties
	// carrying the color seed, the three faces and the scale) onto <html>
	// before React ever sees it, and the server has no way to render the same
	// values — that mismatch is the point of the script, not a bug, and React
	// otherwise logs it on every load. It suppresses one level only, which is
	// exactly these attributes.
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Before HeadContent, and therefore before the stylesheet: the
				    reader's choices live in localStorage, so the server can't render
				    them, and applying them on hydrate instead would flash the light
				    palette and the serif on every cold load. See lib/theme.ts,
				    lib/display-prefs.ts and lib/palette.ts. */}
				{/* oxlint-disable-next-line react/no-danger -- fixed strings built from constants and the server's PostHog settings: the standard no-flash theme, display and color scripts, which have to be inline to run before paint */}
				<script dangerouslySetInnerHTML={{ __html: headInitScript() }} />
				<HeadContent />
			</head>
			<body>
				<PostHogRoot>
					{/* Every icon in the app is Phosphor duotone, set once here rather
            than repeated as a `weight` prop on every call site. Individual
            icons still override it — check / X / plus glyphs and every arrow
            or caret are always weight="regular": duotone turns a line-drawn
            glyph into a muddy blob at the sizes those are used at.
            Size stays unset so Tailwind's `size-*` classes keep control.
            Wraps the Toaster too, whose status icons are Phosphor as well. */}
					<IconContext.Provider value={{ weight: "duotone" }}>
						{/* reducedMotion="user" degrades every spring under
              prefers-reduced-motion: transform/scale/slide are dropped (opacity
              is kept), so dialogs & menus cross-fade, sheets fade, and the
              tab-bar pill jumps instead of gliding — no per-component branching.
              This is the app's only answer to the OS setting. "Less movement"
              in Preferences goes further and makes every animation instant,
              see lib/display-prefs.ts.

              transformPagePoint takes Preferences → Display → Scale back off
              every length motion measures — see the note on the function. */}
						<MotionConfig
							reducedMotion="user"
							transformPagePoint={unzoomPagePoint}
						>
							{children}
						</MotionConfig>
						<Toaster />
					</IconContext.Provider>
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							TanStackQueryDevtools,
						]}
					/>
				</PostHogRoot>
				<Scripts />
			</body>
		</html>
	);
}

function PostHogRoot({ children }: { children: React.ReactNode }) {
	// Resolved per render, not at module scope: on the server it is the
	// environment, and in the browser it is the value the inline script above
	// planted. Both answer the same thing, so the provider is either present on
	// both sides of hydration or absent on both.
	const config = posthogConfig();
	if (!config) return children;

	return (
		<PostHogProvider client={startPostHog(config)}>
			<PostHogIdentity />
			{children}
		</PostHogProvider>
	);
}

function PostHogIdentity() {
	const posthog = usePostHog();
	const { data: session } = authClient.useSession();
	const identifiedUserId = useRef<string | null>(null);

	useEffect(() => {
		const user = session?.user;
		if (!user) {
			identifiedUserId.current = null;
			return;
		}
		if (identifiedUserId.current === user.id) return;

		posthog.identify(user.id, {
			email: user.email,
			name: user.name,
		});
		identifiedUserId.current = user.id;
	}, [posthog, session?.user]);

	// The operator's user id while a platform admin is impersonating somebody,
	// and null the rest of the time (`docs/domains/authentication.md`).
	const impersonatedBy = session?.session.impersonatedBy ?? null;

	// Super properties, deliberately NOT person properties on the identify
	// above.
	//
	// The session belongs to the person being impersonated, so PostHog
	// identifies THEM and every event goes onto their profile — which is right,
	// because that is whose account the clicks are happening in, and wrong for
	// anyone later reading that profile as a record of what its owner did. A
	// person property would be the wrong repair: it persists, so the first
	// impersonation would mark the real user as impersonated for good, and the
	// property would have to be unset from a session that may never come back.
	//
	// A super property is attached to every EVENT the browser sends until it is
	// unregistered, which is exactly the shape of the fact: these events, not
	// this person. Both ends of an impersonation reload the document
	// (`lib/impersonation.ts`), so this effect runs afresh on each, and the
	// `unregister` branch is what takes the tag off — the registration is
	// persisted in the browser, so leaving it out would carry the tag into the
	// operator's own next session on the same machine.
	//
	// The ledger itself is captured on the server, where a browser cannot
	// decline to send it — see `lib/posthog-impersonation.ts`.
	useEffect(() => {
		if (impersonatedBy) {
			posthog.register({ impersonated: true, impersonated_by: impersonatedBy });
			return;
		}
		posthog.unregister("impersonated");
		posthog.unregister("impersonated_by");
	}, [posthog, impersonatedBy]);

	return null;
}
