import { queryOptions } from "@tanstack/react-query";

import {
	listHolidaysForRange,
	listHolidaysForYearWithStatus,
	listSupportedCountries,
} from "#/server/holidays.ts";

import { queryKeys } from "./keys.ts";

export const supportedCountriesQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).holidays, "countries"],
		queryFn: () => listSupportedCountries(),
		staleTime: Number.POSITIVE_INFINITY,
	});

export const holidaysForYearWithStatusQuery = (org: string, year: number) =>
	queryOptions({
		queryKey: [...queryKeys(org).holidays, "year-status", year],
		queryFn: () => listHolidaysForYearWithStatus({ data: year }),
	});

export const holidaysForRangeQuery = (
	org: string,
	range: { from: string; to: string },
) =>
	queryOptions({
		queryKey: [...queryKeys(org).holidays, "range", range.from, range.to],
		queryFn: () => listHolidaysForRange({ data: range }),
	});
