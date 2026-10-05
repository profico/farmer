import type { ApiHoliday } from "@farmer/core/api";
import { holidaysYearQueryInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/holidays?year=2026` — the public holidays of the
 * organization's country in one year, as Settings → Holidays lists them.
 * `disabled` marks a day that an admin made a working day.
 *
 * Read-only here. Only an admin may switch a holiday off.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/holidays/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: holidaysYearQueryInput,
				raw: typedQuery({ numbers: ["year"] }),
				run: async (ctx, { year }): Promise<ApiHoliday[]> => {
					const { holidaysService } = await import("@farmer/core/services");
					const rows = await holidaysService.listForYearWithStatus(ctx, year);
					return rows.map((row) => ({
						date: row.date,
						name: row.name,
						disabled: row.disabled,
					}));
				},
			}),
		},
	},
});
