import { toApiUnfiledEntry } from "@farmer/core/api";
import { listTimeEntriesRangeInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, rangeFromQuery } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/unfiled?from&to` — `farmer unfiled`, and the
 * checklist `farmer file` shows. Worked time with no project yet, the
 * caller's own, with the ids `time-entries/file` takes. Same range defaults
 * and the same 62-day ceiling as the time entry list.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/unfiled")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listTimeEntriesRangeInput,
				raw: rangeFromQuery,
				run: async (ctx, range) => {
					const { listUnfiledForUser } = await import("@farmer/core/services");
					const rows = await listUnfiledForUser(ctx, range);
					return rows.map(toApiUnfiledEntry);
				},
			}),
		},
	},
});
