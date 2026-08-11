import { queryOptions } from "@tanstack/react-query";
import { listRecurringBlockRules } from "#/server/recurring-block-rules.ts";
import { queryKeys } from "./keys.ts";

export const recurringBlockRulesQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.recurringBlockRules],
		queryFn: () => listRecurringBlockRules(),
	});
