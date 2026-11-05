import { readJsonBody } from "./body";
import { clientAddress } from "./client-address";
import type { DeliveryResult, Log, Senders } from "./delivery/types";
import {
	bindingProofMatches,
	hashSecret,
	newDeviceSecret,
	newRelayId,
	relayIdHint,
	secretMatches,
} from "./ids";
import {
	admit,
	type FixedWindowLimiter,
	type RelayLimiters,
} from "./rate-limit";
import {
	isApnsToken,
	type PushBody,
	pushBody,
	registerDeviceBody,
	relayIdSchema,
	updateDeviceBody,
	verifyDeviceBody,
} from "./schemas";
import type { Device, DeviceStore } from "./store";

export type RelayDependencies = {
	store: DeviceStore;
	senders: Senders;
	limiters: RelayLimiters;
	/** The header `TRUSTED_IP_HEADER` names, or null for the socket only. */
	trustedIpHeader: string | null;
	/** The most devices that the relay holds. A registration past it gets
	 *  `503 relay_full`. */
	maxDevices: number;
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

/** The header that carries the relay id for `PUT`, `DELETE` and verify. A
 *  proxy logs a URL path, so the id does not go there. */
export const RELAY_ID_HEADER = "x-relay-id";

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

	let warnedMissingHeader = false;
	let warnedInvalidHeader = false;
	const addressOf = (request: Request, socketAddress: string | null) => {
		const header = deps.trustedIpHeader;
		if (header && !warnedMissingHeader && !request.headers.has(header)) {
			// A wrong header name puts every phone in one bucket. Say it once.
			warnedMissingHeader = true;
			log(
				`[push-relay] a request has no ${header} header: check TRUSTED_IP_HEADER and the proxy`,
			);
		}
		return clientAddress(request.headers, header, socketAddress, () => {
			if (warnedInvalidHeader) return;
			warnedInvalidHeader = true;
			log(
				`[push-relay] the ${header} header holds no IP address: check TRUSTED_IP_HEADER and the proxy`,
			);
		});
	};

	/** The device that `relayId` names, when the bearer secret is its own. */
	const authorizedDevice = (request: Request): Device | null => {
		const relayId = request.headers.get(RELAY_ID_HEADER) ?? "";
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
		if (store.count() >= deps.maxDevices) {
			// A registration has no proof, so junk can fill the cap. Free only
			// the room that this registration needs, from the oldest rows with
			// no delivered push (first in, first out, whatever their age), so
			// junk cannot lock real phones out. A real phone that never got a
			// push can go too. It registers again: its next PUT gets 401 and
			// the app registers.
			const room = store.count() - deps.maxDevices + 1;
			const freed = store.pruneUnprovenOldest(room);
			if (freed > 0) {
				log(
					`[push-relay] warning: full, evicted ${freed} unproven devices (oldest first)`,
				);
			}
		}
		if (store.count() >= deps.maxDevices) {
			log(`[push-relay] full: refused a registration at ${deps.maxDevices}`);
			return error(503, "relay_full", { "retry-after": "3600" });
		}
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
		device: Device,
	): Promise<Response> => {
		const body = await readJsonBody(request, updateDeviceBody);
		if (!body.ok) return bodyError(body.error);
		const ios = device.platform === "ios";
		// The schema does not know the platform of an update, so check here.
		if (ios) {
			const tokens = [
				body.value.pushToken,
				body.value.liveActivityPushToStartToken,
				body.value.liveActivityToken,
			];
			if (tokens.some((token) => token != null && !isApnsToken(token))) {
				return bodyError("invalid_body");
			}
		} else if (body.value.liveActivityToken !== undefined) {
			return bodyError("invalid_body");
		}
		const activityToken = body.value.liveActivityToken;
		const at = now();
		// A token that another device holds is refused before any change, so
		// a refused update changes nothing.
		if (activityToken) {
			const owner = store.activityTokenOwner(activityToken);
			if (owner !== null && owner !== device.relayId) {
				return error(409, "activity_token_bound_elsewhere");
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
			at,
		);
		// A new APNs environment makes every old activity token invalid.
		const newEnvironment = ios ? body.value.apnsEnvironment : undefined;
		if (
			newEnvironment !== undefined &&
			newEnvironment !== device.apnsEnvironment
		) {
			store.clearActivityTokens(device.relayId);
		}
		if (activityToken === null) store.clearActivityTokens(device.relayId);
		else if (activityToken !== undefined) {
			store.bindActivityToken(device.relayId, activityToken, at);
		}
		return json(200, { status: "updated" });
	};

	const forget = (device: Device): Response => {
		store.delete(device.relayId);
		log(`[push-relay] forgot relay=${relayIdHint(device.relayId)}`);
		return new Response(null, { status: 204 });
	};

	/**
	 * A server asks whether a phone holds a relay registration. The phone made
	 * a proof for its public key from the device secret. A good proof gives
	 * 204. A wrong proof and an unknown relay id both give 401, so the answer
	 * does not tell which relay ids exist.
	 *
	 * The relay checks the id before it counts the call. A known id has its
	 * own limit for each address, so a caller cannot use up the limit of the
	 * real server. An unknown id counts against the address only, so a
	 * caller cannot fill the limiter with ids that it chooses.
	 */
	const verify = async (
		request: Request,
		address: string,
	): Promise<Response> => {
		const relayId = request.headers.get(RELAY_ID_HEADER) ?? "";
		const parsedId = relayIdSchema.safeParse(relayId);
		const device = parsedId.success ? store.find(parsedId.data) : null;
		const check: readonly [FixedWindowLimiter, string] = device
			? [limiters.verifyByRelayId, `${device.relayId}|${address}`]
			: [limiters.verifyUnknownByAddress, address];
		const admission = admit([check], now());
		if (!admission.ok) return tooMany(admission.retryAfterSeconds);
		const body = await readJsonBody(request, verifyDeviceBody);
		if (!body.ok) return bodyError(body.error);
		const matches = bindingProofMatches(
			body.value.proof,
			device?.secretHash ?? NO_DEVICE_HASH,
			relayId,
			body.value.publicKey,
		);
		if (!device || !matches) return error(401, "unauthorized");
		// A verify call is not a proof of a real phone: the registrant holds
		// the device secret and can verify its own junk rows. Only a
		// delivered push sets `proven_at`.
		return new Response(null, { status: 204 });
	};

	/** The refusal for a Live Activity token that this device may not use, or
	 *  null. */
	const activityTokenFault = (
		device: Device,
		activityToken: string | undefined,
	): Response | null => {
		if (activityToken === undefined) return null;
		if (device.platform === "ios" && !isApnsToken(activityToken)) {
			return bodyError("invalid_body");
		}
		const owner = store.activityTokenOwner(activityToken);
		if (owner === null) return error(403, "activity_token_unbound");
		if (owner === device.relayId) return null;
		log(
			`[push-relay] refused activity token of another device relay=${relayIdHint(device.relayId)}`,
		);
		return error(403, "activity_token_mismatch");
	};

	/**
	 * Count a push against the budget of its relay id, and for most relay ids
	 * against the budget of its push token.
	 *
	 * A caller can register many relay ids for one push token, so the token
	 * has one budget that all of those ids share. The oldest registration of
	 * the token does not count against it, only against its own relay id
	 * budget. A registration has no proof, so a caller who knows a victim's
	 * token can register a new id for it. The new id is younger than the
	 * victim's own registration, so the caller can use up the shared token
	 * budget but not the budget of the real phone. A token reaches the caller
	 * only after the phone registered it.
	 */
	const admitPush = (device: Device, kind: PushBody["kind"]) => {
		const budget =
			kind === "liveactivity" ? limiters.liveActivity : limiters.push;
		const checks: [FixedWindowLimiter, string][] = [
			[budget.minute, device.relayId],
			[budget.day, device.relayId],
		];
		if (!store.holdsOldestRegistration(device.relayId, device.pushToken)) {
			const tokenKey = `token:${hashSecret(device.pushToken)}`;
			checks.push([budget.minute, tokenKey], [budget.day, tokenKey]);
		}
		return admit(checks, now());
	};

	const settle = (
		device: Device,
		message: PushBody,
		result: DeliveryResult,
	): void => {
		const activityToken = message.liveActivity?.token;
		if (result.outcome === "delivered" || result.outcome === "dry_run") {
			store.touch(device.relayId, now(), result.outcome === "delivered");
			// An end push closes the activity, so its token has no more use.
			if (message.liveActivity?.event === "end" && activityToken) {
				store.removeActivityToken(device.relayId, activityToken);
			}
		} else if (result.outcome === "device_gone") {
			// The token that the push used. A phone that sent a new token while
			// the push was in flight keeps its registration.
			store.deleteWithToken(device.relayId, device.pushToken);
			log(
				`[push-relay] token dead, device forgotten platform=${device.platform} relay=${relayIdHint(device.relayId)}`,
			);
		} else if (result.outcome === "activity_gone" && activityToken) {
			store.removeActivityToken(device.relayId, activityToken);
		} else if (result.outcome === "start_token_gone") {
			store.clearStartToken(device.relayId, now());
		} else if (result.outcome === "failed") {
			log(
				`[push-relay] refused platform=${device.platform} relay=${relayIdHint(device.relayId)} status=${result.status} reason=${result.reason}`,
			);
		}
	};

	const push = async (request: Request): Promise<Response> => {
		const body = await readJsonBody(request, pushBody);
		if (!body.ok) return bodyError(body.error);
		const message = body.value;
		const device = store.find(message.relayId);
		if (!device) return error(404, "unknown_relay_id");
		const fault = activityTokenFault(device, message.liveActivity?.token);
		if (fault) return fault;
		const admission = admitPush(device, message.kind);
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
		settle(device, message, result);
		return pushResponse(result);
	};

	const notAllowed = () => error(405, "method_not_allowed");

	/**
	 * `PUT` and `DELETE` prove the device secret, so a good proof has its own
	 * limit for each relay id and address. Many phones behind one office
	 * address then do not share one budget. A call with a bad proof, `POST`
	 * (a registration has no proof) and any other method count against the
	 * strict limit of the address.
	 */
	const devicesRoute = async (
		request: Request,
		address: string,
	): Promise<Response> => {
		const { method } = request;
		const proven =
			method === "PUT" || method === "DELETE"
				? authorizedDevice(request)
				: null;
		const check: readonly [FixedWindowLimiter, string] = proven
			? [limiters.deviceAuthByRelayId, `${proven.relayId}|${address}`]
			: [limiters.deviceByAddress, address];
		const admission = admit([check], now());
		if (!admission.ok) return tooMany(admission.retryAfterSeconds);

		if (method === "POST") return register(request);
		if (method === "PUT" || method === "DELETE") {
			if (!proven) return error(401, "unauthorized");
			return method === "PUT" ? update(request, proven) : forget(proven);
		}
		return notAllowed();
	};

	return async (request, socketAddress) => {
		const { pathname } = new URL(request.url);
		const method = request.method;

		if (pathname === "/healthz") {
			if (method !== "GET" && method !== "HEAD") return notAllowed();
			return store.ping()
				? new Response("ok", { status: 200 })
				: new Response("database unavailable", { status: 503 });
		}

		const isVerify = pathname === "/v1/devices/verify";
		const isDevices = pathname === "/v1/devices";
		if (!isDevices && !isVerify && pathname !== "/v1/push") {
			return error(404, "not_found");
		}

		const address = addressOf(request, socketAddress);
		if (isDevices) return devicesRoute(request, address);
		// A verify has its own limits. The farmer server makes all of them from
		// one address, so the device limit for an address must not count them.
		const byAddress = isVerify
			? limiters.verifyByAddress
			: limiters.pushByAddress;
		const admission = admit([[byAddress, address]], now());
		if (!admission.ok) return tooMany(admission.retryAfterSeconds);

		if (method !== "POST") return notAllowed();
		return isVerify ? verify(request, address) : push(request);
	};
};
