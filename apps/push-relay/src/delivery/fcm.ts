import { z } from "zod";

import type { PushBody } from "../schemas";
import type { Device } from "../store";
import { importSigningKey, signJwt } from "./jwt";
import type { DeliveryResult, Sender } from "./types";

/** The fields of a Google service account key file that the relay reads. */
export const serviceAccountSchema = z.object({
	project_id: z.string().min(1),
	client_email: z.string().min(1),
	private_key: z.string().min(1),
	token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

/** A POST and its answer. The default is `fetch`; the tests pass a fake. */
export type HttpPost = (
	url: string,
	headers: Record<string, string>,
	body: string,
) => Promise<{ status: number; body: string }>;

export const fetchPost: HttpPost = async (url, headers, body) => {
	const response = await fetch(url, {
		method: "POST",
		headers,
		body,
		signal: AbortSignal.timeout(10_000),
	});
	return { status: response.status, body: await response.text() };
};

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** FCM refuses a data payload over 4 KB. */
export const FCM_MAX_DATA_BYTES = 4_096;

/** Get a new access token this many milliseconds before the old one ends. */
const REFRESH_MARGIN_MS = 60_000;

const tokenResponse = z.object({
	access_token: z.string().min(1),
	expires_in: z.number().positive(),
});

const fcmErrorBody = z.object({
	error: z.object({
		status: z.string().optional(),
		details: z
			.array(z.object({ errorCode: z.string().optional() }).loose())
			.optional(),
	}),
});

/** The OAuth 2.0 access token, from a signed JWT (RFC 7523), kept until it
 *  is close to its end. */
export class FcmTokenCache {
	readonly #account: ServiceAccount;
	readonly #key: Promise<CryptoKey>;
	readonly #post: HttpPost;
	readonly #now: () => number;
	#current: { token: string; expiresAt: number } | null = null;
	#pending: Promise<string> | null = null;

	constructor(account: ServiceAccount, post: HttpPost, now: () => number) {
		this.#account = account;
		this.#post = post;
		this.#now = now;
		this.#key = importSigningKey(account.private_key, "RS256");
	}

	async verifyKey(): Promise<void> {
		await this.#key;
	}

	async get(forceRefresh = false): Promise<string> {
		const now = this.#now();
		if (
			!forceRefresh &&
			this.#current &&
			this.#current.expiresAt - REFRESH_MARGIN_MS > now
		) {
			return this.#current.token;
		}
		// Pushes that find the token old at the same moment share one exchange.
		this.#pending ??= this.#exchange(now).finally(() => {
			this.#pending = null;
		});
		return this.#pending;
	}

	async #exchange(now: number): Promise<string> {
		const iat = Math.floor(now / 1000);
		const assertion = await signJwt(
			await this.#key,
			"RS256",
			{ typ: "JWT" },
			{
				iss: this.#account.client_email,
				scope: SCOPE,
				aud: this.#account.token_uri,
				iat,
				exp: iat + 3600,
			},
		);
		const response = await this.#post(
			this.#account.token_uri,
			{ "content-type": "application/x-www-form-urlencoded" },
			new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}).toString(),
		);
		if (response.status !== 200) {
			throw new Error(`The FCM token exchange answered ${response.status}.`);
		}
		const parsed = tokenResponse.parse(JSON.parse(response.body));
		this.#current = {
			token: parsed.access_token,
			expiresAt: now + parsed.expires_in * 1000,
		};
		return parsed.access_token;
	}
}

/** The FCM data map. FCM takes only string values. */
export type FcmData = {
	/** The ciphertext, base64url. */
	e: string;
	/** The kind: alert, data or liveactivity. */
	k: PushBody["kind"];
	la_event?: "start" | "update" | "end";
	/** The content state as one JSON string. */
	la_content_state?: string;
	la_stale_date?: string;
	la_dismissal_date?: string;
	la_attributes_type?: string;
	/** The attributes as one JSON string. */
	la_attributes?: string;
};

/**
 * The FCM data map for one push. Every value is a string, as FCM requires.
 * There is no `notification` block: the app opens the payload and shows the
 * notification itself. Exported for the tests.
 */
export const buildFcmData = (push: PushBody): FcmData => {
	const data: FcmData = { e: push.ciphertext, k: push.kind };
	const activity = push.liveActivity;
	if (activity) {
		data.la_event = activity.event;
		data.la_content_state = JSON.stringify(activity.contentState);
		if (activity.staleDate !== undefined) {
			data.la_stale_date = String(activity.staleDate);
		}
		if (activity.dismissalDate !== undefined) {
			data.la_dismissal_date = String(activity.dismissalDate);
		}
		if (activity.attributesType !== undefined) {
			data.la_attributes_type = activity.attributesType;
		}
		if (activity.attributes !== undefined) {
			data.la_attributes = JSON.stringify(activity.attributes);
		}
	}
	return data;
};

const errorCodeOf = (body: string): string => {
	try {
		const parsed = fcmErrorBody.safeParse(JSON.parse(body));
		if (!parsed.success) return "unknown";
		const code = parsed.data.error.details?.find(
			(detail) => detail.errorCode,
		)?.errorCode;
		return code ?? parsed.data.error.status ?? "unknown";
	} catch {
		return "unknown";
	}
};

export const fcmSender = (
	account: ServiceAccount,
	tokens: FcmTokenCache,
	post: HttpPost,
): Sender => {
	const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;

	const send = async (
		device: Device,
		push: PushBody,
		retried: boolean,
	): Promise<DeliveryResult> => {
		const data = buildFcmData(push);
		if (Buffer.byteLength(JSON.stringify(data)) > FCM_MAX_DATA_BYTES) {
			return { outcome: "too_large" };
		}
		const response = await post(
			url,
			{
				authorization: `Bearer ${await tokens.get(retried)}`,
				"content-type": "application/json",
			},
			JSON.stringify({
				message: {
					token: device.pushToken,
					data,
					android: { priority: "HIGH" },
				},
			}),
		);
		if (response.status === 200) return { outcome: "delivered" };
		const reason = errorCodeOf(response.body);
		// UNREGISTERED means that the token is dead. The relay builds a message
		// that it checked (shape and size), so INVALID_ARGUMENT means that
		// the token is not a valid registration token.
		if (reason === "UNREGISTERED" || reason === "INVALID_ARGUMENT") {
			return { outcome: "device_gone" };
		}
		if (response.status === 401 && !retried) return send(device, push, true);
		return { outcome: "failed", status: response.status, reason };
	};
	return (device, push) => send(device, push, false);
};
