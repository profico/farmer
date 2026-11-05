import type { PushBody } from "../schemas";
import type { Device } from "../store";

/** What happened to one push. `app.ts` turns each one into a status code. */
export type DeliveryResult =
	/** APNs or FCM took the push. */
	| { outcome: "delivered" }
	/** No credentials for the platform: the relay logged the push only. */
	| { outcome: "dry_run" }
	/** APNs or FCM says the device's push token is dead. The relay forgets the
	 *  device, and the server forgets its relay id. */
	| { outcome: "device_gone" }
	/** APNs says the per-activity token is dead: the Live Activity ended. The
	 *  device is still good. */
	| { outcome: "activity_gone" }
	/** APNs says the push-to-start token is dead. The relay clears it, and
	 *  the app sends a new one when it has one. */
	| { outcome: "start_token_gone" }
	/** A push-to-start for a device that gave no push-to-start token. */
	| { outcome: "no_start_token" }
	/** The built payload is over the platform's limit. */
	| { outcome: "too_large" }
	/** Any other answer. `reason` is the APNs reason or the FCM status, which
	 *  hold no secret. */
	| { outcome: "failed"; status: number; reason: string };

/** Send one push to one device. */
export type Sender = (
	device: Device,
	push: PushBody,
) => Promise<DeliveryResult>;

export type Senders = { ios: Sender; android: Sender };

/** Write one log line. Never pass a token, a secret or a ciphertext. */
export type Log = (line: string) => void;
