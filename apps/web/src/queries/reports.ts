import { queryOptions } from "@tanstack/react-query";
import {
	getBudgetsAndMarginReport,
	getUtilizationReport,
} from "#/server/reports.ts";

export const utilizationReportQuery = (range: { from: string; to: string }) =>
	queryOptions({
		queryKey: ["reports", "utilization", range.from, range.to],
		queryFn: () => getUtilizationReport({ data: range }),
	});

export const budgetsAndMarginReportQuery = () =>
	queryOptions({
		queryKey: ["reports", "budgets-margin"],
		queryFn: () => getBudgetsAndMarginReport(),
	});
