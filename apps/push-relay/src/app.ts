import { readJsonBody } from "./body";
import { clientAddress } from "./client-address";
import type { DeliveryResult, Log, Senders } from "./delivery/types";
import {
	hashSecret,
	newDeviceSecret,
	newRelayId,
	relayIdHint,
	secretMatches,
} from "./ids";
import { admit, type RelayLimiters } from "./rate-limit";
import {
	isApnsToken,
	pushBody,
	registerDeviceBody,
	relayIdSchema,
	updateDeviceBody,
} from "./schemas";
import type { Device, DeviceStore } from "./store";

export type RelayDependencies = {
	store: DeviceStore;
	senders: Senders;
	limiters: RelayLimiters;
	/** The header `TRUSTED_IP_HEADER` names, or null for the socket only. */
	trustedIpHeader: string | null;
	log: Log;
	now: () => number;
};

/** One request handler. `socketAddress` is the peer of the TCP connection,
 *  from `server.requestIP`, or null in a test. */
export type RelayHandler = (
	request: Request,
	socketAddress: string | null,
) => Promise<Response>;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const json = (status: number, body: Json, headers?: HeadersInit): Response =>
	Response.json(body, { status, headers });

const error = (status: number, code: string, headers?: HeadersInit): Response =>
	json(status, { error: code }, headers);

const tooMany = (retryAfterSeconds: number): Response =>
	error(429, "rate_limited", { "retry-after": String(retryAfterSeconds) });

const bodyError = (code: "too_large" | "invalid_json" | "invalid_body") =>
	code === "too_large" ? error(413, code) : error(400, code);

/** The secret from `Authorization: Bearer <secret>`, or null. */
const bearer = (request: Request): string | null => {
	const match = /^Bearer\s+(\S+)$/i.exec(
		request.headers.get("authorization") ?? "",
	);
	return match?.[1] ?? null;
};

/** A fixed hash to compare with when the relay id is unknown, so a wrong id
 *  and a wrong secret take the same time and get the same answer. */
const NO_DEVICE_HASH = hashSecret("no device");

/**
 * The answer to a push, by outcome. The server reads the status:
 *
 *  - 200 delivered, 202 dry run (no credentials for the platform).
 *  - 410 `device_gone`: the device token is dead and the relay forgot the
 *    device. The server deletes its `mobile_device` row.
 *  - 409 `activity_gone`, `start_token_gone`, `no_start_token`: the device is
 *    good, but the Live Activity target is not. The server keeps the row.
 *  - 413 `too_large`, 502 `upstream_failed` with the APNs or FCM reason.
 */
const pushResponse = (result: DeliveryResult): Response => {
	switch (result.outcome) {
		case "delivered":
			return json(200, { status: "delivered" });
		case "dry_run":
			return json(202, { status: "dry_run" });
		case "device_gone":
			return error(410, "device_gone");
		case "activity_gone":
		case "start_token_gone":
		case "no_start_token":
			return error(409, result.outcome);
		case "too_large":
			return error(413, "too_large");
		case "failed":
			return json(502, {
				error: "upstream_failed",
				upstreamStatus: result.status,
				reason: result.reason,
			});
	}
};

export const createRelay = (deps: RelayDependencies): RelayHandler => {
	const { store, senders, limiters, log, now } = deps;

	const addressOf = (request: Request, socketAddress: string | null) =>
		clientAddress(request.headers, deps.trustedIpHeader, socketAddress);

	/** The device that `relayId` names, when the bearer secret is its own. */
	const authorizedDevice = (
		request: Request,
		relayId: string,
	): Device | null => {
		const secret = bearer(request);
		const parsedId = relayIdSchema.safeParse(relayId);
		const device = parsedId.success ? store.find(parsedId.data) : null;
		const matches = secretMatches(
			secret ?? "",
			device?.secretHash ?? NO_DEVICE_HASH,
		);
		return device && secret && matches ? device : null;
	};

	const register = async (request: Request): Promise<Response> => {
		const body = await readJsonBody(request, registerDeviceBody);
		if (!body.ok) return bodyError(body.error);
		const ios = body.value.platform === "ios";
		const relayId = newRelayId();
		const deviceSecret = newDeviceSecret();
		const at = now();
		store.insert({
			relayId,
			platform: body.value.platform,
			pushToken: body.value.pushToken,
			apnsEnvironment: ios
				? (body.value.apnsEnvironment ?? "production")
				: null,
			liveActivityStartToken: ios
				? (body.value.liveActivityPushToStartToken ?? null)
				: null,
			secretHash: hashSecret(deviceSecret),
			createdAt: at,
			updatedAt: at,
			lastSeenAt: at,
		});
		log(
			`[push-relay] registered platform=${body.value.platform} relay=${relayIdHint(relayId)}`,
		);
		return json(201, { relayId, deviceSecret });
	};

	const update = async (
		request: Request,
		relayId: string,
	): Promise<Response> => {
		const device = authorizedDevice(request, relayId);
		if (!device) return error(401, "unauthorized");
		const body = await readJsonBody(request, updateDeviceBody);
		if (!body.ok) return bodyError(body.error);
		const ios = device.platform === "ios";
		// The schema does not know the platform of an update, so check here.
		if (ios) {
			const tokens = [
				body.value.pushToken,
				body.value.liveActivityPushToStartToken,
			];
			if (tokens.some((token) => token != null && !isApnsToken(token))) {
				return bodyError("invalid_body");
			}
		}
		store.update(
			device.relayId,
			{
				pushToken: body.value.pushToken,
				apnsEnvironment: ios ? body.value.apnsEnvironment : undefined,
				liveActivityStartToken: ios
					? body.value.liveActivityPushToStartToken
					: undefined,
			},
			now(),
		);
		return json(200, { status: "updated" });
	};

	const forget = (request: Request, relayId: string): Response => {
		const device = authorizedDevice(request, relayId);
		if (!device) return error(401, "unauthorized");
		store.delete(device.relayId);
		log(`[push-relay] forgot relay=${relayIdHint(device.relayId)}`);
		return new Response(null, { status: 204 });
	};

	const push = async (request: Request): Promise<Response> => {
		const body = await readJsonBody(request, pushBody);
		if (!body.ok) return bodyError(body.error);
		const message = body.value;
		const device = store.find(message.relayId);
		if (!device) return error(404, "unknown_relay_id");
		const activityToken = message.liveActivity?.token;
		if (
			device.platform === "ios" &&
			activityToken !== undefined &&
			!isApnsToken(activityToken)
		) {
			return bodyError("invalid_body");
		}

		const budget =
			message.kind === "liveactivity" ? limiters.liveActivity : limiters.push;
		const admission = admit(
			[
				[budget.minute, device.relayId],
				[budget.day, device.relayId],
			],
			now(),
		);
		if (!admission.ok) return tooMany(admission.retryAfterSeconds);

		const sender = device.platform === "ios" ? senders.ios : senders.android;
		let result: DeliveryResult;
		try {
			result = await sender(device, message);
		} catch (cause) {
			log(
				`[push-relay] send failed platform=${device.platform} relay=${relayIdHint(device.relayId)} error=${cause instanceof Error ? cause.message : "unknown"}`,
			);
			return error(502, "upstream_unreachable");
		}

		if (result.outcome === "delivered" || result.outcome === "dry_run") {
			store.touch(device.relayId, now());
		} else if (result.outcome === "device_gone") {
			store.delete(device.relayId);
			log(
				`[push-relay] token dead, device forgotten platform=${device.platform} relay=${relayIdHint(device.relayId)}`,
			);
		} else if (result.outcome === "start_token_gone") {
			store.clearStartToken(device.relayId, now());
		} else if (result.outcome === "failed") {
			log(
				`[push-relay] refused platform=${device.platform} relay=${relayIdHint(device.relayId)} status=${result.status} reason=${result.reason}`,
			);
		}
		return pushResponse(result);
	};

	const DEVICE_PATH = /^\/v1\/devices\/([^/]+)$/;

	return async (request, socketAddress) => {
		const { pathname } = new URL(request.url);
		const method = request.method;

		if (pathname === "/healthz") {
			if (method !== "GET" && method !== "HEAD") {
				return error(405, "method_not_allowed");
			}
			return store.ping()
				? new Response("ok", { status: 200 })
				: new Response("database unavailable", { status: 503 });
		}

		const deviceMatch = DEVICE_PATH.exec(pathname);
		const isDevices = pathname === "/v1/devices" || deviceMatch !== null;
		if (!isDevices && pathname !== "/v1/push") {
			return error(404, "not_found");
		}

		const address = addressOf(request, socketAddress);
		const byAddress = isDevices
			? limiters.deviceByAddress
			: limiters.pushByAddress;
		const admission = admit([[byAddress, address]], now());
		if (!admission.ok) return tooMany(admission.retryAfterSeconds);

		if (pathname === "/v1/push") {
			return method === "POST"
				? push(request)
				: error(405, "method_not_allowed");
		}
		if (pathname === "/v1/devices") {
			return method === "POST"
				? register(request)
				: error(405, "method_not_allowed");
		}
		const relayId = deviceMatch?.[1] ?? "";
		if (method === "PUT") return update(request, relayId);
		if (method === "DELETE") return forget(request, relayId);
		return error(405, "method_not_allowed");
	};
};
