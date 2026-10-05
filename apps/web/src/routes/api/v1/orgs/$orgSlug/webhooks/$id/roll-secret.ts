import type { ApiWebhookSecret } from "@farmer/core/api";
import { webhookEndpointIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/webhooks/$id/roll-secret` — a new signing
 * secret. The old one still signs for 24 hours. The answer is the one time
 * the new secret is readable. Admin only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/webhooks/$id/roll-secret",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: z.object({ endpointId: webhookEndpointIdInput }),
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					endpointId: params.id,
				}),
				run: async (ctx, { endpointId }): Promise<ApiWebhookSecret> => {
					const { webhooksService } = await import("@farmer/core/services");
					return webhooksService.rollSecret(ctx, endpointId);
				},
			}),
		},
	},
});
