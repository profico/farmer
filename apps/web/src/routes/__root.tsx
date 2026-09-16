import { IconContext } from "@phosphor-icons/react";
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
import { useEffect } from "react";

import { RouteError } from "../components/route-error";
import { RouteNotFound } from "../components/route-not-found";
import { RoutePending } from "../components/route-pending";
import { Toaster } from "../components/ui/sonner";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { logConsoleGreeting } from "../lib/console-greeting";
import { displayInitScript } from "../lib/display-prefs";
import { paletteInitScript } from "../lib/palette";
import { themeInitScript } from "../lib/theme";

import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const DESCRIPTION = "Farmer — a simple, open-source time tracker.";

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
			{
				name: "theme-color",
				// The logo violet — the flat fill and top gradient stop of
				// Icon.svg / logo.svg. Deliberately not `--acc` (the terracotta
				// UI accent): browser chrome and the PWA title bar are brand
				// surfaces, so they take the mark's colour, not the app's.
				content: "#6f4ebe",
			},
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

/** Light/dark, the Display preferences and the colour choice, applied in one
 *  inline script before paint. */
const headInitScript = themeInitScript + displayInitScript + paletteInitScript;

function RootDocument({ children }: { children: React.ReactNode }) {
	useEffect(logConsoleGreeting, []);

	// `suppressHydrationWarning`: the script below writes `data-theme` (and the
	// Display preferences' `data-font`, `data-motion`, `data-density` and
	// `data-palette`) onto
	// <html> before React ever sees it, and
	// the server has no way to render the same values — that mismatch is the
	// point of the script, not a bug, and React otherwise logs it on every load.
	// It suppresses one level only, which is exactly these attributes.
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Before HeadContent, and therefore before the stylesheet: the
				    reader's choices live in localStorage, so the server can't render
				    them, and applying them on hydrate instead would flash the light
				    palette and the serif on every cold load. See lib/theme.ts,
				    lib/display-prefs.ts and lib/palette.ts. */}
				{/* oxlint-disable-next-line react/no-danger -- three fixed strings built from constants, the standard no-flash theme, display and colour scripts, which have to be inline to run before paint */}
				<script dangerouslySetInnerHTML={{ __html: headInitScript }} />
				<HeadContent />
			</head>
			<body>
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
              see lib/display-prefs.ts. */}
					<MotionConfig reducedMotion="user">{children}</MotionConfig>
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
				<Scripts />
			</body>
		</html>
	);
}
