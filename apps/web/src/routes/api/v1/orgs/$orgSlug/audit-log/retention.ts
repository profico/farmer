import type { ApiAuditRetention } from "@farmer/core/api";
import { setAuditRetentionInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `PATCH /api/v1/orgs/$orgSlug/audit-log/retention` — how many days
 * the organization keeps its log: 90, 365, 730 or 2555. Admin only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/audit-log/retention",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiAuditRetention> => {
					const { auditService } = await import("@farmer/core/services");
					return { days: await auditService.retention(ctx) };
				},
			}),
			PATCH: apiRoute({
				input: setAuditRetentionInput,
				run: async (ctx, { days }): Promise<ApiAuditRetention> => {
					const { auditService } = await import("@farmer/core/services");
					return { days: await auditService.setRetention(ctx, days) };
				},
			}),
		},
	},
});
