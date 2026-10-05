import { type ApiHourFundMonth, toApiHourFundMonth } from "@farmer/core/api";
import { monthPeriodInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/hour-fund/clear` — removes the fund of one
 * month, so the month has no fund again. A separate call and not a null on
 * the set, because zero is a real fund. Admins only. Answers the year.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/hour-fund/clear")({
	server: {
		handlers: {
			POST: apiRoute({
				input: monthPeriodInput,
				run: async (ctx, { year, month }): Promise<ApiHourFundMonth[]> => {
					const { hourFundService } = await import("@farmer/core/services");
					await hourFundService.clear(ctx, year, month);
					const rows = await hourFundService.listForYear(ctx, year);
					return rows.map(toApiHourFundMonth);
				},
			}),
		},
	},
});
