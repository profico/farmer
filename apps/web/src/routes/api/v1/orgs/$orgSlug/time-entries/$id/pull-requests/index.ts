import {
	type ApiAttachedPullRequest,
	toApiAttachedPullRequest,
} from "@farmer/core/api";
import {
	attachPullRequestsInput,
	listAttachedPullRequestsInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byEntry = z.object({ timeEntryId: listAttachedPullRequestsInput });

/**
 * `/api/v1/orgs/$orgSlug/time-entries/$id/pull-requests` — the pull request
 * events attached to one of the caller's entries, and new ones. A pull
 * request is named by its repository and number. The server keeps only what
 * the caller did on it on the entry's day. Both answer the entry's events.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/$id/pull-requests/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byEntry,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					timeEntryId: params.id,
				}),
				run: async (
					ctx,
					{ timeEntryId },
				): Promise<ApiAttachedPullRequest[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.listAttachedPullRequestActivity(
						ctx,
						timeEntryId,
					);
					return rows.map(toApiAttachedPullRequest);
				},
			}),
			POST: apiRoute({
				input: attachPullRequestsInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { timeEntryId: params.id }),
				run: async (ctx, input): Promise<ApiAttachedPullRequest[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.attachPullRequests(ctx, input);
					return rows.map(toApiAttachedPullRequest);
				},
			}),
		},
	},
});
