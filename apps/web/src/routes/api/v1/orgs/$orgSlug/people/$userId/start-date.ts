import { type ApiPersonProfile, toApiPersonProfile } from "@farmer/core/api";
import { setMemberStartDateInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { type ApiRequest, apiRoute, bodyWithPath } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

/**
 * `POST /api/v1/orgs/$orgSlug/people/$userId/start-date` — sets the start
 * date, or clears it with `null`. Admins only, which
 * `membersService.setStartDate` checks. Answers the person.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/start-date",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: setMemberStartDateInput,
				raw: ({ params, body }: ApiRequest<PersonParams>) =>
					bodyWithPath(body, { userId: params.userId }),
				run: async (ctx, input): Promise<ApiPersonProfile> => {
					const { membersService } = await import("@farmer/core/services");
					await membersService.setStartDate(ctx, input.userId, input.startDate);
					return toApiPersonProfile(
						await membersService.profile(ctx, input.userId),
					);
				},
			}),
		},
	},
});
