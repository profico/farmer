import { z } from "zod";

import {
	isAllowedPushEndpoint,
	PUSH_ENDPOINT_MESSAGE,
} from "../lib/push-endpoint";

// A browser PushSubscription serialized for transport. The shape mirrors what
// `PushSubscription.toJSON()` produces in the browser, narrowed to the fields
// the server stores. The endpoint is a URL the server will POST to, so it is
// held to the browser push services — see `lib/push-endpoint.ts`.
export const savePushSubscriptionInput = z.object({
	endpoint: z.url().refine(isAllowedPushEndpoint, PUSH_ENDPOINT_MESSAGE),
	keys: z.object({
		p256dh: z.string().min(1),
		auth: z.string().min(1),
	}),
	userAgent: z.string().optional(),
});
export type SavePushSubscriptionInput = z.infer<
	typeof savePushSubscriptionInput
>;

export const removePushSubscriptionInput = z.object({
	endpoint: z.url(),
});
export type RemovePushSubscriptionInput = z.infer<
	typeof removePushSubscriptionInput
>;

// Partial patch, same convention as integration settings: only the toggles
// present in the payload change.
export const updateNotificationSettingsInput = z.object({
	logReminders: z.boolean().optional(),
});
export type UpdateNotificationSettingsInput = z.infer<
	typeof updateNotificationSettingsInput
>;
