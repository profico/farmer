import { type ApiOvertimeReport, toApiOvertimeReport } from "@farmer/core/api";
import { overtimeReportInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/reports/overtime` — the Overtime tab of Reports:
 * the entries marked as overtime, by person. The same scope as the Time tab.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/reports/overtime")({
	server: {
		handlers: {
			GET: apiRoute({
				input: overtimeReportInput,
				raw: typedQuery({ booleans: ["activeOnly"] }),
				run: async (ctx, input): Promise<ApiOvertimeReport> => {
					const { reportsService } = await import("@farmer/core/services");
					return toApiOvertimeReport(await reportsService.overtime(ctx, input));
				},
			}),
		},
	},
});
