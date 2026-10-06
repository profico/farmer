import type { ApiArchiveResult } from "@farmer/core/api";
import { setMemberArchivedInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

/**
 * `POST /api/v1/orgs/$orgSlug/people/$userId/restore` — restores an archived person. For a person who never signed in, this also confirms the address, and `emailConfirmed` says whether it did.
 * Admins only, which `membersService.setArchived` checks.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/restore",
)({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: setMemberArchivedInput,
				raw: ({ params }: ApiRequest<PersonParams>) => ({
					userId: params.userId,
					archived: false,
				}),
				run: async (ctx, input): Promise<ApiArchiveResult> => {
					const { membersService } = await import("@farmer/core/services");
					const result = await membersService.setArchived(
						ctx,
						input.userId,
						input.archived,
					);
					return { emailConfirmed: result.emailConfirmed };
				},
			}),
		},
	},
});
