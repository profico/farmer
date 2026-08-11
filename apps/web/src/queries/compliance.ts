import { queryOptions } from "@tanstack/react-query";
import { getComplianceDashboard } from "#/server/compliance.ts";

// One query, both views. The two lists are computed from overlapping data, so
// splitting them into separate round trips would only double the work.
export const complianceDashboardQuery = () =>
	queryOptions({
		queryKey: ["compliance", "dashboard"],
		queryFn: () => getComplianceDashboard(),
	});
