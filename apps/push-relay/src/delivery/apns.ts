import { z } from "zod";

import { isApnsToken, type PushBody } from "../schemas";
import type { Device } from "../store";
import type { Http2Transport } from "./http2";
import { importSigningKey, signJwt } from "./jwt";
import type { DeliveryResult, Sender } from "./types";

export type ApnsConfig = {
	/** The `.p8` key from the Apple developer account, PEM (PKCS #8). */
	keyP8: string;
	keyId: string;
	teamId: string;
	/** The app's bundle id, for example `com.profico.farmer`. */
	topic: string;
};

const ORIGINS = {
	production: "https://api.push.apple.com",
	sandbox: "https://api.sandbox.push.apple.com",
} as const;

/** APNs refuses a payload over 4 KB (5 KB only for VoIP). */
export const APNS_MAX_PAYLOAD_BYTES = 4_096;

/** Apple accepts a provider token for one hour and refuses a new one more
 *  often than every 20 minutes (`TooManyProviderTokenUpdates`). 50 minutes
 *  sits between the two. */
const TOKEN_LIFETIME_MS = 50 * 60_000;

/** The text that a device shows if its Notification Service Extension cannot
 *  open the payload. The extension replaces it with the decrypted text. */
const PLACEHOLDER_ALERT = { title: "Farmer", body: "New notification" };

/** The alert that APNs requires on a push-to-start. It holds no content. */
const START_ALERT = { title: "Farmer", body: "Timer running" };

const apnsErrorBody = z.object({ reason: z.string() });

/** The provider token, shared by every push of this process. */
export class ApnsTokenCache {
	readonly #key: Promise<CryptoKey>;
	readonly #config: ApnsConfig;
	readonly #now: () => number;
	#current: { jwt: string; issuedAt: number } | null = null;
	#pending: Promise<string> | null = null;

	constructor(config: ApnsConfig, now: () => number) {
		this.#config = config;
		this.#now = now;
		this.#key = importSigningKey(config.keyP8, "ES256");
	}

	/** Throws when the key does not import. `main.ts` calls this at start. */
	async verifyKey(): Promise<void> {
		await this.#key;
	}

	async get(forceRefresh = false): Promise<string> {
		const now = this.#now();
		if (
			!forceRefresh &&
			this.#current &&
			now - this.#current.issuedAt < TOKEN_LIFETIME_MS
		) {
			return this.#current.jwt;
		}
		// Many pushes can find the token old at the same moment. They share one
		// signature, because APNs refuses a burst of new provider tokens.
		this.#pending ??= this.#sign(now).finally(() => {
			this.#pending = null;
		});
		return this.#pending;
	}

	async #sign(now: number): Promise<string> {
		const jwt = await signJwt(
			await this.#key,
			"ES256",
			{ kid: this.#config.keyId },
			{ iss: this.#config.teamId, iat: Math.floor(now / 1000) },
		);
		this.#current = { jwt, issuedAt: now };
		return jwt;
	}
}

/** The APNs JSON payload's `aps` dictionary, for every kind the relay sends. */
type Aps = {
	alert?: { title: string; body: string };
	"mutable-content"?: 1;
	"content-available"?: 1;
	timestamp?: number;
	event?: "start" | "update" | "end";
	"content-state"?: Record<string, string | number | boolean | null>;
	"stale-date"?: number;
	"dismissal-date"?: number;
	"attributes-type"?: string;
	attributes?: Record<string, string | number | boolean | null>;
};

export type ApnsRequest = {
	token: string;
	headers: Record<string, string>;
	payload: string;
};

/**
 * Build the APNs request for one push, or say why there is none. Exported for
 * the tests, which check the headers and the payload without a network.
 */
export const buildApnsRequest = (
	device: Device,
	push: PushBody,
	topic: string,
	now: number,
): ApnsRequest | { outcome: "no_start_token" | "too_large" } => {
	const aps: Aps = {};
	const headers: Record<string, string> = {};
	let token = device.pushToken;

	if (push.kind === "alert") {
		aps.alert = PLACEHOLDER_ALERT;
		aps["mutable-content"] = 1;
		headers["apns-push-type"] = "alert";
		headers["apns-priority"] = "10";
		headers["apns-topic"] = topic;
	} else if (push.kind === "data") {
		// A background push: no alert, sound or badge, and priority 5, or APNs
		// refuses it.
		aps["content-available"] = 1;
		headers["apns-push-type"] = "background";
		headers["apns-priority"] = "5";
		headers["apns-topic"] = topic;
	} else {
		const activity = push.liveActivity;
		// `pushBody` refuses a liveactivity push without `liveActivity`.
		if (!activity) throw new Error("A liveactivity push has no liveActivity.");
		const target = activity.token ?? device.liveActivityStartToken;
		if (!target) return { outcome: "no_start_token" };
		token = target;
		aps.timestamp = Math.floor(now / 1000);
		aps.event = activity.event;
		aps["content-state"] = activity.contentState;
		if (activity.staleDate !== undefined) {
			aps["stale-date"] = activity.staleDate;
		}
		if (activity.dismissalDate !== undefined) {
			aps["dismissal-date"] = activity.dismissalDate;
		}
		if (activity.event === "start") {
			if (activity.attributesType !== undefined) {
				aps["attributes-type"] = activity.attributesType;
			}
			if (activity.attributes !== undefined) {
				aps.attributes = activity.attributes;
			}
			aps.alert = START_ALERT;
		}
		headers["apns-push-type"] = "liveactivity";
		// An update at priority 10 spends the budget that Apple gives each app
		// for Live Activity updates. A start and an end must show at once.
		headers["apns-priority"] = activity.event === "update" ? "5" : "10";
		headers["apns-topic"] = `${topic}.push-type.liveactivity`;
	}

	const payload = JSON.stringify({ aps, e: push.ciphertext });
	if (Buffer.byteLength(payload) > APNS_MAX_PAYLOAD_BYTES) {
		return { outcome: "too_large" };
	}
	return { token, headers, payload };
};

/** What an APNs refusal means for this push. A dead token is a dead device
 *  only when the token was the device token: a per-activity token dies when
 *  its activity ends, and a push-to-start token is one column. */
const deadTokenOutcome = (push: PushBody): DeliveryResult => {
	if (!push.liveActivity) return { outcome: "device_gone" };
	return push.liveActivity.token
		? { outcome: "activity_gone" }
		: { outcome: "start_token_gone" };
};

const reasonOf = (body: string): string => {
	try {
		const parsed = apnsErrorBody.safeParse(JSON.parse(body));
		return parsed.success ? parsed.data.reason : "unknown";
	} catch {
		return "unknown";
	}
};

export const apnsSender = (
	config: ApnsConfig,
	tokens: ApnsTokenCache,
	transport: Http2Transport,
	now: () => number,
): Sender => {
	const send = async (
		device: Device,
		push: PushBody,
		retried: boolean,
	): Promise<DeliveryResult> => {
		const request = buildApnsRequest(device, push, config.topic, now());
		if ("outcome" in request) return request;
		// A stored token is checked at the edge. This guard stops a bad row from
		// alter the URL path.
		if (!isApnsToken(request.token)) {
			return { outcome: "failed", status: 400, reason: "InvalidToken" };
		}
		const origin = ORIGINS[device.apnsEnvironment ?? "production"];
		const response = await transport({
			origin,
			path: `/3/device/${encodeURIComponent(request.token)}`,
			headers: {
				...request.headers,
				authorization: `bearer ${await tokens.get(retried)}`,
			},
			body: request.payload,
		});
		if (response.status === 200) return { outcome: "delivered" };
		const reason = reasonOf(response.body);
		if (response.status === 410) return deadTokenOutcome(push);
		// A per-activity token that APNs does not know is as good as dead. For a
		// device token, BadDeviceToken often means a sandbox token sent to
		// production, so the device is kept.
		if (reason === "BadDeviceToken" && push.liveActivity) {
			return deadTokenOutcome(push);
		}
		if (response.status === 413) return { outcome: "too_large" };
		if (response.status === 403 && reason === "ExpiredProviderToken") {
			if (!retried) return send(device, push, true);
		}
		return { outcome: "failed", status: response.status, reason };
	};
	return (device, push) => send(device, push, false);
};
