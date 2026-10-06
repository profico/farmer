import { type ApiPersonProfile, toApiPersonProfile } from "@farmer/core/api";
import { setMemberTypeInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { bodyWithPath } from "#/server/api-query.ts";
import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

/**
 * `POST /api/v1/orgs/$orgSlug/people/$userId/type` — changes the person type
 * from `effectiveFrom` on. Earlier months keep the type they had, because
 * every report reads the type of its own month. Admins only, which
 * `membersService.setType` checks. Answers the person.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/type",
)({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: setMemberTypeInput,
				raw: ({ params, body }: ApiRequest<PersonParams>) =>
					bodyWithPath(body, { userId: params.userId }),
				run: async (ctx, input): Promise<ApiPersonProfile> => {
					const { membersService } = await import("@farmer/core/services");
					await membersService.setType(ctx, input);
					return toApiPersonProfile(
						await membersService.profile(ctx, input.userId),
					);
				},
			}),
		},
	},
});
