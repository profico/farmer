import { queryOptions } from "@tanstack/react-query";

import { listMyApiTokens } from "#/server/api-tokens.ts";

import { queryKeys } from "./keys.ts";

// Under the `account` family, beside the sessions: a token belongs to the
// person, not the workspace. The org is in the key anyway, by the rule in
// keys.ts, and the server function runs through the org's membership check.
export const myApiTokensQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).account, "api-tokens"],
		queryFn: () => listMyApiTokens(),
	});
