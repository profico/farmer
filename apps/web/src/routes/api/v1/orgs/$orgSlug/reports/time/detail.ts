import {
	type ApiTimeReportDetail,
	toApiTimeReportDetail,
} from "@farmer/core/api";
import { timeReportDetailInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/reports/time/detail` — every entry behind a
 * figure of the Time tab, and the entries on a project's page
 * (`?projectId=`). The same scope as the Time tab.
 *
 * The rows stop at a cap. `totalRows` and `totalSeconds` count every matching
 * entry, so a total is never short when `truncated` is true.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/reports/time/detail",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: timeReportDetailInput,
				raw: typedQuery({ booleans: ["activeOnly"] }),
				run: async (ctx, input): Promise<ApiTimeReportDetail> => {
					const { reportsService } = await import("@farmer/core/services");
					return toApiTimeReportDetail(
						await reportsService.timeDetail(ctx, input),
					);
				},
			}),
		},
	},
});
