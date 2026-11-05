import { type ApiTrackingReport, toApiTrackingReport } from "@farmer/core/api";
import { monthReportInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/reports/tracking?year&month` — the Tracking tab
 * of Reports: each person's work and time off against the month's hour fund.
 * The same rule the reminders use.
 *
 * Scoped by people, as on the web page: a Member sees only their own row. The
 * caller's own week and month are also on `GET …/tracking`.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/reports/tracking")({
	server: {
		handlers: {
			GET: apiRoute({
				input: monthReportInput,
				raw: typedQuery({ numbers: ["year", "month"] }),
				run: async (ctx, input): Promise<ApiTrackingReport> => {
					const { complianceService } = await import("@farmer/core/services");
					return toApiTrackingReport(
						await complianceService.tracking(ctx, input),
					);
				},
			}),
		},
	},
});
