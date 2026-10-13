import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { PushBody } from "../schemas";
import type { Device } from "../store";
import {
	type ApnsConfig,
	ApnsTokenCache,
	apnsSender,
	buildApnsRequest,
} from "./apns";
import type { Http2Request, Http2Response } from "./http2";

const TOPIC = "com.profico.farmer";
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

const device = (change: Partial<Device> = {}): Device => ({
	relayId: "relay-id-0123456789ab",
	platform: "ios",
	pushToken: "a".repeat(64),
	apnsEnvironment: "production",
	liveActivityStartToken: "b".repeat(64),
	secretHash: "0".repeat(64),
	createdAt: NOW,
	updatedAt: NOW,
	lastSeenAt: NOW,
	...change,
});

const alert: PushBody = {
	relayId: "r".repeat(22),
	kind: "alert",
	ciphertext: "CIPHER",
};

const payloadSchema = z.object({
	aps: z
		.object({
			alert: z.object({ title: z.string(), body: z.string() }).optional(),
			"mutable-content": z.literal(1).optional(),
			"content-available": z.literal(1).optional(),
			sound: z.string().optional(),
			timestamp: z.number().optional(),
			event: z.string().optional(),
			"content-state": z.record(z.string(), z.json()).optional(),
			"stale-date": z.number().optional(),
			"attributes-type": z.string().optional(),
			attributes: z.record(z.string(), z.json()).optional(),
		})
		.strict(),
	e: z.string(),
});

const requestOf = (result: ReturnType<typeof buildApnsRequest>) => {
	if ("outcome" in result) throw new Error(`No request: ${result.outcome}`);
	return { ...result, body: payloadSchema.parse(JSON.parse(result.payload)) };
};

/** A fresh ES256 key as PKCS #8 PEM, like the `.p8` file from Apple. */
const makeKey = async () => {
	const pair = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"],
	);
	const der = Buffer.from(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey),
	).toString("base64");
	const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----`;
	return { pem, publicKey: pair.publicKey };
};

describe("buildApnsRequest", () => {
	test("an alert is a mutable-content push with a placeholder text and the ciphertext", () => {
		const request = requestOf(buildApnsRequest(device(), alert, TOPIC, NOW));
		expect(request.token).toBe("a".repeat(64));
		expect(request.headers).toEqual({
			"apns-push-type": "alert",
			"apns-priority": "10",
			"apns-topic": TOPIC,
		});
		expect(request.body).toEqual({
			aps: {
				alert: { title: "Farmer", body: "New notification" },
				"mutable-content": 1,
			},
			e: "CIPHER",
		});
	});

	test("a data push is a background push with priority 5 and no alert", () => {
		const request = requestOf(
			buildApnsRequest(device(), { ...alert, kind: "data" }, TOPIC, NOW),
		);
		expect(request.headers["apns-push-type"]).toBe("background");
		expect(request.headers["apns-priority"]).toBe("5");
		expect(request.body.aps).toEqual({ "content-available": 1 });
	});

	test("a Live Activity update goes to the activity token on the liveactivity topic", () => {
		const request = requestOf(
			buildApnsRequest(
				device(),
				{
					...alert,
					kind: "liveactivity",
					liveActivity: {
						token: "c".repeat(64),
						event: "update",
						contentState: { startedAt: 1_790_000_000, paused: false },
						staleDate: 1_790_003_600,
					},
				},
				TOPIC,
				NOW,
			),
		);
		expect(request.token).toBe("c".repeat(64));
		expect(request.headers["apns-push-type"]).toBe("liveactivity");
		expect(request.headers["apns-priority"]).toBe("5");
		expect(request.headers["apns-topic"]).toBe(
			`${TOPIC}.push-type.liveactivity`,
		);
		expect(request.body.aps).toEqual({
			timestamp: NOW / 1000,
			event: "update",
			"content-state": { startedAt: 1_790_000_000, paused: false },
			"stale-date": 1_790_003_600,
		});
		expect(request.body.e).toBe("CIPHER");
	});

	test("a Live Activity update has priority 5; a start and an end have priority 10", () => {
		const priority = (event: "start" | "update" | "end") => {
			const result = buildApnsRequest(
				device(),
				{
					...alert,
					kind: "liveactivity",
					liveActivity: { token: "c".repeat(64), event, contentState: {} },
				},
				TOPIC,
				NOW,
			);
			return "outcome" in result ? null : result.headers["apns-priority"];
		};
		expect(priority("update")).toBe("5");
		expect(priority("start")).toBe("10");
		expect(priority("end")).toBe("10");
	});

	test("a push-to-start uses the device's start token, with attributes and an alert", () => {
		const request = requestOf(
			buildApnsRequest(
				device(),
				{
					...alert,
					kind: "liveactivity",
					liveActivity: {
						event: "start",
						contentState: { startedAt: 1_790_000_000 },
						attributesType: "TimerAttributes",
						attributes: { version: 1 },
					},
				},
				TOPIC,
				NOW,
			),
		);
		expect(request.token).toBe("b".repeat(64));
		expect(request.body.aps["attributes-type"]).toBe("TimerAttributes");
		expect(request.body.aps.attributes).toEqual({ version: 1 });
		expect(request.body.aps.alert?.title).toBe("Farmer");
	});

	test("a push-to-start without a start token on the device has no request", () => {
		const result = buildApnsRequest(
			device({ liveActivityStartToken: null }),
			{
				...alert,
				kind: "liveactivity",
				liveActivity: {
					event: "start",
					contentState: {},
					attributesType: "TimerAttributes",
					attributes: {},
				},
			},
			TOPIC,
			NOW,
		);
		expect(result).toEqual({ outcome: "no_start_token" });
	});

	test("a 3 KB ciphertext with a 1 KB content state is over 4 KB, so too_large", () => {
		const result = buildApnsRequest(
			device(),
			{
				...alert,
				kind: "liveactivity",
				ciphertext: "x".repeat(3_072),
				liveActivity: {
					token: "c".repeat(64),
					event: "update",
					contentState: Object.fromEntries(
						Array.from({ length: 4 }, (_, i) => [`k${i}`, "v".repeat(240)]),
					),
				},
			},
			TOPIC,
			NOW,
		);
		expect(result).toEqual({ outcome: "too_large" });
	});
});

describe("apnsSender", () => {
	const setup = async (
		answer: (request: Http2Request, index: number) => Http2Response,
	) => {
		const key = await makeKey();
		const config: ApnsConfig = {
			keyP8: key.pem,
			keyId: "KEY123",
			teamId: "TEAM123",
			topic: TOPIC,
		};
		const requests: Http2Request[] = [];
		let clock = NOW;
		const now = () => clock;
		const send = apnsSender(
			config,
			new ApnsTokenCache(config, now),
			async (request) => {
				requests.push(request);
				return answer(request, requests.length - 1);
			},
			now,
		);
		return {
			send,
			requests,
			publicKey: key.publicKey,
			advance: (ms: number) => {
				clock += ms;
			},
		};
	};

	test("a token that is not hex is not sent", async () => {
		const { send, requests } = await setup(() => ({ status: 200, body: "" }));

		const result = await send(device({ pushToken: "../x?y#z" }), alert);

		expect(result).toMatchObject({ outcome: "failed", reason: "InvalidToken" });
		expect(requests).toHaveLength(0);
	});

	test("signs a valid ES256 provider token and sends to the device's host", async () => {
		const { send, requests, publicKey } = await setup(() => ({
			status: 200,
			body: "",
		}));

		expect(await send(device({ apnsEnvironment: "sandbox" }), alert)).toEqual({
			outcome: "delivered",
		});

		const request = requests[0];
		if (!request) throw new Error("No request was sent.");
		expect(request.origin).toBe("https://api.sandbox.push.apple.com");
		expect(request.path).toBe(`/3/device/${"a".repeat(64)}`);
		const jwt = request.headers.authorization?.replace(/^bearer /, "") ?? "";
		const [header, claims, signature] = jwt.split(".");
		expect(
			JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
		).toEqual({ kid: "KEY123", alg: "ES256" });
		expect(
			JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
		).toEqual({ iss: "TEAM123", iat: NOW / 1000 });
		const valid = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			Buffer.from(signature ?? "", "base64url"),
			new TextEncoder().encode(`${header}.${claims}`),
		);
		expect(valid).toBe(true);
	});

	test("reuses the provider token within 50 minutes and signs a new one after", async () => {
		const { send, requests, advance } = await setup(() => ({
			status: 200,
			body: "",
		}));
		await send(device(), alert);
		advance(49 * 60_000);
		await send(device(), alert);
		advance(2 * 60_000);
		await send(device(), alert);
		const [first, second, third] = requests.map(
			(request) => request.headers.authorization,
		);
		expect(second).toBe(first);
		expect(third).not.toBe(first);
	});

	test("410 on the device token is device_gone", async () => {
		const { send } = await setup(() => ({
			status: 410,
			body: '{"reason":"Unregistered","timestamp":1}',
		}));
		expect(await send(device(), alert)).toEqual({ outcome: "device_gone" });
	});

	test("410 on an activity token is activity_gone, not device_gone", async () => {
		const { send } = await setup(() => ({
			status: 410,
			body: '{"reason":"Unregistered"}',
		}));
		const result = await send(device(), {
			...alert,
			kind: "liveactivity",
			liveActivity: {
				token: "c".repeat(64),
				event: "end",
				contentState: {},
			},
		});
		expect(result).toEqual({ outcome: "activity_gone" });
	});

	test("410 on a push-to-start token is start_token_gone", async () => {
		const { send } = await setup(() => ({
			status: 410,
			body: '{"reason":"Unregistered"}',
		}));
		const result = await send(device(), {
			...alert,
			kind: "liveactivity",
			liveActivity: {
				event: "start",
				contentState: {},
				attributesType: "TimerAttributes",
				attributes: {},
			},
		});
		expect(result).toEqual({ outcome: "start_token_gone" });
	});

	test("BadDeviceToken on the device token is device_gone", async () => {
		const { send } = await setup(() => ({
			status: 400,
			body: '{"reason":"BadDeviceToken"}',
		}));
		expect(await send(device(), alert)).toEqual({ outcome: "device_gone" });
	});

	test("ExpiredProviderToken signs a new token and tries one more time", async () => {
		const { send, requests } = await setup((_, index) =>
			index === 0
				? { status: 403, body: '{"reason":"ExpiredProviderToken"}' }
				: { status: 200, body: "" },
		);
		expect(await send(device(), alert)).toEqual({ outcome: "delivered" });
		expect(requests).toHaveLength(2);
	});
});
