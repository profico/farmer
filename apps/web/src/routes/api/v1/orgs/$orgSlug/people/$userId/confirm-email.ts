import type { ApiArchiveResult } from "@farmer/core/api";
import { memberUserIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type PersonParams = { orgSlug: string; userId: string };

const byUser = z.object({ userId: memberUserIdInput });

/**
 * `POST /api/v1/orgs/$orgSlug/people/$userId/confirm-email` — confirms the
 * address of an active person whom an import made and who never signed in.
 * Refused for a person who signed in, or who is in another organization too.
 * Admins only, which `membersService.confirmEmail` checks.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/people/$userId/confirm-email",
)({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: byUser,
				raw: ({ params }: ApiRequest<PersonParams>) => ({
					userId: params.userId,
				}),
				run: async (ctx, { userId }): Promise<ApiArchiveResult> => {
					const { membersService } = await import("@farmer/core/services");
					const result = await membersService.confirmEmail(ctx, userId);
					return { emailConfirmed: result.emailConfirmed };
				},
			}),
		},
	},
});
