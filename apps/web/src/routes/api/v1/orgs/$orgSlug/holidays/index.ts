import type { ApiHoliday, ApiHolidaySwitch } from "@farmer/core/api";
import {
	holidaysYearQueryInput,
	setHolidayDisabledInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/holidays?year=2026` — the public holidays of the
 * organization's country in one year, as Settings → Holidays lists them.
 * `disabled` marks a day that an admin made a working day.
 *
 * PATCH switches one holiday off (`disabled: true`), so the day is a working
 * day, or on again. It names the holiday by its `name`. Admins only.
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
			PATCH: apiRoute({
				input: setHolidayDisabledInput,
				run: async (ctx, input): Promise<ApiHolidaySwitch> => {
					const { holidaysService } = await import("@farmer/core/services");
					await holidaysService.setHolidayDisabled(ctx, input);
					return { name: input.name, disabled: input.disabled };
				},
			}),
		},
	},
});
