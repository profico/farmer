import type { RewindInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";

import { getMyRewind } from "#/server/rewind.ts";

import { queryKeys } from "./keys.ts";

// A year is a lot of rows to add up and changes slowly, so an open Rewind is
// not refetched under the person while they tap through it.
export const myRewindQuery = (org: string, input: RewindInput) =>
	queryOptions({
		queryKey: [...queryKeys(org).rewind, input],
		queryFn: () => getMyRewind({ data: input }),
		staleTime: 5 * 60_000,
	});
