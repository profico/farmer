import { queryOptions } from "@tanstack/react-query";
import {
	getBudgetsAndMarginReport,
	getMyUtilization,
	getUtilizationReport,
} from "#/server/reports.ts";

export const utilizationReportQuery = (range: { from: string; to: string }) =>
	queryOptions({
		queryKey: ["reports", "utilization", range.from, range.to],
		queryFn: () => getUtilizationReport({ data: range }),
	});

// The caller's own expected-vs-logged for a range — any member may read this
// (unlike utilizationReportQuery, which is admin-only for the whole org).
export const myUtilizationQuery = (range: { from: string; to: string }) =>
	queryOptions({
		queryKey: ["reports", "my-utilization", range.from, range.to],
		queryFn: () => getMyUtilization({ data: range }),
	});

export const budgetsAndMarginReportQuery = () =>
	queryOptions({
		queryKey: ["reports", "budgets-margin"],
		queryFn: () => getBudgetsAndMarginReport(),
	});
