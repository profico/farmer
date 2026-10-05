import { type ApiAttachedCommit, toApiAttachedCommit } from "@farmer/core/api";
import {
	attachCommitsInput,
	listAttachedCommitsInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byEntry = z.object({ timeEntryId: listAttachedCommitsInput });

/**
 * `/api/v1/orgs/$orgSlug/time-entries/$id/commits` — the commits attached to
 * one of the caller's entries, and new ones. A commit is named by its
 * repository and its sha. The server reads it again from GitHub, so nothing
 * that the caller says about it is stored. Both answer the entry's commits.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/$id/commits/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byEntry,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					timeEntryId: params.id,
				}),
				run: async (ctx, { timeEntryId }): Promise<ApiAttachedCommit[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.listAttachedCommits(
						ctx,
						timeEntryId,
					);
					return rows.map(toApiAttachedCommit);
				},
			}),
			POST: apiRoute({
				input: attachCommitsInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { timeEntryId: params.id }),
				run: async (ctx, input): Promise<ApiAttachedCommit[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.attachCommits(ctx, input);
					return rows.map(toApiAttachedCommit);
				},
			}),
		},
	},
});
