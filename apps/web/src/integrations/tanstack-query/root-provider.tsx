import { QueryClient } from "@tanstack/react-query";

export function getContext() {
	// The router re-runs a route's loader on every navigation and preload
	// (`defaultPreloadStaleTime: 0` in router.tsx) — every loader here goes
	// through `ensureQueryData`, so this cache is what actually decides whether
	// a navigation hits the network or resolves instantly.
	//
	// A 30s staleTime is what makes hover-preload → click instant: the preload
	// populates the cache, and the click's loader resolves from it without a
	// second request. It's safe here because freshness is driven by explicit
	// invalidation, not by expiry — every mutation in the app invalidates the
	// keys it affects. Queries that genuinely need per-call freshness override
	// it (queries/day-assembly.ts sets 0; queries/holidays.ts sets Infinity).
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
			},
		},
	});

	return {
		queryClient,
	};
}
export default function TanstackQueryProvider() {}
