import { z } from "zod";

import { USER_AGENT } from "../config";

/**
 * The push relay's device API (`apps/push-relay/README.md`). The app talks to
 * the relay only to register, to send a new token and to forget the device.
 * Pushes go from the Server to the relay, never from the app.
 */

const TIMEOUT_MS = 15_000;

export type RelayPlatform = "ios" | "android";
export type ApnsEnvironment = "production" | "sandbox";

/** What the app sends on a registration. */
export type RelayDevice = {
	platform: RelayPlatform;
	pushToken: string;
	apnsEnvironment: ApnsEnvironment;
	liveActivityPushToStartToken: string | null;
};

const registered = z.object({ relayId: z.string(), deviceSecret: z.string() });
export type RelayCredentials = z.output<typeof registered>;

/** The answer of a `PUT` or `DELETE`. `unauthorized` means that the relay
 *  forgot the device (or never knew it), so the app registers again. */
export type RelayAnswer = "ok" | "unauthorized" | "failed";

const call = async (
	url: string,
	method: "POST" | "PUT" | "DELETE",
	secret: string | null,
	body: string | null,
) => {
	// `AbortSignal.timeout` is not in React Native, so the timer is our own.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const headers = new Headers({
		accept: "application/json",
		"user-agent": USER_AGENT,
	});
	if (body !== null) headers.set("content-type", "application/json");
	if (secret !== null) headers.set("authorization", `Bearer ${secret}`);
	try {
		return await fetch(url, {
			method,
			headers,
			body: body ?? undefined,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
};

const devicesUrl = (relayUrl: string) =>
	`${relayUrl.replace(/\/+$/, "")}/v1/devices`;

/** `POST /v1/devices`. Throws on any failure. */
export const registerWithRelay = async (
	relayUrl: string,
	device: RelayDevice,
): Promise<RelayCredentials> => {
	const response = await call(
		devicesUrl(relayUrl),
		"POST",
		null,
		JSON.stringify({
			platform: device.platform,
			pushToken: device.pushToken,
			apnsEnvironment: device.apnsEnvironment,
			...(device.liveActivityPushToStartToken
				? { liveActivityPushToStartToken: device.liveActivityPushToStartToken }
				: undefined),
		}),
	);
	if (response.status !== 201) {
		throw new Error(
			`The push relay refused the registration (${response.status}).`,
		);
	}
	return registered.parse(await response.json());
};

/** What a `PUT` changes. A null push-to-start token clears it. */
export type RelayUpdate = {
	pushToken?: string;
	apnsEnvironment?: ApnsEnvironment;
	liveActivityPushToStartToken?: string | null;
};

/** `PUT /v1/devices/:relayId`. Never throws. */
export const updateRelay = async (
	relayUrl: string,
	credentials: RelayCredentials,
	update: RelayUpdate,
): Promise<RelayAnswer> => {
	try {
		const response = await call(
			`${devicesUrl(relayUrl)}/${encodeURIComponent(credentials.relayId)}`,
			"PUT",
			credentials.deviceSecret,
			JSON.stringify(update),
		);
		if (response.ok) return "ok";
		return response.status === 401 ? "unauthorized" : "failed";
	} catch {
		return "failed";
	}
};

/** `DELETE /v1/devices/:relayId`. Never throws. */
export const removeFromRelay = async (
	relayUrl: string,
	credentials: RelayCredentials,
): Promise<RelayAnswer> => {
	try {
		const response = await call(
			`${devicesUrl(relayUrl)}/${encodeURIComponent(credentials.relayId)}`,
			"DELETE",
			credentials.deviceSecret,
			null,
		);
		if (response.ok) return "ok";
		return response.status === 401 ? "unauthorized" : "failed";
	} catch {
		return "failed";
	}
};
