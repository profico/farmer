import { queryOptions } from "@tanstack/react-query";

import { getMyAccess } from "#/server/auth.ts";

import { queryKeys } from "./keys.ts";

// UI gating only — every server function re-resolves the same picture and
// asserts. Cached generously: an assignment change is rare and a stale nav item
// costs nothing worse than a 403 on click.
export const myAccessQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).access, "me"],
		queryFn: () => getMyAccess(),
		staleTime: 60_000,
	});
