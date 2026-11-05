import type { ApiWebhookResend } from "@farmer/core/api";
import { resendWebhookDeliveryInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/webhooks/deliveries/$id/resend` — queues one
 * more attempt at the event behind a logged delivery. Admin only.
 *
 * Like the test event, it goes through the outbox: the new attempt is a row
 * the delivery job sends, never a call made on this request.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/webhooks/deliveries/$id/resend",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: resendWebhookDeliveryInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					deliveryId: params.id,
				}),
				run: async (ctx, input): Promise<ApiWebhookResend> => {
					const { webhooksService } = await import("@farmer/core/services");
					return webhooksService.resend(ctx, input);
				},
			}),
		},
	},
});
