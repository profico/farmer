import { queryOptions } from "@tanstack/react-query";
import {
	listHourFundsForYear,
	suggestMonthlyHourFund,
} from "#/server/hour-fund.ts";

export const hourFundYearQuery = (year: number) =>
	queryOptions({
		queryKey: ["hour-fund", year],
		queryFn: () => listHourFundsForYear({ data: { year } }),
	});

// What the working calendar implies for a month, offered as a default. Never
// written automatically — a wrong fund silently skews every Expected figure.
export const hourFundSuggestionQuery = (year: number, month: number) =>
	queryOptions({
		queryKey: ["hour-fund", "suggestion", year, month],
		queryFn: () => suggestMonthlyHourFund({ data: { year, month } }),
	});
