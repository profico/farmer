import { toApiTimeEntry } from "@farmer/core/api";
import {
	deleteTimeEntryInput,
	updateTimeEntryInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/** A PATCH body, before it is merged. Only its shape is checked here — an
 *  object of JSON values — because the merged result goes through
 *  `updateTimeEntryInput`, which checks everything else. */
const patchBody = z.record(z.string(), z.json());

const byId = z.object({ timeEntryId: deleteTimeEntryInput });

/**
 * `PATCH` and `DELETE /api/v1/orgs/$orgSlug/time-entries/$id` — `farmer edit`
 * and `farmer rm`. The caller's OWN entries only: both services filter on the
 * caller, and nobody edits another person's worked time.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/time-entries/$id")({
	server: {
		handlers: {
			// A patch, not a replacement. `update` takes the whole entry — the
			// same input the web app's dialog sends — so the stored row is read
			// and the patch laid over it, and the result goes through the full
			// schema. A field sent as null is removed from the merge, which is how
			// a patch clears an optional field such as `projectId`.
			PATCH: apiRoute({
				input: updateTimeEntryInput,
				raw: async ({ ctx, params, body }: ApiRequest<OrgRowParams>) => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const existing = await timeEntriesService.getOwn(ctx, params.id);
					if (!existing) throw new Error("Time entry not found");
					const patch = patchBody.safeParse(body);
					if (!patch.success) {
						throw new Error("The request body must be a JSON object.");
					}
					const merged = {
						date: existing.date,
						projectId: existing.projectId,
						taskId: existing.taskId,
						description: existing.description,
						durationSeconds: existing.durationSeconds,
						overtime: existing.overtime,
						fillsDay: existing.fillsDay,
						meetingUrl: existing.meetingUrl,
						calendarEventId: existing.calendarEventId,
						...patch.data,
						// Last, so a body cannot point the patch at another entry.
						timeEntryId: params.id,
					};
					return Object.fromEntries(
						Object.entries(merged).filter(([, value]) => value !== null),
					);
				},
				run: async (ctx, input) => {
					const { timeEntriesService } = await import("@farmer/core/services");
					await timeEntriesService.update(ctx, input);
					const entry = await timeEntriesService.getOwnDetailed(
						ctx,
						input.timeEntryId,
					);
					if (!entry) throw new Error("Time entry not found");
					return toApiTimeEntry(entry);
				},
			}),
			// `remove` is a delete-where-owned: somebody else's entry, or one
			// already gone, is null rather than a throw. Answered as 404, so the
			// CLI never reports a delete it did not make.
			DELETE: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					timeEntryId: params.id,
				}),
				run: async (ctx, { timeEntryId }) => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const removed = await timeEntriesService.remove(ctx, timeEntryId);
					if (!removed) throw new Error("Time entry not found");
					return { id: removed.id };
				},
			}),
		},
	},
});
