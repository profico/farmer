import {
	createWebhookEndpointInput,
	listWebhookDeliveriesInput,
	resendWebhookDeliveryInput,
	updateWebhookEndpointInput,
	webhookEndpointIdInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// Every function here is admin-only, at the middleware AND in the service. An
// endpoint receives every member's time entries with their notes, so the tier
// is deliberate rather than inherited — see `webhooks.service.ts`.

export const listWebhookEndpoints = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.list(context.ctx);
	});

export const getWebhookEndpoint = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(webhookEndpointIdInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.get(context.ctx, data);
	});

/** The one call that ever answers with a secret. The page shows it once. */
export const createWebhookEndpoint = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(createWebhookEndpointInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.create(context.ctx, data);
	});

export const updateWebhookEndpoint = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateWebhookEndpointInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.update(context.ctx, data);
	});

export const deleteWebhookEndpoint = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(webhookEndpointIdInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		await webhooksService.remove(context.ctx, data);
	});

export const rollWebhookSecret = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(webhookEndpointIdInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.rollSecret(context.ctx, data);
	});

export const sendWebhookTestEvent = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(webhookEndpointIdInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.sendTest(context.ctx, data);
	});

export const listWebhookDeliveries = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(listWebhookDeliveriesInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.deliveries(context.ctx, data);
	});

export const resendWebhookDelivery = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(resendWebhookDeliveryInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.resend(context.ctx, data);
	});

export const getWebhookEventPayload = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(webhookEndpointIdInput)
	.handler(async ({ data, context }) => {
		const { webhooksService } = await import("@farmer/core/services");
		return webhooksService.eventPayload(context.ctx, data);
	});
