import { queryOptions } from "@tanstack/react-query";

import { listRecurringBlockRules } from "#/server/recurring-block-rules.ts";

import { queryKeys } from "./keys.ts";

export const recurringBlockRulesQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).recurringBlockRules],
		queryFn: () => listRecurringBlockRules(),
	});
