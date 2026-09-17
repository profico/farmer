import {
	removePushSubscriptionInput,
	savePushSubscriptionInput,
	updateNotificationSettingsInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// The VAPID public key is designed to be public (it's the application server
// key the browser subscribes with). Exposed to the client so push.ts can pass
// it to pushManager.subscribe. Returns null when push isn't configured, so the
// UI can hide the "enable notifications" control gracefully.
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(
	async () => {
		return { key: process.env.VAPID_PUBLIC_KEY ?? null };
	},
);

// POST so the response is never cacheable — private per-user state.
export const getNotificationSettings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { notificationsService } = await import("@farmer/core/services");

		return notificationsService.getSettings(context.ctx);
	});

export const updateNotificationSettings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateNotificationSettingsInput)
	.handler(async ({ data, context }) => {
		const { notificationsService } = await import("@farmer/core/services");

		return notificationsService.update(context.ctx, data);
	});

export const savePushSubscription = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(savePushSubscriptionInput)
	.handler(async ({ data, context }) => {
		const { notificationsService } = await import("@farmer/core/services");
		await notificationsService.saveSubscription(context.ctx, data);

		return { ok: true };
	});

export const removePushSubscription = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(removePushSubscriptionInput)
	.handler(async ({ data, context }) => {
		const { notificationsService } = await import("@farmer/core/services");
		await notificationsService.removeSubscription(context.ctx, data.endpoint);

		return { ok: true };
	});
