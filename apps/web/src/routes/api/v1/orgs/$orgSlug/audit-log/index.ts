import { type ApiAuditPage, toApiAuditPage } from "@farmer/core/api";
import { listAuditEventsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/audit-log` — one page of the audit log, newest
 * first, with the web page's filters: `category`, `kind`, `userId` (who did it,
 * or who it happened to), `from` and `to`. Send `nextCursor` back as `cursor`
 * for the next page. Admin only.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/audit-log/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listAuditEventsInput,
				run: async (ctx, input): Promise<ApiAuditPage> => {
					const { auditService } = await import("@farmer/core/services");
					const { describeAuditEvent } = await import("@farmer/core/lib/audit");
					return toApiAuditPage(
						await auditService.list(ctx, input),
						describeAuditEvent,
					);
				},
			}),
		},
	},
});
