import { type ApiPerson, toApiPerson } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/people` — Settings → People: every person with
 * their role, type, start date and state. Admins only, which
 * `membersService.people` checks. Read from the tables, never through
 * better-auth's `listMembers`, which fails in an organization of more than
 * 100 people.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/people/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiPerson[]> => {
					const { membersService } = await import("@farmer/core/services");
					const rows = await membersService.people(ctx);
					return rows.map(toApiPerson);
				},
			}),
		},
	},
});
