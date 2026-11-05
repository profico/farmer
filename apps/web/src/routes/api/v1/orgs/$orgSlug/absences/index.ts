import {
	type ApiAbsenceEntry,
	type ApiAbsenceResult,
	toApiAbsenceEntry,
} from "@farmer/core/api";
import { listMyAbsenceInput, logAbsenceRangeInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/absences?year&month` — the caller's own time off
 * in one month. The caller's own only, as the DELETE beside it: the read that
 * a PM uses for another person stays in the web app.
 *
 * `POST /api/v1/orgs/$orgSlug/absences` — `farmer off`. Books an absence task
 * across a span for the caller. The server expands the span, because only it
 * knows the person's working days and the org's holidays; the answer names
 * each day it booked and each day it skipped, and why.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/absences/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listMyAbsenceInput,
				raw: typedQuery({ numbers: ["year", "month"] }),
				run: async (ctx, input): Promise<ApiAbsenceEntry[]> => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const rows = await timeEntriesService.listAbsenceForUser(ctx, {
						...input,
						userId: ctx.userId,
					});
					return rows.map(toApiAbsenceEntry);
				},
			}),
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
