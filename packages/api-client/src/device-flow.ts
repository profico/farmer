/**
 * The OAuth device authorization grant (RFC 8628) against better-auth's
 * `device-authorization` plugin, as `apps/cli/src/device-flow.ts` does it:
 * ask for a code, open the approval page, and poll until the person approves.
 */

import { z } from "zod";

import { ApiClientError } from "./errors";
import { resolveAgainst } from "./origin";
import { readJson, send, type Transport } from "./transport";

/** The app's own client id (ADR 0005). A server from before that record
 *  knows only the CLI's, and answers `invalid_client` to this one. */
export const MOBILE_CLIENT_ID = "farmer-mobile";
export const CLI_CLIENT_ID = "farmer-cli";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** RFC 8628 §3.5: on `slow_down` the interval grows by 5 seconds. */
const SLOW_DOWN_STEP_MS = 5_000;
const DEFAULT_INTERVAL_SECONDS = 5;

export type DeviceCode = {
	/** The client id that got the code. The poll must send the same one. */
	clientId: string;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	/** The approval page with the code already filled in. */
	verificationUriComplete: string;
	expiresInSeconds: number;
	intervalSeconds: number;
};

/** `ABCD-EFGH`, as the approval page shows it. */
export const formatUserCode = (code: string) =>
	(code.match(/.{1,4}/g) ?? [code]).join("-");

const deviceCodeBody = z.object({
	device_code: z.string().min(1),
	user_code: z.string().min(1),
	verification_uri: z.string().min(1),
	verification_uri_complete: z.string().optional(),
	expires_in: z.number().positive(),
	interval: z.number().positive().optional(),
});

const tokenBody = z.object({ access_token: z.string().min(1) });

const oauthErrorBody = z.object({
	error: z.string(),
	error_description: z.string().optional(),
});

const askForCode = (transport: Transport, clientId: string) =>
	send(transport, {
		method: "POST",
		path: "/api/auth/device/code",
		token: null,
		body: JSON.stringify({ client_id: clientId }),
	});

/**
 * Starts the sign-in. Asks with `farmer-mobile` first, and with `farmer-cli`
 * when the server does not know the app's id yet.
 */
export const requestDeviceCode = async (
	transport: Transport,
): Promise<DeviceCode> => {
	let clientId = MOBILE_CLIENT_ID;
	let response = await askForCode(transport, clientId);
	let json = await readJson(response);
	if (!response.ok) {
		const failure = oauthErrorBody.safeParse(json);
		if (failure.success && failure.data.error === "invalid_client") {
			clientId = CLI_CLIENT_ID;
			response = await askForCode(transport, clientId);
			json = await readJson(response);
		}
	}
	const parsed = deviceCodeBody.safeParse(json);
	if (!response.ok || !parsed.success) {
		throw new ApiClientError(
			"http",
			`${transport.origin} did not start the sign-in (status ${response.status}).`,
			{ status: response.status },
		);
	}
	const body = parsed.data;
	const verificationUri = resolveAgainst(
		transport.origin,
		body.verification_uri,
	);
	const complete = body.verification_uri_complete
		? resolveAgainst(transport.origin, body.verification_uri_complete)
		: `${verificationUri}?user_code=${encodeURIComponent(body.user_code)}`;
	return {
		clientId,
		deviceCode: body.device_code,
		userCode: body.user_code,
		verificationUri,
		verificationUriComplete: complete,
		expiresInSeconds: body.expires_in,
		intervalSeconds: body.interval ?? DEFAULT_INTERVAL_SECONDS,
	};
};

export type PollOptions = {
	now: () => number;
	/** True once the person left the screen. The poll stops quietly. */
	cancelled: () => boolean;
};

/**
 * Polls until the code is approved, denied or expired, and returns the
 * session token, or null when `cancelled` turned true. Waits before each
 * request, because the server answers `slow_down` to one that comes early.
 */
export const pollForToken = async (
	transport: Transport,
	code: DeviceCode,
	options: PollOptions,
): Promise<string | null> => {
	let intervalMs = code.intervalSeconds * 1000;
	const deadline = options.now() + code.expiresInSeconds * 1000;
	const body = JSON.stringify({
		grant_type: DEVICE_CODE_GRANT,
		device_code: code.deviceCode,
		client_id: code.clientId,
	});

	for (;;) {
		await transport.sleep(intervalMs);
		if (options.cancelled()) return null;
		if (options.now() >= deadline) {
			throw new ApiClientError(
				"http",
				"The code expired before it was approved. Try again.",
			);
		}

		const response = await send(transport, {
			method: "POST",
			path: "/api/auth/device/token",
			token: null,
			body,
		});
		const json = await readJson(response);
		if (response.ok) {
			const token = tokenBody.safeParse(json);
			if (!token.success) {
				throw new ApiClientError(
					"invalid_response",
					`${transport.origin} approved the sign-in but sent no token.`,
				);
			}
			return token.data.access_token;
		}

		const failure = oauthErrorBody.safeParse(json);
		if (!failure.success) {
			throw new ApiClientError(
				"http",
				`${transport.origin} answered ${response.status} during the sign-in.`,
				{ status: response.status },
			);
		}
		switch (failure.data.error) {
			case "authorization_pending":
				break;
			case "slow_down":
				intervalMs += SLOW_DOWN_STEP_MS;
				break;
			case "expired_token":
				throw new ApiClientError(
					"http",
					"The code expired before it was approved. Try again.",
				);
			case "access_denied":
				throw new ApiClientError("http", "The sign-in was denied.");
			default:
				throw new ApiClientError(
					"http",
					failure.data.error_description ?? failure.data.error,
				);
		}
	}
};
