import { toApiTimeEntry } from "@farmer/core/api";
import {
	createTimeEntryInput,
	listTimeEntriesRangeInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, rangeFromQuery } from "#/server/api-route.ts";

/**
 * `GET` and `POST /api/v1/orgs/$orgSlug/time-entries` — `farmer today`,
 * `week`, `ls` and `log`.
 *
 * The GET goes through `listRange`, which still writes: it recomputes the fill
 * blocks of the days it reads, inside the automation window (see the note on
 * `listRange`). A person running `farmer today` is fine; `watch farmer today`
 * is a fill-block rewrite every two seconds, which is why the per-user limit
 * applies to reads too. A read-only API token gets `persist: false`: the same
 * rows, and no write.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/time-entries/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listTimeEntriesRangeInput,
				raw: rangeFromQuery,
				run: async (ctx, range, caller) => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const rows = await timeEntriesService.listRange(ctx, range, {
						persist: caller.scope !== "read",
					});
					return rows.map(toApiTimeEntry);
				},
			}),
			// Answers the entry as the list shows it — task, project, client — so
			// the CLI can print what it just logged without a second request.
			POST: apiRoute({
				input: createTimeEntryInput,
				run: async (ctx, input) => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const created = await timeEntriesService.create(ctx, input);
					const entry = await timeEntriesService.getOwnDetailed(
						ctx,
						created.id,
					);
					if (!entry) throw new Error("Time entry not found");
					return toApiTimeEntry(entry);
				},
			}),
		},
	},
});
