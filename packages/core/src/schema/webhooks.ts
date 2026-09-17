import { z } from "zod";

import { MAX_WEBHOOK_URL_LENGTH, WEBHOOK_EVENT_KINDS } from "../api/webhooks";

// The inputs the webhook settings page sends.
//
// What is deliberately NOT checked here: whether the URL is https, and where
// its host resolves to. Both are decided by `lib/webhook-url.ts` inside
// `webhooks.service.ts`, because both depend on
// `WEBHOOK_ALLOW_PRIVATE_HOSTS` — an operator's switch this module cannot see
// and must not have a second opinion about. A Zod schema that refused `http://`
// would refuse it on the self-hosted deployment that has deliberately allowed
// it. So the rules that need the environment live in one place, and this file
// checks only what is true of a webhook URL everywhere.

/** How many endpoints one organization may register. Stripe allows 16 per
 *  account; a time tracker sends to a payroll system, a dashboard and a chat
 *  bot, and an org that wants a fourth can say so. */
export const MAX_WEBHOOK_ENDPOINTS = 5;

export const webhookEventKind = z.enum(WEBHOOK_EVENT_KINDS);
export type WebhookEventKindInput = z.infer<typeof webhookEventKind>;

/** `new URL` in a try, not `URL.parse`: this module is bundled into the browser
 *  and `URL.parse` is younger than the browsers people still open Farmer in. */
const parseUrl = (value: string): URL | null => {
	try {
		return new URL(value);
	} catch {
		return null;
	}
};

const webhookUrl = z
	.string()
	.trim()
	.min(1, "Enter a URL")
	.max(MAX_WEBHOOK_URL_LENGTH)
	.refine((value) => parseUrl(value) !== null, "That is not a valid URL")
	.refine((value) => {
		const parsed = parseUrl(value);
		return parsed !== null && parsed.username === "" && parsed.password === "";
	}, "Remove the username and password from the URL");

const enabledEvents = z
	.array(webhookEventKind)
	.min(1, "Pick at least one event")
	.refine((kinds) => new Set(kinds).size === kinds.length, "Pick each once");

export const createWebhookEndpointInput = z.object({
	url: webhookUrl,
	description: z.string().trim().max(200).optional(),
	enabledEvents,
});
export type CreateWebhookEndpointInput = z.infer<
	typeof createWebhookEndpointInput
>;

export const updateWebhookEndpointInput = z.object({
	endpointId: z.uuid(),
	url: webhookUrl.optional(),
	/** An empty string clears it, which is why this is not `.min(1)`. */
	description: z.string().trim().max(200).optional(),
	enabledEvents: enabledEvents.optional(),
	/** An admin switching the endpoint off and on again. The job also sets this,
	 *  after it gives up — see `WEBHOOK_GIVE_UP_DAYS`. */
	disabled: z.boolean().optional(),
});
export type UpdateWebhookEndpointInput = z.infer<
	typeof updateWebhookEndpointInput
>;

export const webhookEndpointIdInput = z.uuid();
export type WebhookEndpointIdInput = z.infer<typeof webhookEndpointIdInput>;

export const listWebhookDeliveriesInput = z.object({
	endpointId: z.uuid(),
	/** The log page shows a window, not a history — the retention sweep deletes
	 *  anything older than a fortnight anyway. */
	limit: z.number().int().min(1).max(200).default(50),
});
export type ListWebhookDeliveriesInput = z.infer<
	typeof listWebhookDeliveriesInput
>;

export const resendWebhookDeliveryInput = z.object({
	/** The attempt the person clicked Resend on. The event behind it is what is
	 *  actually re-sent, to the endpoint that attempt belonged to. */
	deliveryId: z.uuid(),
});
export type ResendWebhookDeliveryInput = z.infer<
	typeof resendWebhookDeliveryInput
>;
