import type { ApiAbsenceResult } from "@farmer/core/api";
import { logAbsenceRangeInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/absences` — `farmer off`. Books an absence task
 * across a span for the caller. The server expands the span, because only it
 * knows the person's working days and the org's holidays; the answer names
 * each day it booked and each day it skipped, and why.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/absences/")({
	server: {
		handlers: {
			POST: apiRoute({
				input: logAbsenceRangeInput,
				run: async (ctx, input): Promise<ApiAbsenceResult> => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const result = await timeEntriesService.logAbsenceRange(ctx, input);
					return { booked: result.booked, skipped: result.skipped };
				},
			}),
		},
	},
});
