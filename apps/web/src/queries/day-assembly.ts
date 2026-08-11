import { queryOptions } from "@tanstack/react-query";
import { suggestDayAssembly } from "#/server/day-assembly.ts";
import { queryKeys } from "./keys.ts";

export const dayAssemblySuggestionsQuery = (date: string) =>
	queryOptions({
		queryKey: [...queryKeys.dayAssembly, date],
		queryFn: () => suggestDayAssembly({ data: { date } }),
		// Suggestions reflect live external state (calendar, commits) plus what's
		// already logged — always refetch when the dialog opens.
		staleTime: 0,
	});
