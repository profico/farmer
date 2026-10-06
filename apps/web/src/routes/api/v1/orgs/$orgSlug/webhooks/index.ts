import {
	type ApiWebhookEndpoint,
	type ApiWebhookEndpointCreated,
	toApiWebhookEndpoint,
} from "@farmer/core/api";
import { createWebhookEndpointInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";
import { withUrlRefusalReason } from "#/server/webhook-url-refusal.ts";

/**
 * `GET` and `POST /api/v1/orgs/$orgSlug/webhooks` — the outbound webhook
 * endpoints. Admin only, every route: an endpoint receives every member's time
 * entries with their notes.
 *
 * The POST answers the signing secret once, as the web app shows it once. No
 * other route returns it; the endpoint carries its last four characters.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/webhooks/")({
	server: {
		handlers: {
			GET: apiRoute({
				signInOnly: true,
				input: NO_INPUT,
				run: async (ctx): Promise<ApiWebhookEndpoint[]> => {
					const { webhooksService } = await import("@farmer/core/services");
					const endpoints = await webhooksService.list(ctx);
					return endpoints.map(toApiWebhookEndpoint);
				},
			}),
			POST: apiRoute({
				signInOnly: true,
				input: createWebhookEndpointInput,
				run: async (ctx, input): Promise<ApiWebhookEndpointCreated> => {
					const { webhooksService } = await import("@farmer/core/services");
					const created = await withUrlRefusalReason(() =>
						webhooksService.create(ctx, input),
					);
					return {
						endpoint: toApiWebhookEndpoint(created.endpoint),
						secret: created.secret,
					};
				},
			}),
		},
	},
});
