// Client-side Web Push helpers: feature detection, permission + subscription
// lifecycle, and (un)registering the device with the server. All browser-only —
// callers must guard on `pushSupported()` (which is false during SSR).

import {
	getVapidPublicKey,
	removePushSubscription,
	savePushSubscription,
} from "#/server/notifications.ts";

const SW_URL = "/sw.js";

export function pushSupported(): boolean {
	return (
		// Not a narrowing: `window` may not be declared at all under SSR, and
		// `typeof` is the only operator that can ask that without throwing.
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- see above
		typeof window !== "undefined" &&
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

export function currentPermission(): NotificationPermission | "unsupported" {
	if (!pushSupported()) return "unsupported";
	return Notification.permission;
}

// VAPID public keys are base64url; PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(base64);
	// Back with an explicit ArrayBuffer (not the ambient ArrayBufferLike) so the
	// result satisfies BufferSource for pushManager.subscribe under lib.dom.
	const buffer = new ArrayBuffer(raw.length);
	const output = new Uint8Array(buffer);
	for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
	return output;
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
	const existing = await navigator.serviceWorker.getRegistration(SW_URL);
	if (existing) return existing;
	return navigator.serviceWorker.register(SW_URL, { scope: "/" });
}

// Full enable flow: register SW → request OS permission → subscribe → persist
// on the server. Returns the outcome so the UI can message accurately. Throws
// only on unexpected failures; a denied permission resolves to "denied".
export async function enablePush(): Promise<
	"subscribed" | "denied" | "unsupported" | "unconfigured"
> {
	if (!pushSupported()) return "unsupported";

	const { key } = await getVapidPublicKey();
	if (!key) return "unconfigured";

	const permission = await Notification.requestPermission();
	if (permission !== "granted") return "denied";

	const registration = await ensureRegistration();
	await navigator.serviceWorker.ready;

	let subscription = await registration.pushManager.getSubscription();
	if (!subscription) {
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(key),
		});
	}

	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
		throw new Error("Push subscription is missing required keys");
	}
	await savePushSubscription({
		data: {
			endpoint: json.endpoint,
			keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
			userAgent: navigator.userAgent,
		},
	});
	return "subscribed";
}

// Whether this specific device currently holds a push subscription.
export async function isSubscribed(): Promise<boolean> {
	if (!pushSupported() || Notification.permission !== "granted") return false;
	const registration = await navigator.serviceWorker.getRegistration(SW_URL);
	if (!registration) return false;
	const subscription = await registration.pushManager.getSubscription();
	return !!subscription;
}

// Unsubscribe this device and drop the server-side row.
export async function disablePush(): Promise<void> {
	if (!pushSupported()) return;
	const registration = await navigator.serviceWorker.getRegistration(SW_URL);
	if (!registration) return;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return;
	const endpoint = subscription.endpoint;
	await subscription.unsubscribe().catch(() => {});
	await removePushSubscription({ data: { endpoint } }).catch(() => {});
}
