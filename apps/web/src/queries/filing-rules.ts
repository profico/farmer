import { queryOptions } from "@tanstack/react-query";

import { listFilingRules } from "#/server/filing-rules.ts";

import { queryKeys } from "./keys.ts";

export const filingRulesQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).filingRules],
		queryFn: () => listFilingRules(),
	});
