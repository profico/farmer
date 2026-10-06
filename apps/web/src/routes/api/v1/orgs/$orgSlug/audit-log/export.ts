import type { ApiAuditExport } from "@farmer/core/api";
import { exportAuditEventsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/audit-log/export` — the log as CSV, for at most
 * a year and 10,000 rows. A POST and not a GET, because the export records
 * itself in the log. Admin only.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/audit-log/export")({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: exportAuditEventsInput,
				run: async (ctx, input): Promise<ApiAuditExport> => {
					const { auditService } = await import("@farmer/core/services");
					const { csv, rows, truncated } = await auditService.exportCsv(
						ctx,
						input,
					);
					return { csv, rows, truncated };
				},
			}),
		},
	},
});
