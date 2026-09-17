import { queryOptions } from "@tanstack/react-query";

import {
	getWebhookEndpoint,
	listWebhookDeliveries,
	listWebhookEndpoints,
} from "#/server/webhooks.ts";

import { queryKeys } from "./keys.ts";

export const webhookEndpointsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).webhooks, "endpoints"],
		queryFn: () => listWebhookEndpoints(),
	});

export const webhookEndpointQuery = (org: string, endpointId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).webhooks, "endpoint", endpointId],
		queryFn: () => getWebhookEndpoint({ data: endpointId }),
	});

/** The delivery log. Refetched on an interval while the page is open, because
 *  the job that fills it ticks every minute and the page's whole job is to
 *  show what happened to a delivery somebody just triggered. */
export const webhookDeliveriesQuery = (org: string, endpointId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).webhooks, "deliveries", endpointId],
		queryFn: () => listWebhookDeliveries({ data: { endpointId, limit: 50 } }),
		refetchInterval: 10_000,
	});
