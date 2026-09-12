import type {
	AbsenceReportInput,
	MonthReportInput,
	TimeReportDetailInput,
	TimeReportSummaryInput,
} from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";

import {
	getAbsenceReport,
	getBudgetBurnReport,
	getOvertimeDetail,
	getOvertimeReport,
	getTimeReportDetail,
	getTimeReportSummary,
} from "#/server/reports.ts";

import { queryKeys } from "./keys.ts";

// Report keys carry their whole input in the key. Filters are part of the
// identity of the result — two different filter sets are two different
// reports, not one report to be refetched.
export const timeReportSummaryQuery = (
	org: string,
	input: TimeReportSummaryInput,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).reports, "time-summary", input],
		queryFn: () => getTimeReportSummary({ data: input }),
	});

export const timeReportDetailQuery = (
	org: string,
	input: TimeReportDetailInput,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).reports, "time-detail", input],
		queryFn: () => getTimeReportDetail({ data: input }),
	});

export const budgetBurnReportQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).reports, "budget-burn"],
		queryFn: () => getBudgetBurnReport(),
	});

export const overtimeReportQuery = (org: string, input: MonthReportInput) =>
	queryOptions({
		queryKey: [...queryKeys(org).reports, "overtime", input],
		queryFn: () => getOvertimeReport({ data: input }),
	});

export const overtimeDetailQuery = (
	org: string,
	input: MonthReportInput & { userId: string },
) =>
	queryOptions({
		queryKey: [...queryKeys(org).reports, "overtime-detail", input],
		queryFn: () => getOvertimeDetail({ data: input }),
	});

export const absenceReportQuery = (org: string, input: AbsenceReportInput) =>
	queryOptions({
		queryKey: [...queryKeys(org).reports, "absence", input],
		queryFn: () => getAbsenceReport({ data: input }),
	});
