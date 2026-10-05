import { type ApiPersonRef, toApiPersonRef } from "@farmer/core/api";
import {
	setTeamLeadPeopleInput,
	teamLeadUserIdInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { type ApiRequest, apiRoute, bodyWithPath } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

const byLead = z.object({ leadUserId: teamLeadUserIdInput });

/**
 * `/api/v1/orgs/$orgSlug/people/$userId/team` — the people on a team lead's
 * list.
 *
 * The lead reads their own list, and an admin reads anybody's; a colleague's
 * list is a 403 (`teamLeadsService.listPeople`). Only an admin changes a
 * list, because the list is what lets the lead see their people's time. The
 * change replaces the whole list. Archived people are refused, and the lead
 * is never on their own list.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/team",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byLead,
				raw: ({ params }: ApiRequest<PersonParams>) => ({
					leadUserId: params.userId,
				}),
				run: async (ctx, { leadUserId }): Promise<ApiPersonRef[]> => {
					const { teamLeadsService } = await import("@farmer/core/services");
					const rows = await teamLeadsService.listPeople(ctx, leadUserId);
					return rows.map(toApiPersonRef);
				},
			}),
			POST: apiRoute({
				input: setTeamLeadPeopleInput,
				raw: ({ params, body }: ApiRequest<PersonParams>) =>
					bodyWithPath(body, { leadUserId: params.userId }),
				run: async (ctx, input): Promise<ApiPersonRef[]> => {
					const { teamLeadsService } = await import("@farmer/core/services");
					await teamLeadsService.setPeople(ctx, input);
					const rows = await teamLeadsService.listPeople(ctx, input.leadUserId);
					return rows.map(toApiPersonRef);
				},
			}),
		},
	},
});
