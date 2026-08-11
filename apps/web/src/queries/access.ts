import { queryOptions } from "@tanstack/react-query";
import { getMyAccess } from "#/server/auth.ts";

// UI gating only — every server function re-resolves the same picture and
// asserts. Cached generously: an assignment change is rare and a stale nav item
// costs nothing worse than a 403 on click.
export const myAccessQuery = () =>
	queryOptions({
		queryKey: ["access", "me"],
		queryFn: () => getMyAccess(),
		staleTime: 60_000,
	});
