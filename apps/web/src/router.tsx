import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { RouteError } from "./components/route-error";
import { RouteNotFound } from "./components/route-not-found";
import { RoutePending } from "./components/route-pending";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { loadPreferences } from "./lib/preferences";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	// `getRouter()` also runs during SSR (no localStorage there); loadPreferences()
	// already falls back to defaults in that case. Live changes to this setting
	// are applied by <PreferencesSync> via router.update(), not by re-running this.
	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		defaultViewTransition: loadPreferences().pageTransition !== "none",
		defaultErrorComponent: RouteError,
		defaultPendingComponent: RoutePending,
		defaultNotFoundComponent: RouteNotFound,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
