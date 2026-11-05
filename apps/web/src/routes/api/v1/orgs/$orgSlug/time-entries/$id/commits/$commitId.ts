import { type ApiAttachedCommit, toApiAttachedCommit } from "@farmer/core/api";
import { detachCommitInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type CommitParams = { orgSlug: string; id: string; commitId: string };

const byAttachment = z.object({
	timeEntryId: detachCommitInput,
	commitId: detachCommitInput,
});

/**
 * `DELETE /api/v1/orgs/$orgSlug/time-entries/$id/commits/$commitId` — take a
 * commit off one of the caller's entries. `$commitId` is the attachment's
 * `id`. An attachment of another entry is a 404, the same as one that does
 * not exist. Answers the entry's commits after the change.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/$id/commits/$commitId",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: byAttachment,
				raw: ({ params }: ApiRequest<CommitParams>) => ({
					timeEntryId: params.id,
					commitId: params.commitId,
				}),
				run: async (
					ctx,
					{ timeEntryId, commitId },
				): Promise<ApiAttachedCommit[]> => {
					const { githubService } = await import("@farmer/core/services");
					// The service finds the attachment by its own id. The path names
					// the entry too, so the attachment must be on that entry.
					const attached = await githubService.listAttachedCommits(
						ctx,
						timeEntryId,
					);
					if (!attached.some((row) => row.id === commitId)) {
						throw new Error("Commit attachment not found");
					}
					await githubService.detachCommit(ctx, commitId);
					const rows = await githubService.listAttachedCommits(
						ctx,
						timeEntryId,
					);
					return rows.map(toApiAttachedCommit);
				},
			}),
		},
	},
});
