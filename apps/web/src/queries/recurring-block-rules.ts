import { queryOptions } from "@tanstack/react-query";
import { listRecurringBlockRules } from "#/server/recurring-block-rules.ts";

export const recurringBlockRulesQuery = () =>
	queryOptions({
		queryKey: ["recurring-block-rules"],
		queryFn: () => listRecurringBlockRules(),
	});
