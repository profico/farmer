import {
	type ApiDeleted,
	type ApiWebhookEndpoint,
	toApiWebhookEndpoint,
} from "@farmer/core/api";
import {
	updateWebhookEndpointInput,
	webhookEndpointIdInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";
import { withUrlRefusalReason } from "#/server/webhook-url-refusal.ts";

const byId = z.object({ endpointId: webhookEndpointIdInput });

const fromPath = ({ params }: ApiRequest<OrgRowParams>) => ({
	endpointId: params.id,
});

/** A PATCH body, before the id from the path is added. Only its shape is
 *  checked here; `updateWebhookEndpointInput` checks the rest. */
const patchBody = z.record(z.string(), z.json());

/**
 * `GET`, `PATCH` and `DELETE /api/v1/orgs/$orgSlug/webhooks/$id` — one
 * endpoint. Admin only. A PATCH changes the fields it sends; `disabled`
 * switches the endpoint off and on. The service checks a new URL against the
 * address rules before it saves it.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/webhooks/$id/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: fromPath,
				run: async (ctx, { endpointId }): Promise<ApiWebhookEndpoint> => {
					const { webhooksService } = await import("@farmer/core/services");
					return toApiWebhookEndpoint(
						await webhooksService.get(ctx, endpointId),
					);
				},
			}),
			PATCH: apiRoute({
				input: updateWebhookEndpointInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) => {
					const patch = patchBody.safeParse(body);
					if (!patch.success) {
						throw new Error("The request body must be a JSON object.");
					}
					// Last, so a body cannot point the patch at another endpoint.
					return { ...patch.data, endpointId: params.id };
				},
				run: async (ctx, input): Promise<ApiWebhookEndpoint> => {
					const { webhooksService } = await import("@farmer/core/services");
					return toApiWebhookEndpoint(
						await withUrlRefusalReason(() =>
							webhooksService.update(ctx, input),
						),
					);
				},
			}),
			// `remove` is silent about an id it did not find, so the endpoint is
			// read first: a missing one, or another organization's, is a 404.
			DELETE: apiRoute({
				input: byId,
				raw: fromPath,
				run: async (ctx, { endpointId }): Promise<ApiDeleted> => {
					const { webhooksService } = await import("@farmer/core/services");
					await webhooksService.get(ctx, endpointId);
					await webhooksService.remove(ctx, endpointId);
					return { id: endpointId };
				},
			}),
		},
	},
});
