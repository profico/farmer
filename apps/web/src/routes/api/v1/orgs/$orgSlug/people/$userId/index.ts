import {
	type ApiDeleted,
	type ApiPersonProfile,
	toApiPersonProfile,
} from "@farmer/core/api";
import { memberUserIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

const byUser = z.object({ userId: memberUserIdInput });

/**
 * `/api/v1/orgs/$orgSlug/people/$userId` — one person. Admins only.
 *
 * The read answers their row, the history of their type and their team lead
 * list. The removal ends the membership through better-auth, so its own
 * check and its audit hook run, and then takes the person off every team
 * lead list. Archive a person who has left instead: a removal is for an
 * invitation to a wrong address. Nobody removes themselves or the only
 * owner, and an API token cannot remove anybody (see `memberAdmin`).
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/people/$userId/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: byUser,
				raw: ({ params }: ApiRequest<PersonParams>) => ({
					userId: params.userId,
				}),
				run: async (ctx, { userId }): Promise<ApiPersonProfile> => {
					const { membersService } = await import("@farmer/core/services");
					return toApiPersonProfile(await membersService.profile(ctx, userId));
				},
			}),
			DELETE: apiRoute({
				input: byUser,
				raw: ({ params }: ApiRequest<PersonParams>) => ({
					userId: params.userId,
				}),
				run: async (ctx, { userId }, caller): Promise<ApiDeleted> => {
					const { memberAdmin } = await import("@farmer/core/auth");
					await memberAdmin.remove(ctx, caller.sessionHeaders, userId);
					return { id: userId };
				},
			}),
		},
	},
});
