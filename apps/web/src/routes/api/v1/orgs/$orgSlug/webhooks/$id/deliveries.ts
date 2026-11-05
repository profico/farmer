import {
	type ApiWebhookDelivery,
	toApiWebhookDelivery,
} from "@farmer/core/api";
import type { JsonValue } from "@farmer/core/lib/json";
import { listWebhookDeliveriesInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/webhooks/$id/deliveries?limit` — the delivery
 * log of one endpoint, newest first. `limit` is 1 to 200, 50 when it is not
 * sent. Admin only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/webhooks/$id/deliveries",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: listWebhookDeliveriesInput,
				// A query string carries text; the schema wants a number.
				raw: ({ params, query }: ApiRequest<OrgRowParams>): JsonValue => {
					const limit = query.get("limit");
					return limit === null
						? { endpointId: params.id }
						: { endpointId: params.id, limit: Number(limit) };
				},
				run: async (ctx, input): Promise<ApiWebhookDelivery[]> => {
					const { webhooksService } = await import("@farmer/core/services");
					const rows = await webhooksService.deliveries(ctx, input);
					return rows.map(toApiWebhookDelivery);
				},
			}),
		},
	},
});
