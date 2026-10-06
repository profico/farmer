import { z } from "zod";

import { USER_AGENT } from "../config";

/**
 * The Server's side of native push (`docs/domains/mobile.md`): whether the
 * Server uses a relay (`GET /api/v1/meta`), and the phone's row
 * (`/api/v1/me/devices`). `@farmer/api-client` has no methods for these
 * routes, so this file calls them directly, with the session as a bearer
 * token: the routes do not read a cookie.
 */

const TIMEOUT_MS = 20_000;

const request = async (
	origin: string,
	path: string,
	method: "GET" | "POST" | "PATCH" | "DELETE",
	token: string | null,
	body: string | null,
) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const headers = new Headers({
		accept: "application/json",
		"user-agent": USER_AGENT,
	});
	if (body !== null) headers.set("content-type", "application/json");
	if (token !== null) headers.set("authorization", `Bearer ${token}`);
	try {
		return await fetch(`${origin}${path}`, {
			method,
			headers,
			body: body ?? undefined,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
};

const pushRelaySchema = z.object({
	pushRelay: z.object({ enabled: z.boolean(), url: z.string().nullable() }),
});

/** The relay that the Server uses, or null when push is off. */
export const serverRelayUrl = async (
	origin: string,
): Promise<string | null> => {
	const response = await request(origin, "/api/v1/meta", "GET", null, null);
	if (!response.ok)
		throw new Error(`GET /api/v1/meta answered ${response.status}.`);
	const parsed = pushRelaySchema.safeParse(await response.json());
	if (!parsed.success) return null;
	const { enabled, url } = parsed.data.pushRelay;
	return enabled && url ? url : null;
};

/** The body of `POST /api/v1/me/devices`. */
export type DeviceRegistration = {
	installationId: string;
	platform: "ios" | "android";
	relayId: string;
	publicKey: string;
	appVersion: string;
	notificationsAllowed: boolean;
	liveActivityToken?: string | null;
};

/**
 * - `ok`: the Server keeps the row.
 * - `refused`: a 401 or a 403. A 403 is a session that cannot register (an
 *   API token); the app does not show it. A 401 signs the person out
 *   elsewhere.
 * - `failed`: any other answer, or no answer.
 */
export type ServerAnswer = "ok" | "refused" | "failed";

const answerOf = (status: number, ok: boolean): ServerAnswer => {
	if (ok) return "ok";
	return status === 401 || status === 403 ? "refused" : "failed";
};

const devicePath = (installationId: string) =>
	`/api/v1/me/devices/${encodeURIComponent(installationId)}`;

/** `POST /api/v1/me/devices`: an upsert, sent on each foreground. */
export const registerDevice = async (
	origin: string,
	token: string,
	device: DeviceRegistration,
): Promise<ServerAnswer> => {
	try {
		const response = await request(
			origin,
			"/api/v1/me/devices",
			"POST",
			token,
			JSON.stringify(device),
		);
		return answerOf(response.status, response.ok);
	} catch {
		return "failed";
	}
};

/** What `PATCH` changes. Null clears the Live Activity token. */
export type DevicePatch = {
	liveActivityToken?: string | null;
	notificationsAllowed?: boolean;
	appVersion?: string;
};

export const updateDevice = async (
	origin: string,
	token: string,
	installationId: string,
	patch: DevicePatch,
): Promise<ServerAnswer> => {
	try {
		const response = await request(
			origin,
			devicePath(installationId),
			"PATCH",
			token,
			JSON.stringify(patch),
		);
		return answerOf(response.status, response.ok);
	} catch {
		return "failed";
	}
};

export const removeDevice = async (
	origin: string,
	token: string,
	installationId: string,
): Promise<ServerAnswer> => {
	try {
		const response = await request(
			origin,
			devicePath(installationId),
			"DELETE",
			token,
			null,
		);
		return answerOf(response.status, response.ok || response.status === 404);
	} catch {
		return "failed";
	}
};
