import { type ApiHourFundMonth, toApiHourFundMonth } from "@farmer/core/api";
import {
	hourFundYearInput,
	setMonthlyHourFundInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/hour-fund` — the monthly hour fund of one year, and
 * a change to one month. Admins only, which `hourFundService` checks: the
 * fund is the base of every person's expected hours.
 *
 * A month with no row has no fund, which is not a fund of zero. The write
 * answers the whole year, as the settings page shows it.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/hour-fund/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: hourFundYearInput,
				raw: typedQuery({ numbers: ["year"] }),
				run: async (ctx, { year }): Promise<ApiHourFundMonth[]> => {
					const { hourFundService } = await import("@farmer/core/services");
					const rows = await hourFundService.listForYear(ctx, year);
					return rows.map(toApiHourFundMonth);
				},
			}),
			POST: apiRoute({
				input: setMonthlyHourFundInput,
				run: async (ctx, input): Promise<ApiHourFundMonth[]> => {
					const { hourFundService } = await import("@farmer/core/services");
					await hourFundService.set(ctx, input);
					const rows = await hourFundService.listForYear(ctx, input.year);
					return rows.map(toApiHourFundMonth);
				},
			}),
		},
	},
});
