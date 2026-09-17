import { and, eq } from "drizzle-orm";
import webpush from "web-push";

import { db } from "../db";
import {
	notificationSettings,
	pushSubscription,
} from "../db/schema/notifications";
import type {
	SavePushSubscriptionInput,
	UpdateNotificationSettingsInput,
} from "../schema/notifications";
import type { Ctx } from "./types";

export type NotificationSettings = {
	logReminders: boolean;
};

const DEFAULTS: NotificationSettings = {
	logReminders: true,
};

// The payload the service worker's `push` handler expects (see
// apps/web/public/sw.js). `url` is an app-relative deep link opened on click.
export type PushPayload = {
	title: string;
	body: string;
	url?: string;
	tag?: string;
};

// Configure web-push once from env. Missing keys is not fatal — the app runs
// fine without push (sendPush becomes a no-op) so a dev without VAPID keys
// isn't blocked. Guarded so we only call setVapidDetails when fully configured.
let vapidReady = false;

const configureVapid = (): boolean => {
	if (vapidReady) return true;
	const publicKey = process.env.VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

	if (!publicKey || !privateKey) return false;
	webpush.setVapidDetails(subject, publicKey, privateKey);
	vapidReady = true;

	return true;
};

const settingsFor = async (
	organizationId: string,
	userId: string,
): Promise<NotificationSettings> => {
	const row = await db.query.notificationSettings.findFirst({
		where: and(
			eq(notificationSettings.organizationId, organizationId),
			eq(notificationSettings.userId, userId),
		),
	});

	if (!row) return { ...DEFAULTS };

	return {
		logReminders: row.logReminders,
	};
};

export const notificationsService = {
	// Store a device's push subscription. Keyed on the unique endpoint, so
	// re-subscribing the same device (e.g. after the browser rotated its
	// endpoint) upserts rather than duplicating. Re-binds the endpoint to the
	// current user in case a shared device changed hands.
	saveSubscription: async (
		ctx: Ctx,
		input: SavePushSubscriptionInput,
	): Promise<void> => {
		await db
			.insert(pushSubscription)
			.values({
				userId: ctx.userId,
				endpoint: input.endpoint,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
				userAgent: input.userAgent ?? null,
			})
			.onConflictDoUpdate({
				target: pushSubscription.endpoint,
				set: {
					userId: ctx.userId,
					p256dh: input.keys.p256dh,
					auth: input.keys.auth,
					userAgent: input.userAgent ?? null,
				},
			});
	},

	removeSubscription: async (ctx: Ctx, endpoint: string): Promise<void> => {
		await db
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.endpoint, endpoint),
					eq(pushSubscription.userId, ctx.userId),
				),
			);
	},

	getSettings: (ctx: Ctx): Promise<NotificationSettings> =>
		settingsFor(ctx.organizationId, ctx.userId),

	// Also exposed for callers that only have (org, user) and no ctx, e.g. the
	// background reminder job iterating members.
	settingsFor,

	update: async (
		ctx: Ctx,
		input: UpdateNotificationSettingsInput,
	): Promise<NotificationSettings> => {
		const [row] = await db
			.insert(notificationSettings)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				logReminders: input.logReminders ?? undefined,
			})
			.onConflictDoUpdate({
				target: [
					notificationSettings.organizationId,
					notificationSettings.userId,
				],
				set: {
					logReminders: input.logReminders,
					updatedAt: new Date(),
				},
			})
			.returning();

		if (!row) throw new Error("Failed to save notification settings");

		return {
			logReminders: row.logReminders,
		};
	},

	// The org-day-key (yyyy-MM-dd) we last sent this user a "forgot to log"
	// reminder for. Read by the reminder job to stay idempotent across ticks and
	// restarts — a missing row means "never reminded".
	lastLogReminderDay: async (
		organizationId: string,
		userId: string,
	): Promise<string | null> => {
		const row = await db.query.notificationSettings.findFirst({
			where: and(
				eq(notificationSettings.organizationId, organizationId),
				eq(notificationSettings.userId, userId),
			),
		});

		return row?.lastLogReminderDay ?? null;
	},

	// Stamp the day we just reminded this user, so no later tick re-sends for the
	// same day. Upserts because the member may have no settings row yet (the
	// toggles fall back to their column defaults, which are the intended ON).
	markLogReminded: async (
		organizationId: string,
		userId: string,
		dayKey: string,
	): Promise<void> => {
		await db
			.insert(notificationSettings)
			.values({ organizationId, userId, lastLogReminderDay: dayKey })
			.onConflictDoUpdate({
				target: [
					notificationSettings.organizationId,
					notificationSettings.userId,
				],
				set: { lastLogReminderDay: dayKey, updatedAt: new Date() },
			});
	},

	// The push TRANSPORT: send to every device this user has registered. Push
	// subscriptions belong to a device and therefore to a person, not to an
	// organization, which is exactly why nothing here can decide whether the
	// person should be hearing from a given org — go through `notify()`, which
	// owns that question for every channel.
	//
	// Best-effort by construction: never throws into the caller (a decision or
	// reminder must not fail because a push endpoint is dead), and prunes
	// subscriptions the push service reports as gone (404/410) so dead devices
	// don't accumulate.
	sendPush: async (userId: string, payload: PushPayload): Promise<void> => {
		if (!configureVapid()) return;
		let subs: (typeof pushSubscription.$inferSelect)[];

		try {
			subs = await db.query.pushSubscription.findMany({
				where: eq(pushSubscription.userId, userId),
			});
		} catch (error) {
			console.error("[notifications] failed to load subscriptions", {
				userId,
				error,
			});

			return;
		}

		const body = JSON.stringify(payload);
		await Promise.all(
			subs.map(async (sub) => {
				try {
					await webpush.sendNotification(
						{
							endpoint: sub.endpoint,
							keys: { p256dh: sub.p256dh, auth: sub.auth },
						},
						body,
					);
				} catch (error) {
					// SAFETY: `web-push` rejects with a `WebPushError` carrying the upstream status
					// code. The field is read as optional and compared to two literals, so an error
					// from anywhere else simply fails both checks and is logged rather than acted on.
					const status = (error as { statusCode?: number }).statusCode;

					if (status === 404 || status === 410) {
						// Subscription expired/unsubscribed — drop it.
						await db
							.delete(pushSubscription)
							.where(eq(pushSubscription.endpoint, sub.endpoint))
							.catch(() => {});

						return;
					}

					console.error("[notifications] push send failed", {
						userId,
						endpoint: sub.endpoint,
						status,
						error,
					});
				}
			}),
		);
	},
};
