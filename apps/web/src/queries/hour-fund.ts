import { queryOptions } from "@tanstack/react-query";

import {
	listHourFundsForYear,
	suggestMonthlyHourFund,
} from "#/server/hour-fund.ts";

import { queryKeys } from "./keys.ts";

export const hourFundYearQuery = (org: string, year: number) =>
	queryOptions({
		queryKey: [...queryKeys(org).hourFund, year],
		queryFn: () => listHourFundsForYear({ data: { year } }),
	});

// What the working calendar implies for a month, offered as a default. Never
// written automatically — a wrong fund silently skews every Expected figure.
export const hourFundSuggestionQuery = (
	org: string,
	year: number,
	month: number,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).hourFund, "suggestion", year, month],
		queryFn: () => suggestMonthlyHourFund({ data: { year, month } }),
	});
