import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
	countPendingTimeOff,
	getIsTimeOffApprover,
	getTimeOffBalance,
	listAllTimeOffRequests,
	listEligibleReviewers,
	listMyTimeOff,
} from "#/server/time-off.ts";

export const myTimeOffQuery = () =>
	queryOptions({
		queryKey: ["time-off", "mine"],
		queryFn: () => listMyTimeOff(),
	});

export const allTimeOffQuery = (status?: "pending" | "approved" | "denied") =>
	queryOptions({
		queryKey: ["time-off", "all", status ?? "all"],
		queryFn: () =>
			listAllTimeOffRequests({ data: status ? { status } : undefined }),
		// Switching the filter tab shouldn't blank the table while the new
		// status's data loads — keep showing the previous rows until it's ready.
		placeholderData: keepPreviousData,
	});

export const pendingTimeOffCountQuery = () =>
	queryOptions({
		queryKey: ["time-off", "pending-count"],
		queryFn: () => countPendingTimeOff(),
	});

export const timeOffBalanceQuery = (year?: number) =>
	queryOptions({
		queryKey: ["time-off", "balance", year ?? "current"],
		queryFn: () =>
			getTimeOffBalance({ data: year ? { year } : undefined }),
	});

export const eligibleReviewersQuery = () =>
	queryOptions({
		queryKey: ["time-off", "eligible-reviewers"],
		queryFn: () => listEligibleReviewers(),
	});

export const isTimeOffApproverQuery = () =>
	queryOptions({
		queryKey: ["time-off", "is-approver"],
		queryFn: () => getIsTimeOffApprover(),
	});
