import { queryOptions } from "@tanstack/react-query";
import { suggestDayAssembly } from "#/server/day-assembly.ts";

export const dayAssemblySuggestionsQuery = (date: string) =>
	queryOptions({
		queryKey: ["day-assembly", date],
		queryFn: () => suggestDayAssembly({ data: { date } }),
		// Suggestions reflect live external state (calendar, commits) plus what's
		// already logged — always refetch when the dialog opens.
		staleTime: 0,
	});
