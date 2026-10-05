import { type ApiAbsenceReport, toApiAbsenceReport } from "@farmer/core/api";
import { absenceReportInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/reports/absence?from&to` — the Absence tab of
 * Reports: time off by person and by absence task.
 *
 * Scoped by people, as on the web page: a Member sees their own time off, a
 * Team Lead their people's, a PM the people on their projects, and an Admin
 * everybody's.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/reports/absence")({
	server: {
		handlers: {
			GET: apiRoute({
				input: absenceReportInput,
				run: async (ctx, input): Promise<ApiAbsenceReport> => {
					const { reportsService } = await import("@farmer/core/services");
					return toApiAbsenceReport(await reportsService.absence(ctx, input));
				},
			}),
		},
	},
});
