import type { ApiFileResult } from "@farmer/core/api";
import { fileTimeEntriesInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/time-entries/file` — `farmer file`. Attributes
 * unfiled entries to a project.
 *
 * `fileMany` files what it can and reports the rest rather than refusing the
 * batch, so a 200 here can still carry `failed > 0`; the CLI shows
 * `firstError`.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/time-entries/file")(
	{
		server: {
			handlers: {
				POST: apiRoute({
					input: fileTimeEntriesInput,
					run: async (ctx, input): Promise<ApiFileResult> => {
						const { timeEntriesService } =
							await import("@farmer/core/services");
						const result = await timeEntriesService.fileMany(ctx, input);
						return {
							filed: result.filed,
							failed: result.failed,
							firstError: result.firstError ?? null,
						};
					},
				}),
			},
		},
	},
);
