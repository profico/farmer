import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { MotionConfig } from "motion/react";
import { PreferencesSync } from "../components/preferences-sync";
import { RouteError } from "../components/route-error";
import { RouteNotFound } from "../components/route-not-found";
import { RoutePending } from "../components/route-pending";
import { Toaster } from "../components/ui/sonner";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

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
				content: "Farmer — a simple, open-source time tracker.",
			},
			{
				name: "theme-color",
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

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<PreferencesSync />
				{/* reducedMotion="user" degrades every spring under
            prefers-reduced-motion: transform/scale/slide are dropped (opacity
            is kept), so dialogs & menus cross-fade, sheets fade, and the
            tab-bar pill jumps instead of gliding — no per-component branching.
            Complements the View-Transitions kill-switch in styles.css. */}
				<MotionConfig reducedMotion="user">{children}</MotionConfig>
				<Toaster />
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
