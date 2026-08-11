import { queryOptions } from "@tanstack/react-query";
import {
	listHolidaysForRange,
	listHolidaysForYearWithStatus,
	listSupportedCountries,
} from "#/server/holidays.ts";
import { queryKeys } from "./keys.ts";

export const supportedCountriesQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.holidays, "countries"],
		queryFn: () => listSupportedCountries(),
		staleTime: Number.POSITIVE_INFINITY,
	});

export const holidaysForYearWithStatusQuery = (year: number) =>
	queryOptions({
		queryKey: [...queryKeys.holidays, "year-status", year],
		queryFn: () => listHolidaysForYearWithStatus({ data: year }),
	});

export const holidaysForRangeQuery = (range: { from: string; to: string }) =>
	queryOptions({
		queryKey: [...queryKeys.holidays, "range", range.from, range.to],
		queryFn: () => listHolidaysForRange({ data: range }),
	});
