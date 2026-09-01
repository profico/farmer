import { queryOptions } from "@tanstack/react-query";

import { suggestDayAssembly } from "#/server/day-assembly.ts";

import { queryKeys } from "./keys.ts";

export const dayAssemblySuggestionsQuery = (
	org: string,
	date: string,
	includeDismissed = false,
) =>
	queryOptions({
		// The flag is part of the key: the two answers are different lists, and
		// flipping the toggle has to refetch rather than reuse the narrower one.
		queryKey: [...queryKeys(org).dayAssembly, date, includeDismissed],
		queryFn: () => suggestDayAssembly({ data: { date, includeDismissed } }),
		// Suggestions reflect live external state (calendar, commits) plus what's
		// already logged — always refetch when the dialog opens.
		staleTime: 0,
	});
