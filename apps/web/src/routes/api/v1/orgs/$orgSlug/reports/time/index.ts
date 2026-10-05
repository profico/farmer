import { type ApiTimeReport, toApiTimeReport } from "@farmer/core/api";
import { timeReportSummaryInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/reports/time` — the Time tab of Reports: hours by
 * client, by project or by person (`tab`), over at most 366 days.
 *
 * The service limits it to the caller's scope, as on the web page: an Admin
 * sees everybody, a PM their projects, a Team Lead their people and their
 * projects, and a Member only their own time. Nobody is refused.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/reports/time/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: timeReportSummaryInput,
				raw: typedQuery({ booleans: ["activeOnly"] }),
				run: async (ctx, input): Promise<ApiTimeReport> => {
					const { reportsService } = await import("@farmer/core/services");
					return toApiTimeReport(await reportsService.timeSummary(ctx, input));
				},
			}),
		},
	},
});
