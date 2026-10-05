// The client side of the push relay (`apps/push-relay`, ADR 0006).
//
// The relay forwards a sealed payload to APNs or FCM. It answers each push
// with a status and, for a refusal, an error code. This module sends one push
// and turns the answer into one `RelayOutcome`, so the caller acts on a
// closed set of cases and not on raw HTTP. The table of answers is in
// `apps/push-relay/README.md`.
//
// No database import: the caller owns the `mobile_device` row and decides
// what each outcome does to it.

import { z } from "zod";

import { externalFetch } from "./http";
import { setting, settingEnabled } from "./instance-settings";

/** A push takes at most this long. The relay itself gives APNs 10 seconds. */
export const PUSH_RELAY_TIMEOUT_MS = 12_000;

export type LiveActivityEvent = "start" | "update" | "end";

/** A value in a Live Activity's content state or attributes. The relay
 *  forwards only primitives, because iOS reads them directly. */
export type LiveActivityPrimitive = string | number | boolean | null;

export type RelayLiveActivity = {
	/** The per-activity token. Absent means push-to-start. */
	token?: string;
	event: LiveActivityEvent;
	contentState: Record<string, LiveActivityPrimitive>;
	/** Unix seconds. */
	staleDate?: number;
	/** Unix seconds. */
	dismissalDate?: number;
	attributesType?: string;
	attributes?: Record<string, LiveActivityPrimitive>;
};

export type RelayPush = {
	relayId: string;
	kind: "alert" | "data" | "liveactivity";
	ciphertext: string;
	liveActivity?: RelayLiveActivity;
};

/** What one push came to, from the server's side of the contract. */
export type RelayOutcome =
	/** 200 or 202 (a dry run on a relay with no credentials). */
	| { kind: "delivered" }
	/** 404 `unknown_relay_id` or 410 `device_gone`: delete the row. */
	| { kind: "device_gone" }
	/** 409 `activity_gone`: forget the Live Activity token. */
	| { kind: "activity_gone" }
	/** 409 `start_token_gone` or `no_start_token`: the phone cannot get a
	 *  push-to-start now. Keep the row. */
	| { kind: "no_start_token" }
	/** 429, a 5xx, a 4xx this server did not expect, a timeout or a network
	 *  error. Logged and counted as failed. */
	| { kind: "failed"; status: number | null; code: string | null };

const errorBody = z.object({ error: z.string() });

/** The relay's base URL, or null when native push is off. Read per call, as
 *  every instance setting is. */
export const pushRelayUrl = (): string | null => {
	if (!settingEnabled("PUSH_RELAY_ENABLED")) return null;
	const url = setting("PUSH_RELAY_URL")?.trim();
	return url ? url.replace(/\/+$/, "") : null;
};

const errorCode = async (response: Response): Promise<string | null> => {
	try {
		const parsed = errorBody.safeParse(await response.json());
		return parsed.success ? parsed.data.error : null;
	} catch {
		return null;
	}
};

/** Map a relay answer to an outcome. */
const outcomeOf = async (response: Response): Promise<RelayOutcome> => {
	const { status } = response;
	if (status === 200 || status === 202) return { kind: "delivered" };
	const code = await errorCode(response);
	if (status === 404 || status === 410) return { kind: "device_gone" };
	if (status === 409 && code === "activity_gone") {
		return { kind: "activity_gone" };
	}
	if (
		status === 409 &&
		(code === "start_token_gone" || code === "no_start_token")
	) {
		return { kind: "no_start_token" };
	}
	return { kind: "failed", status, code };
};

/**
 * Send one push to the relay at `baseUrl`. Never throws: a network error or a
 * timeout is a `failed` outcome, because a push is a side effect and must not
 * fail the work that caused it.
 */
export const sendToRelay = async (
	baseUrl: string,
	push: RelayPush,
): Promise<RelayOutcome> => {
	try {
		const response = await externalFetch(
			`${baseUrl}/v1/push`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(push),
			},
			PUSH_RELAY_TIMEOUT_MS,
		);
		return await outcomeOf(response);
	} catch (error) {
		console.error("[push-relay] push failed", {
			kind: push.kind,
			error: error instanceof Error ? error.message : "unknown",
		});
		return { kind: "failed", status: null, code: null };
	}
};
