import type { ApiArchiveResult } from "@farmer/core/api";
import { setMemberArchivedInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

/**
 * `POST /api/v1/orgs/$orgSlug/people/$userId/archive` — archives a person who has left. They keep every entry and report, and they leave every team lead list. Nobody archives themselves.
 * Admins only, which `membersService.setArchived` checks.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/archive",
)({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: setMemberArchivedInput,
				raw: ({ params }: ApiRequest<PersonParams>) => ({
					userId: params.userId,
					archived: true,
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
