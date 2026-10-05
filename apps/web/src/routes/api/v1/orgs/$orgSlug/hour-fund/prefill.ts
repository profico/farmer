import { type ApiHourFundMonth, toApiHourFundMonth } from "@farmer/core/api";
import { hourFundYearInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/hour-fund/prefill` — fills each month of a year
 * that has no fund from the holiday calendar. A month that has a fund keeps
 * it. Admins only. Answers the year.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/hour-fund/prefill")(
	{
		server: {
			handlers: {
				POST: apiRoute({
					input: hourFundYearInput,
					run: async (ctx, { year }): Promise<ApiHourFundMonth[]> => {
						const { hourFundService } = await import("@farmer/core/services");
						await hourFundService.prefillYear(ctx, year);
						const rows = await hourFundService.listForYear(ctx, year);
						return rows.map(toApiHourFundMonth);
					},
				}),
			},
		},
	},
);
