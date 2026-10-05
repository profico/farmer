import { type ApiPerson, toApiPerson } from "@farmer/core/api";
import { setMemberRoleInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { type ApiRequest, apiRoute, bodyWithPath } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

/**
 * `POST /api/v1/orgs/$orgSlug/people/$userId/role` — makes a person an admin
 * or a member. Admins only. The change goes through better-auth, so its own
 * check and its audit hook run. Nobody changes their own role or the owner's,
 * as on the People page, and an API token cannot do it (see `memberAdmin`).
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/role",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: setMemberRoleInput,
				raw: ({ params, body }: ApiRequest<PersonParams>) =>
					bodyWithPath(body, { userId: params.userId }),
				run: async (ctx, input, caller): Promise<ApiPerson> => {
					const headers = await caller.sessionHeaders();
					const { memberAdmin } = await import("@farmer/core/auth");
					await memberAdmin.setRole(ctx, headers, input);
					const { membersService } = await import("@farmer/core/services");
					const { person } = await membersService.profile(ctx, input.userId);
					return toApiPerson(person);
				},
			}),
		},
	},
});
