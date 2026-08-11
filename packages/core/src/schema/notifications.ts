import { z } from "zod";

// A browser PushSubscription serialized for transport. The shape mirrors what
// `PushSubscription.toJSON()` produces in the browser, narrowed to the fields
// the server stores.
export const savePushSubscriptionInput = z.object({
	endpoint: z.url(),
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
