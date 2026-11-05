import {
	type ApiAttachedPullRequest,
	toApiAttachedPullRequest,
} from "@farmer/core/api";
import { detachPullRequestActivityInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type ActivityParams = { orgSlug: string; id: string; activityId: string };

const byAttachment = z.object({
	timeEntryId: detachPullRequestActivityInput,
	activityId: detachPullRequestActivityInput,
});

/**
 * `DELETE /api/v1/orgs/$orgSlug/time-entries/$id/pull-requests/$activityId`
 * — take one pull request event off one of the caller's entries. When it was
 * the last review on a Code Review entry, the commit engine does not file
 * that review's block again. Answers the entry's events after the change.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/$id/pull-requests/$activityId",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: byAttachment,
				raw: ({ params }: ApiRequest<ActivityParams>) => ({
					timeEntryId: params.id,
					activityId: params.activityId,
				}),
				run: async (
					ctx,
					{ timeEntryId, activityId },
				): Promise<ApiAttachedPullRequest[]> => {
					const { githubService } = await import("@farmer/core/services");
					// The service finds the event by its own id. The path names the
					// entry too, so the event must be on that entry.
					const attached = await githubService.listAttachedPullRequestActivity(
						ctx,
						timeEntryId,
					);
					if (!attached.some((row) => row.id === activityId)) {
						throw new Error("Pull request activity not found");
					}
					await githubService.detachPullRequestActivity(ctx, activityId);
					const rows = await githubService.listAttachedPullRequestActivity(
						ctx,
						timeEntryId,
					);
					return rows.map(toApiAttachedPullRequest);
				},
			}),
		},
	},
});
