import type { ApiWebhookTest } from "@farmer/core/api";
import { webhookEndpointIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/webhooks/$id/test` — queues a `webhook.test`
 * event for this endpoint only. Admin only.
 *
 * Nothing on this request calls the endpoint's URL: the event goes into the
 * outbox, as every event does, and the delivery job sends it. Read the
 * delivery log for the result.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/webhooks/$id/test")(
	{
		server: {
			handlers: {
				POST: apiRoute({
					signInOnly: true,
					input: z.object({ endpointId: webhookEndpointIdInput }),
					raw: ({ params }: ApiRequest<OrgRowParams>) => ({
						endpointId: params.id,
					}),
					run: async (ctx, { endpointId }): Promise<ApiWebhookTest> => {
						const { webhooksService } = await import("@farmer/core/services");
						return webhooksService.sendTest(ctx, endpointId);
					},
				}),
			},
		},
	},
);
