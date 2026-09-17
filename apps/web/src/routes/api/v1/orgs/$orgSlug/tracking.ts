import { type ApiTracking, toApiPeriod } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/tracking` — `farmer status`. The caller's own
 * week and month against the Tracking rule, through `myTargets`: the same
 * figures the home page shows and the same verdict a lead reads on Tracking,
 * so the terminal can never disagree with either.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tracking")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiTracking> => {
					const { complianceService } = await import("@farmer/core/services");
					const targets = await complianceService.myTargets(ctx);

					return {
						today: targets.today,
						daySeconds: targets.daySeconds,
						tolerancePct: targets.tolerancePct,
						week: toApiPeriod(targets.week),
						month: toApiPeriod(targets.month),
					};
				},
			}),
		},
	},
});
