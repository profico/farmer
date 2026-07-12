import { queryOptions } from "@tanstack/react-query";
import {
	listHolidaysForRange,
	listHolidaysForYear,
	listHolidaysForYearWithStatus,
	listSupportedCountries,
} from "#/server/holidays.ts";

export const supportedCountriesQuery = () =>
	queryOptions({
		queryKey: ["holidays", "countries"],
		queryFn: () => listSupportedCountries(),
		staleTime: Number.POSITIVE_INFINITY,
	});

export const holidaysForYearQuery = (year: number) =>
	queryOptions({
		queryKey: ["holidays", "year", year],
		queryFn: () => listHolidaysForYear({ data: year }),
	});

export const holidaysForYearWithStatusQuery = (year: number) =>
	queryOptions({
		queryKey: ["holidays", "year-status", year],
		queryFn: () => listHolidaysForYearWithStatus({ data: year }),
	});

export const holidaysForRangeQuery = (range: { from: string; to: string }) =>
	queryOptions({
		queryKey: ["holidays", "range", range.from, range.to],
		queryFn: () => listHolidaysForRange({ data: range }),
	});
