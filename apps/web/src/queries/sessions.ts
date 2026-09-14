import { queryOptions } from "@tanstack/react-query";

import { listMySessions } from "#/server/sessions.ts";

import { queryKeys } from "./keys.ts";

// Under the `account` family, beside the sign-in methods: both are about the
// person's account rather than the workspace. The org is still in the key even
// though sessions are per user — the rule in keys.ts is that every key names
// its organization, and the server function behind this one runs through the
// org's membership check.
export const mySessionsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).account, "sessions"],
		queryFn: () => listMySessions(),
	});
