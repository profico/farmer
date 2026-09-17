import { type ApiTimeEntry, toApiTimeEntry } from "@farmer/core/api";
import { confirmTimerInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/timer/confirm` — the second half of
 * `farmer stop`.
 *
 * It answers the entry as the lists show it, so the CLI prints what it logged
 * without a second request — the same reason `POST /time-entries` re-reads
 * through `getOwnDetailed`.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/timer/confirm")({
	server: {
		handlers: {
			POST: apiRoute({
				input: confirmTimerInput,
				run: async (ctx, input): Promise<ApiTimeEntry> => {
					const { timersService, timeEntriesService } =
						await import("@farmer/core/services");
					const created = await timersService.confirm(ctx, input);
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
