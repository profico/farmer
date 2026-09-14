/**
 * The OAuth device authorization grant (RFC 8628) against better-auth's
 * `device-authorization` plugin: ask for a code, show it, and poll until the
 * person approves it in a browser.
 */

import { CLI_CLIENT_ID } from "@farmer/core/api";
import { z } from "zod";

import { CliError } from "./errors";
import { send, type Transport } from "./http";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** RFC 8628 §3.5: on `slow_down`, the interval grows by 5 seconds for this
 *  and every later request. */
const SLOW_DOWN_STEP_MS = 5_000;
/** RFC 8628 §3.2: the interval a client uses when the server names none. */
const DEFAULT_INTERVAL_SECONDS = 5;

export type DeviceCode = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	/** The approval page with the code already filled in. */
	verificationUriComplete: string;
	expiresInSeconds: number;
	intervalSeconds: number;
};

/**
 * `ABCD-EFGH`: the user code in groups of four, exactly as `/device` shows it.
 * The person compares the two by eye, and the page warns them to approve only
 * the code their terminal shows, so the two must look the same. The dash is
 * display only; the page strips it from what a person types.
 */
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

const tokenErrorBody = z.object({
	error: z.string(),
	error_description: z.string().optional(),
});

const readBody = async (response: Response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const requestDeviceCode = async (
	transport: Transport,
): Promise<DeviceCode> => {
	const response = await send(transport, {
		method: "POST",
		path: "/api/auth/device/code",
		token: null,
		body: JSON.stringify({ client_id: CLI_CLIENT_ID }),
	});
	const parsed = deviceCodeBody.safeParse(await readBody(response));
	if (!response.ok || !parsed.success) {
		throw new CliError(
			`${transport.origin} did not start the sign-in (status ${response.status}).`,
		);
	}
	const body = parsed.data;
	// The plugin is configured with a path (`/device`); resolving against the
	// origin gives a URL a browser can open whichever form it answers with.
	const verificationUri = new URL(
		body.verification_uri,
		transport.origin,
	).toString();
	const complete = body.verification_uri_complete
		? new URL(body.verification_uri_complete, transport.origin).toString()
		: `${verificationUri}?user_code=${encodeURIComponent(body.user_code)}`;
	return {
		deviceCode: body.device_code,
		userCode: body.user_code,
		verificationUri,
		verificationUriComplete: complete,
		expiresInSeconds: body.expires_in,
		intervalSeconds: body.interval ?? DEFAULT_INTERVAL_SECONDS,
	};
};

const expired = () =>
	new CliError(
		"The code expired before it was approved. Run `farmer login` again.",
	);

/**
 * Polls `/api/auth/device/token` until the code is approved, denied or
 * expired, and returns the session token.
 *
 * Waits BEFORE each request, including the first: the person has not had time
 * to approve anything yet, and the server counts a request that comes sooner
 * than the interval as a reason to answer `slow_down`.
 */
export const pollForToken = async (
	transport: Transport,
	code: DeviceCode,
	nowMs: () => number,
): Promise<string> => {
	let intervalMs = code.intervalSeconds * 1000;
	const deadline = nowMs() + code.expiresInSeconds * 1000;
	const body = JSON.stringify({
		grant_type: DEVICE_CODE_GRANT,
		device_code: code.deviceCode,
		client_id: CLI_CLIENT_ID,
	});

	for (;;) {
		await transport.sleep(intervalMs);
		if (nowMs() >= deadline) throw expired();

		const response = await send(transport, {
			method: "POST",
			path: "/api/auth/device/token",
			token: null,
			body,
		});
		const json = await readBody(response);
		if (response.ok) {
			const token = tokenBody.safeParse(json);
			if (!token.success) {
				throw new CliError(
					`${transport.origin} approved the sign-in but sent no token.`,
				);
			}
			return token.data.access_token;
		}

		const failure = tokenErrorBody.safeParse(json);
		if (!failure.success) {
			throw new CliError(
				`${transport.origin} answered ${response.status} while farmer waited for approval.`,
			);
		}
		switch (failure.data.error) {
			case "authorization_pending":
				break;
			case "slow_down":
				intervalMs += SLOW_DOWN_STEP_MS;
				break;
			case "expired_token":
				throw expired();
			case "access_denied":
				throw new CliError("The sign-in was denied in the browser.");
			default:
				throw new CliError(
					failure.data.error_description ?? failure.data.error,
				);
		}
	}
};
