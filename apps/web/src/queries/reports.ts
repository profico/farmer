import type {
	AbsenceReportInput,
	MonthReportInput,
	TimeReportDetailInput,
	TimeReportSummaryInput,
	UtilizationTrendInput,
	VarianceTrendInput,
} from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";
import {
	getAbsenceReport,
	getBudgetBurnReport,
	getOvertimeDetail,
	getOvertimeReport,
	getTimeReportDetail,
	getTimeReportSummary,
	getUtilizationReport,
	getUtilizationTrend,
	getVarianceReport,
	getVarianceTrend,
} from "#/server/reports.ts";

// Report keys carry their whole input in the key. Filters are part of the
// identity of the result — two different filter sets are two different
// reports, not one report to be refetched.
export const timeReportSummaryQuery = (input: TimeReportSummaryInput) =>
	queryOptions({
		queryKey: ["reports", "time-summary", input],
		queryFn: () => getTimeReportSummary({ data: input }),
	});

export const timeReportDetailQuery = (input: TimeReportDetailInput) =>
	queryOptions({
		queryKey: ["reports", "time-detail", input],
		queryFn: () => getTimeReportDetail({ data: input }),
	});

export const budgetBurnReportQuery = () =>
	queryOptions({
		queryKey: ["reports", "budget-burn"],
		queryFn: () => getBudgetBurnReport(),
	});

export const overtimeReportQuery = (input: MonthReportInput) =>
	queryOptions({
		queryKey: ["reports", "overtime", input],
		queryFn: () => getOvertimeReport({ data: input }),
	});

export const overtimeDetailQuery = (
	input: MonthReportInput & { userId: string },
) =>
	queryOptions({
		queryKey: ["reports", "overtime-detail", input],
		queryFn: () => getOvertimeDetail({ data: input }),
	});

export const absenceReportQuery = (input: AbsenceReportInput) =>
	queryOptions({
		queryKey: ["reports", "absence", input],
		queryFn: () => getAbsenceReport({ data: input }),
	});

export const varianceReportQuery = (input: MonthReportInput) =>
	queryOptions({
		queryKey: ["reports", "variance", input],
		queryFn: () => getVarianceReport({ data: input }),
	});

export const varianceTrendQuery = (input: VarianceTrendInput) =>
	queryOptions({
		queryKey: ["reports", "variance-trend", input],
		queryFn: () => getVarianceTrend({ data: input }),
	});

export const utilizationReportQuery = (input: MonthReportInput) =>
	queryOptions({
		queryKey: ["reports", "utilization", input],
		queryFn: () => getUtilizationReport({ data: input }),
	});

export const utilizationTrendQuery = (input: UtilizationTrendInput) =>
	queryOptions({
		queryKey: ["reports", "utilization-trend", input],
		queryFn: () => getUtilizationTrend({ data: input }),
	});
