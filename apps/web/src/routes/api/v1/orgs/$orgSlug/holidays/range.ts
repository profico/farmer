import type { ApiHolidayDay } from "@farmer/core/api";
import { listHolidaysForRangeInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, rangeFromQuery } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/holidays/range?from&to` — the public holidays
 * that are days off between two days, as the timesheet and the home page mark
 * them. A holiday that an admin switched off is not in the list.
 *
 * `from` and `to` default to today in the organization's timezone. The range
 * is 366 days at most.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/holidays/range")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listHolidaysForRangeInput,
				raw: rangeFromQuery,
				run: async (ctx, range): Promise<ApiHolidayDay[]> => {
					const { holidaysService } = await import("@farmer/core/services");
					const byDate = await holidaysService.holidaySetForRange(
						ctx,
						range.from,
						range.to,
					);
					return [...byDate].map(([date, name]) => ({ date, name }));
				},
			}),
		},
	},
});
