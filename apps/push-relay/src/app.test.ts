import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { createRelay } from "./app";
import { dryRunSender } from "./delivery/dry-run";
import type { DeliveryResult, Sender } from "./delivery/types";
import { createLimiters, DEFAULT_LIMITS, type RelayLimits } from "./rate-limit";
import type { PushBody } from "./schemas";
import { type Device, DeviceStore } from "./store";

const BASE = "http://relay.test";

const IOS_TOKEN = "a".repeat(64);
const ANDROID_TOKEN = "fcm-registration-token-0123456789";
const START_TOKEN = "b".repeat(64);
const CIPHERTEXT = "c".repeat(200);

type Json = string | number | boolean | null | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };

type SentPush = { device: Device; push: PushBody };

/** A sender that records each push and answers with `result`. */
const recordingSender = (
	sent: SentPush[],
	result: () => DeliveryResult = () => ({ outcome: "delivered" }),
): Sender => {
	return async (device, push) => {
		sent.push({ device, push });
		return result();
	};
};

const setup = (
	options: {
		ios?: Sender;
		android?: Sender;
		limits?: Partial<RelayLimits>;
		trustedIpHeader?: string | null;
	} = {},
) => {
	const store = DeviceStore.open(":memory:");
	const logs: string[] = [];
	const sent: SentPush[] = [];
	let clock = Date.UTC(2026, 9, 6, 12, 0, 0);
	const relay = createRelay({
		store,
		senders: {
			ios: options.ios ?? recordingSender(sent),
			android: options.android ?? recordingSender(sent),
		},
		limiters: createLimiters({ ...DEFAULT_LIMITS, ...options.limits }),
		trustedIpHeader:
			options.trustedIpHeader === undefined
				? "cf-connecting-ip"
				: options.trustedIpHeader,
		log: (line) => logs.push(line),
		now: () => clock,
	});
	const call = (
		method: string,
		path: string,
		body?: string | JsonObject,
		headers: Record<string, string> = {},
	) =>
		relay(
			new Request(`${BASE}${path}`, {
				method,
				headers: { "content-type": "application/json", ...headers },
				body:
					body === undefined
						? undefined
						: body instanceof Object
							? JSON.stringify(body)
							: body,
			}),
			"10.0.0.1",
		);
	return {
		store,
		logs,
		sent,
		call,
		advance: (ms: number) => {
			clock += ms;
		},
	};
};

const registration = z.object({
	relayId: z.string(),
	deviceSecret: z.string(),
});

const errorBody = z.object({ error: z.string() });

const register = async (
	call: ReturnType<typeof setup>["call"],
	body: JsonObject = {
		platform: "ios",
		pushToken: IOS_TOKEN,
		apnsEnvironment: "sandbox",
		liveActivityPushToStartToken: START_TOKEN,
	},
) => {
	const response = await call("POST", "/v1/devices", body);
	expect(response.status).toBe(201);
	return registration.parse(await response.json());
};

const errorOf = async (response: Response) =>
	errorBody.parse(await response.json()).error;

describe("registration", () => {
	test("returns a relay id and a secret, and stores only the secret's hash", async () => {
		const { call, store } = setup();
		const { relayId, deviceSecret } = await register(call);

		expect(relayId).toMatch(/^[A-Za-z0-9_-]{22,}$/);
		expect(deviceSecret).toMatch(/^[A-Za-z0-9_-]{43,}$/);
		const device = store.find(relayId);
		expect(device?.platform).toBe("ios");
		expect(device?.pushToken).toBe(IOS_TOKEN);
		expect(device?.apnsEnvironment).toBe("sandbox");
		expect(device?.liveActivityStartToken).toBe(START_TOKEN);
		expect(device?.secretHash).not.toContain(deviceSecret);
		expect(device?.secretHash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("an Android device keeps no APNs fields", async () => {
		const { call, store } = setup();
		const { relayId } = await register(call, {
			platform: "android",
			pushToken: ANDROID_TOKEN,
			apnsEnvironment: "sandbox",
		});
		expect(store.find(relayId)?.apnsEnvironment).toBeNull();
	});

	test("an iOS device without an environment gets production", async () => {
		const { call, store } = setup();
		const { relayId } = await register(call, {
			platform: "ios",
			pushToken: IOS_TOKEN,
		});
		expect(store.find(relayId)?.apnsEnvironment).toBe("production");
	});

	test("a body that does not match the schema is a 400", async () => {
		const { call } = setup();
		const wrongPlatform = await call("POST", "/v1/devices", {
			platform: "windows",
			pushToken: IOS_TOKEN,
		});
		expect(wrongPlatform.status).toBe(400);
		expect(await errorOf(wrongPlatform)).toBe("invalid_body");

		const notJson = await call("POST", "/v1/devices", "{nope");
		expect(notJson.status).toBe(400);
		expect(await errorOf(notJson)).toBe("invalid_json");
	});
});

describe("push token format", () => {
	const withSlash = "a/b".padEnd(64, "a");
	const withQuery = `${"a".repeat(64)}?x`;
	const bad = [withSlash, withQuery, "../".padEnd(64, "a")];

	test("an iOS device with a non-hex token is a 400", async () => {
		const { call } = setup();
		for (const pushToken of bad) {
			const response = await call("POST", "/v1/devices", {
				platform: "ios",
				pushToken,
			});
			expect(response.status).toBe(400);
		}
		const startToken = await call("POST", "/v1/devices", {
			platform: "ios",
			pushToken: IOS_TOKEN,
			liveActivityPushToStartToken: "../start".padEnd(64, "b"),
		});
		expect(startToken.status).toBe(400);
	});

	test("an Android device keeps the FCM token rules", async () => {
		const { call } = setup();
		await register(call, {
			platform: "android",
			pushToken: "dXyZ:APA91b-_Hk",
		});
	});

	test("an update or a push with a non-hex iOS token is a 400", async () => {
		const { call } = setup();
		const { relayId, deviceSecret } = await register(call);
		const update = await call(
			"PUT",
			`/v1/devices/${relayId}`,
			{ pushToken: withSlash },
			{ authorization: `Bearer ${deviceSecret}` },
		);
		expect(update.status).toBe(400);
		const push = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: { token: withQuery, event: "update", contentState: {} },
		});
		expect(push.status).toBe(400);
	});
});

describe("token update and removal", () => {
	test("the device secret updates the push token", async () => {
		const { call, store } = setup();
		const { relayId, deviceSecret } = await register(call);

		const response = await call(
			"PUT",
			`/v1/devices/${relayId}`,
			{ pushToken: "d".repeat(64), liveActivityPushToStartToken: null },
			{ authorization: `Bearer ${deviceSecret}` },
		);

		expect(response.status).toBe(200);
		const device = store.find(relayId);
		expect(device?.pushToken).toBe("d".repeat(64));
		expect(device?.liveActivityStartToken).toBeNull();
		expect(device?.apnsEnvironment).toBe("sandbox");
	});

	test("no secret, a wrong secret and an unknown id get the same 401", async () => {
		const { call, store } = setup();
		const { relayId, deviceSecret } = await register(call);
		const change = { pushToken: "d".repeat(64) };

		const missing = await call("PUT", `/v1/devices/${relayId}`, change);
		const wrong = await call("PUT", `/v1/devices/${relayId}`, change, {
			authorization: `Bearer ${deviceSecret}x`,
		});
		const unknown = await call("PUT", `/v1/devices/${"Z".repeat(22)}`, change, {
			authorization: `Bearer ${deviceSecret}`,
		});

		for (const response of [missing, wrong, unknown]) {
			expect(response.status).toBe(401);
			expect(await errorOf(response)).toBe("unauthorized");
		}
		expect(store.find(relayId)?.pushToken).toBe(IOS_TOKEN);
	});

	test("an empty change is a 400", async () => {
		const { call } = setup();
		const { relayId, deviceSecret } = await register(call);
		const response = await call(
			"PUT",
			`/v1/devices/${relayId}`,
			{},
			{ authorization: `Bearer ${deviceSecret}` },
		);
		expect(response.status).toBe(400);
	});

	test("DELETE with the secret forgets the device; without it, nothing changes", async () => {
		const { call, store } = setup();
		const { relayId, deviceSecret } = await register(call);

		const refused = await call("DELETE", `/v1/devices/${relayId}`);
		expect(refused.status).toBe(401);
		expect(store.find(relayId)).not.toBeNull();

		const response = await call("DELETE", `/v1/devices/${relayId}`, undefined, {
			authorization: `Bearer ${deviceSecret}`,
		});
		expect(response.status).toBe(204);
		expect(store.find(relayId)).toBeNull();
	});
});

describe("push routing", () => {
	test("an iOS device goes to the iOS sender, an Android device to the Android sender", async () => {
		const iosSent: SentPush[] = [];
		const androidSent: SentPush[] = [];
		const { call } = setup({
			ios: recordingSender(iosSent),
			android: recordingSender(androidSent),
		});
		const iosDevice = await register(call);
		const androidDevice = await register(call, {
			platform: "android",
			pushToken: ANDROID_TOKEN,
		});

		const toIos = await call("POST", "/v1/push", {
			relayId: iosDevice.relayId,
			kind: "alert",
			ciphertext: CIPHERTEXT,
		});
		const toAndroid = await call("POST", "/v1/push", {
			relayId: androidDevice.relayId,
			kind: "data",
			ciphertext: CIPHERTEXT,
		});

		expect(toIos.status).toBe(200);
		expect(toAndroid.status).toBe(200);
		expect(iosSent.map((sent) => sent.device.pushToken)).toEqual([IOS_TOKEN]);
		expect(androidSent.map((sent) => sent.device.pushToken)).toEqual([
			ANDROID_TOKEN,
		]);
		expect(iosSent[0]?.push.ciphertext).toBe(CIPHERTEXT);
	});

	test("an unknown relay id is a 404 and sends nothing", async () => {
		const { call, sent } = setup();
		const response = await call("POST", "/v1/push", {
			relayId: "Z".repeat(22),
			kind: "alert",
			ciphertext: CIPHERTEXT,
		});
		expect(response.status).toBe(404);
		expect(await errorOf(response)).toBe("unknown_relay_id");
		expect(sent).toHaveLength(0);
	});

	test("a dead device token deletes the device and answers 410", async () => {
		const { call, store } = setup({
			ios: async () => ({ outcome: "device_gone" }),
		});
		const { relayId } = await register(call);

		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "alert",
			ciphertext: CIPHERTEXT,
		});

		expect(response.status).toBe(410);
		expect(await errorOf(response)).toBe("device_gone");
		expect(store.find(relayId)).toBeNull();
	});

	test("a dead activity token keeps the device and answers 409", async () => {
		const { call, store } = setup({
			ios: async () => ({ outcome: "activity_gone" }),
		});
		const { relayId } = await register(call);
		store.bindActivityToken(relayId, "e".repeat(64), 0);

		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				token: "e".repeat(64),
				event: "update",
				contentState: { startedAt: 1_790_000_000, paused: false },
			},
		});

		expect(response.status).toBe(409);
		expect(await errorOf(response)).toBe("activity_gone");
		expect(store.find(relayId)).not.toBeNull();
	});

	test("a dead push-to-start token clears that token only", async () => {
		const { call, store } = setup({
			ios: async () => ({ outcome: "start_token_gone" }),
		});
		const { relayId } = await register(call);

		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				event: "start",
				contentState: { startedAt: 1_790_000_000 },
				attributesType: "TimerAttributes",
				attributes: { version: 1 },
			},
		});

		expect(response.status).toBe(409);
		expect(await errorOf(response)).toBe("start_token_gone");
		const device = store.find(relayId);
		expect(device?.pushToken).toBe(IOS_TOKEN);
		expect(device?.liveActivityStartToken).toBeNull();
	});

	test("a liveactivity push must carry liveActivity, and only a start may omit the token", async () => {
		const { call, sent } = setup();
		const { relayId } = await register(call);

		const missing = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
		});
		const updateWithoutToken = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: { event: "update", contentState: {} },
		});
		const nestedState = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				token: "e".repeat(64),
				event: "update",
				contentState: { nested: { a: 1 } },
			},
		});

		for (const response of [missing, updateWithoutToken, nestedState]) {
			expect(response.status).toBe(400);
		}
		expect(sent).toHaveLength(0);
	});

	test("a sender that throws is a 502 and the device stays", async () => {
		const { call, store } = setup({
			ios: async () => {
				throw new Error("connect ECONNREFUSED");
			},
		});
		const { relayId } = await register(call);
		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "alert",
			ciphertext: CIPHERTEXT,
		});
		expect(response.status).toBe(502);
		expect(store.find(relayId)).not.toBeNull();
	});
});

describe("last seen", () => {
	test("registration, a token update and an accepted push move lastSeenAt; a refused push does not", async () => {
		let answer: DeliveryResult = { outcome: "delivered" };
		const { call, store, advance } = setup({ ios: async () => answer });
		const { relayId, deviceSecret } = await register(call);
		const registeredAt = store.find(relayId)?.lastSeenAt ?? 0;
		expect(registeredAt).toBeGreaterThan(0);

		advance(1_000);
		await call(
			"PUT",
			`/v1/devices/${relayId}`,
			{ pushToken: "d".repeat(64) },
			{ authorization: `Bearer ${deviceSecret}` },
		);
		expect(store.find(relayId)?.lastSeenAt).toBe(registeredAt + 1_000);

		advance(1_000);
		const push = { relayId, kind: "alert", ciphertext: CIPHERTEXT };
		expect((await call("POST", "/v1/push", push)).status).toBe(200);
		expect(store.find(relayId)?.lastSeenAt).toBe(registeredAt + 2_000);

		advance(1_000);
		answer = { outcome: "failed", status: 500, reason: "InternalServerError" };
		expect((await call("POST", "/v1/push", push)).status).toBe(502);
		expect(store.find(relayId)?.lastSeenAt).toBe(registeredAt + 2_000);
	});
});

describe("dry-run mode", () => {
	test("with no credentials a push is a 202 and a log line without the ciphertext or a token", async () => {
		const logs: string[] = [];
		const log = (line: string) => logs.push(line);
		const { call, store, logs: relayLogs } = setup({
			ios: dryRunSender(log),
			android: dryRunSender(log),
		});
		const { relayId, deviceSecret } = await register(call);
		store.bindActivityToken(relayId, "e".repeat(64), 0);

		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				token: "e".repeat(64),
				event: "update",
				contentState: { startedAt: 1_790_000_000 },
			},
		});

		expect(response.status).toBe(202);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain("dry-run");
		expect(logs[0]).toContain("kind=liveactivity");
		for (const line of [...logs, ...relayLogs]) {
			expect(line).not.toContain(CIPHERTEXT);
			expect(line).not.toContain(IOS_TOKEN);
			expect(line).not.toContain("e".repeat(64));
			expect(line).not.toContain(START_TOKEN);
			expect(line).not.toContain(deviceSecret);
			expect(line).not.toContain(relayId);
		}
	});
});

describe("rate limits", () => {
	test("pushes to one relay id stop at the minute's limit with a Retry-After", async () => {
		const { call, advance } = setup({ limits: { pushPerMinute: 2 } });
		const { relayId } = await register(call);
		const push = { relayId, kind: "alert", ciphertext: CIPHERTEXT };

		expect((await call("POST", "/v1/push", push)).status).toBe(200);
		expect((await call("POST", "/v1/push", push)).status).toBe(200);
		const refused = await call("POST", "/v1/push", push);
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);

		advance(60_000);
		expect((await call("POST", "/v1/push", push)).status).toBe(200);
	});

	test("Live Activity pushes have their own budget", async () => {
		const { call, store } = setup({
			limits: { pushPerMinute: 1, liveActivityPerMinute: 3 },
		});
		const { relayId } = await register(call);
		store.bindActivityToken(relayId, "e".repeat(64), 0);
		const alert = { relayId, kind: "alert", ciphertext: CIPHERTEXT };
		const update = {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				token: "e".repeat(64),
				event: "update",
				contentState: { n: 1 },
			},
		};

		expect((await call("POST", "/v1/push", alert)).status).toBe(200);
		expect((await call("POST", "/v1/push", alert)).status).toBe(429);
		expect((await call("POST", "/v1/push", update)).status).toBe(200);
		expect((await call("POST", "/v1/push", update)).status).toBe(200);
	});

	test("the daily limit holds after the minute resets", async () => {
		const { call, advance } = setup({
			limits: { pushPerMinute: 10, pushPerDay: 2 },
		});
		const { relayId } = await register(call);
		const push = { relayId, kind: "data", ciphertext: CIPHERTEXT };
		await call("POST", "/v1/push", push);
		await call("POST", "/v1/push", push);
		advance(60_000);
		const refused = await call("POST", "/v1/push", push);
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(60);
	});

	test("registrations from one address stop at their limit; another address still registers", async () => {
		const { call } = setup({ limits: { devicePerAddressPer10Minutes: 2 } });
		const body = { platform: "android", pushToken: ANDROID_TOKEN };
		await register(call, body);
		await register(call, body);
		const refused = await call("POST", "/v1/devices", body);
		expect(refused.status).toBe(429);

		const other = await call("POST", "/v1/devices", body, {
			"cf-connecting-ip": "203.0.113.9",
		});
		expect(other.status).toBe(201);
	});

	test("with TRUSTED_IP_HEADER none, a caller's header does not pick its bucket", async () => {
		const { call } = setup({
			limits: { devicePerAddressPer10Minutes: 1 },
			trustedIpHeader: null,
		});
		const body = { platform: "android", pushToken: ANDROID_TOKEN };
		await register(call, body);
		const refused = await call("POST", "/v1/devices", body, {
			"cf-connecting-ip": "203.0.113.9",
		});
		expect(refused.status).toBe(429);
	});

	test("pushes from one address stop at the address limit", async () => {
		const { call } = setup({ limits: { pushPerAddressPerMinute: 1 } });
		const push = {
			relayId: "Z".repeat(22),
			kind: "alert",
			ciphertext: CIPHERTEXT,
		};
		expect((await call("POST", "/v1/push", push)).status).toBe(404);
		expect((await call("POST", "/v1/push", push)).status).toBe(429);
	});
});

describe("size limits", () => {
	test("a body over 8 KB is a 413 by its Content-Length", async () => {
		const { call } = setup();
		const response = await call("POST", "/v1/devices", "x".repeat(9_000));
		expect(response.status).toBe(413);
	});

	test("a chunked body over 8 KB is a 413 without a Content-Length", async () => {
		const { store } = setup();
		const relay = createRelay({
			store,
			senders: {
				ios: recordingSender([]),
				android: recordingSender([]),
			},
			limiters: createLimiters(DEFAULT_LIMITS),
			trustedIpHeader: null,
			log: () => {},
			now: () => 0,
		});
		const chunk = new TextEncoder().encode("x".repeat(4_000));
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let i = 0; i < 3; i += 1) controller.enqueue(chunk);
				controller.close();
			},
		});
		const response = await relay(
			new Request(`${BASE}/v1/push`, { method: "POST", body: stream }),
			null,
		);
		expect(response.status).toBe(413);
	});

	test("a ciphertext over the limit is a 400", async () => {
		const { call } = setup();
		const { relayId } = await register(call);
		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "alert",
			ciphertext: "c".repeat(3_073),
		});
		expect(response.status).toBe(400);
	});

	test("a contentState over 1 KB is a 400", async () => {
		const { call } = setup();
		const { relayId } = await register(call);
		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				token: "e".repeat(64),
				event: "update",
				contentState: Object.fromEntries(
					Array.from({ length: 8 }, (_, i) => [`k${i}`, "v".repeat(200)]),
				),
			},
		});
		expect(response.status).toBe(400);
	});

	test("a sender's too_large is a 413", async () => {
		const { call } = setup({ ios: async () => ({ outcome: "too_large" }) });
		const { relayId } = await register(call);
		const response = await call("POST", "/v1/push", {
			relayId,
			kind: "alert",
			ciphertext: CIPHERTEXT,
		});
		expect(response.status).toBe(413);
	});
});

describe("routes", () => {
	test("GET /healthz answers ok", async () => {
		const { call } = setup();
		const response = await call("GET", "/healthz");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
	});

	test("an unknown path is a 404 and a wrong method a 405", async () => {
		const { call } = setup();
		expect((await call("GET", "/v2/push")).status).toBe(404);
		expect((await call("GET", "/v1/push")).status).toBe(405);
		expect((await call("GET", "/v1/devices")).status).toBe(405);
	});
});

describe("Live Activity token binding", () => {
	const ACTIVITY_A = "1".repeat(64);
	const ACTIVITY_B = "2".repeat(64);

	const bind = (
		call: ReturnType<typeof setup>["call"],
		credentials: { relayId: string; deviceSecret: string },
		liveActivityToken: string | null,
	) =>
		call(
			"PUT",
			`/v1/devices/${credentials.relayId}`,
			{ liveActivityToken },
			{ authorization: `Bearer ${credentials.deviceSecret}` },
		);

	const pushActivity = (
		call: ReturnType<typeof setup>["call"],
		relayId: string,
		token: string,
	) =>
		call("POST", "/v1/push", {
			relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: { token, event: "update", contentState: { paused: false } },
		});

	test("a bound update with the device secret succeeds", async () => {
		const { call, store } = setup();
		const device = await register(call);

		const response = await bind(call, device, ACTIVITY_A);

		expect(response.status).toBe(200);
		expect(store.activityTokenOwner(ACTIVITY_A)).toBe(device.relayId);
	});

	test("an update with a wrong secret binds nothing", async () => {
		const { call, store } = setup();
		const device = await register(call);

		const response = await bind(
			call,
			{ relayId: device.relayId, deviceSecret: "wrong-secret-value" },
			ACTIVITY_A,
		);

		expect(response.status).toBe(401);
		expect(store.activityTokenOwner(ACTIVITY_A)).toBeNull();
	});

	test("an update for another device's token is refused and changes nothing", async () => {
		const { call, store } = setup();
		const first = await register(call);
		const second = await register(call);
		await bind(call, first, ACTIVITY_A);

		const response = await call(
			"PUT",
			`/v1/devices/${second.relayId}`,
			{ liveActivityToken: ACTIVITY_A, pushToken: "d".repeat(64) },
			{ authorization: `Bearer ${second.deviceSecret}` },
		);

		expect(response.status).toBe(409);
		expect(await errorOf(response)).toBe("activity_token_bound_elsewhere");
		expect(store.activityTokenOwner(ACTIVITY_A)).toBe(first.relayId);
		expect(store.find(second.relayId)?.pushToken).toBe(IOS_TOKEN);
	});

	test("the first device's secret cannot bind a token to the second device", async () => {
		const { call, store } = setup();
		const first = await register(call);
		const second = await register(call);

		const response = await call(
			"PUT",
			`/v1/devices/${second.relayId}`,
			{ liveActivityToken: ACTIVITY_A },
			{ authorization: `Bearer ${first.deviceSecret}` },
		);

		expect(response.status).toBe(401);
		expect(store.activityTokens(second.relayId)).toEqual([]);
	});

	test("an Android device cannot bind a Live Activity token", async () => {
		const { call } = setup();
		const device = await register(call, {
			platform: "android",
			pushToken: ANDROID_TOKEN,
		});

		const response = await bind(call, device, ACTIVITY_A);

		expect(response.status).toBe(400);
	});

	test("a null token unbinds every token of the device", async () => {
		const { call, store } = setup();
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);
		await bind(call, device, ACTIVITY_B);

		await bind(call, device, null);

		expect(store.activityTokens(device.relayId)).toEqual([]);
	});

	test("removing a device removes its tokens, and not the tokens of another", async () => {
		const { call, store } = setup();
		const first = await register(call);
		const second = await register(call);
		await bind(call, first, ACTIVITY_A);
		await bind(call, second, ACTIVITY_B);

		const response = await call(
			"DELETE",
			`/v1/devices/${first.relayId}`,
			undefined,
			{
				authorization: `Bearer ${first.deviceSecret}`,
			},
		);

		expect(response.status).toBe(204);
		expect(store.activityTokenOwner(ACTIVITY_A)).toBeNull();
		expect(store.activityTokenOwner(ACTIVITY_B)).toBe(second.relayId);
	});

	test("a device that the relay prunes loses its tokens", async () => {
		const { call, store } = setup();
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);

		store.pruneUnseenSince(Number.MAX_SAFE_INTEGER);

		expect(store.activityTokenOwner(ACTIVITY_A)).toBeNull();
	});

	test("a dead device removes its tokens", async () => {
		const { call, store } = setup({
			ios: async () => ({ outcome: "device_gone" }),
		});
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);

		await call("POST", "/v1/push", {
			relayId: device.relayId,
			kind: "alert",
			ciphertext: CIPHERTEXT,
		});

		expect(store.activityTokenOwner(ACTIVITY_A)).toBeNull();
	});

	test("a new APNs environment unbinds the tokens", async () => {
		const { call, store } = setup();
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);

		await call(
			"PUT",
			`/v1/devices/${device.relayId}`,
			{ apnsEnvironment: "production" },
			{ authorization: `Bearer ${device.deviceSecret}` },
		);

		expect(store.activityTokens(device.relayId)).toEqual([]);
	});

	test("a device keeps at most four tokens, and the oldest go first", async () => {
		const { call, store, advance } = setup();
		const device = await register(call);
		for (const digit of ["1", "2", "3", "4", "5"]) {
			advance(1_000);
			await bind(call, device, digit.repeat(64));
		}

		expect(store.activityTokens(device.relayId)).toEqual(
			["5", "4", "3", "2"].map((digit) => digit.repeat(64)),
		);
	});

	test("a push sends to a token that the device bound", async () => {
		const { call, sent } = setup();
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);

		const response = await pushActivity(call, device.relayId, ACTIVITY_A);

		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.device.relayId).toBe(device.relayId);
		expect(sent[0]?.push.liveActivity?.token).toBe(ACTIVITY_A);
	});

	test("a push for one device refuses the token of another device", async () => {
		const { call, sent } = setup();
		const first = await register(call);
		const second = await register(call);
		await bind(call, second, ACTIVITY_B);

		const response = await pushActivity(call, first.relayId, ACTIVITY_B);

		expect(response.status).toBe(403);
		expect(await errorOf(response)).toBe("activity_token_mismatch");
		expect(sent).toHaveLength(0);
	});

	test("an unbound token is refused", async () => {
		const { call, sent } = setup();
		const device = await register(call);

		const response = await pushActivity(call, device.relayId, ACTIVITY_A);

		expect(response.status).toBe(403);
		expect(await errorOf(response)).toBe("activity_token_unbound");
		expect(sent).toHaveLength(0);
	});

	test("a dead activity token is unbound", async () => {
		const { call, store } = setup({
			ios: async () => ({ outcome: "activity_gone" }),
		});
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);

		await pushActivity(call, device.relayId, ACTIVITY_A);

		expect(store.activityTokens(device.relayId)).toEqual([]);
	});

	test("a delivered end event unbinds the token", async () => {
		const { call, store } = setup();
		const device = await register(call);
		await bind(call, device, ACTIVITY_A);

		await call("POST", "/v1/push", {
			relayId: device.relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: { token: ACTIVITY_A, event: "end", contentState: {} },
		});

		expect(store.activityTokens(device.relayId)).toEqual([]);
	});

	test("a push-to-start uses the start token of its own device", async () => {
		const { call, sent } = setup();
		const first = await register(call);
		await register(call, {
			platform: "ios",
			pushToken: IOS_TOKEN,
			liveActivityPushToStartToken: "f".repeat(64),
		});

		await call("POST", "/v1/push", {
			relayId: first.relayId,
			kind: "liveactivity",
			ciphertext: CIPHERTEXT,
			liveActivity: {
				event: "start",
				contentState: {},
				attributesType: "TimerAttributes",
				attributes: { version: 1 },
			},
		});

		expect(sent[0]?.device.liveActivityStartToken).toBe(START_TOKEN);
	});
});
