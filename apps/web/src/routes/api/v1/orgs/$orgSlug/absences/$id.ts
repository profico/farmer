import { deleteTimeEntryInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ timeEntryId: deleteTimeEntryInput });

/**
 * `DELETE /api/v1/orgs/$orgSlug/absences/$id` — removes one absence entry.
 *
 * **The caller's own only**, which is narrower than the service. A PM may
 * remove the absence of people on their projects through `removeAbsence`, and
 * the web app offers that; the CLI's first version is a person's own time and
 * nothing else (issue #36, section 1). So the entry is looked up as the
 * caller's own first, and anybody else's is the same 404 as one that does not
 * exist. The service still makes its own checks after that.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/absences/$id")({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					timeEntryId: params.id,
				}),
				run: async (ctx, { timeEntryId }) => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const own = await timeEntriesService.getOwn(ctx, timeEntryId);

					if (!own) throw new Error("Time entry not found");

					const removed = await timeEntriesService.removeAbsence(
						ctx,
						timeEntryId,
					);

					return { id: removed.id };
				},
			}),
		},
	},
});
