import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { RouteError } from "./components/route-error";
import { RouteNotFound } from "./components/route-not-found";
import { RoutePending } from "./components/route-pending";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	// Instant navigations. Two gaps make a click feel slow: the client→server
	// round trip, and the wait before *anything* renders. We close both.
	//
	// Round trip: `intent` preloads on hover/touch after `defaultPreloadDelay`
	// (50ms), and `intentProximity` starts that timer while the pointer is still
	// approaching the link — so by the time it's clicked, the loader has usually
	// already resolved. `defaultPreloadStaleTime: 0` is deliberate and stays:
	// with the TanStack Query integration the router should never do its own
	// loader-result caching, it should re-run the loader and let Query answer
	// from its cache (see the queryClient defaults in root-provider.tsx).
	//
	// Render gap: `defaultPendingMs` is 1000 out of the box, so a cold
	// navigation renders *nothing* for a full second before RoutePending shows.
	// 150ms is under the threshold where a delay reads as "slow", while still
	// letting a preloaded (cache-hit) navigation land without ever flashing a
	// pending state. `defaultPendingMinMs` then holds it long enough not to
	// strobe once shown.
	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadIntentProximity: 40,
		defaultPreloadStaleTime: 0,
		defaultPendingMs: 150,
		defaultPendingMinMs: 300,
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
