import { queryOptions } from "@tanstack/react-query";

import { getComplianceDashboard } from "#/server/compliance.ts";

import { queryKeys } from "./keys.ts";

// One query, both views. The two lists are computed from overlapping data, so
// splitting them into separate round trips would only double the work.
export const complianceDashboardQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).compliance, "dashboard"],
		queryFn: () => getComplianceDashboard(),
	});
