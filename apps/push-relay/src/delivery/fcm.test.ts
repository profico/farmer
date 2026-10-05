import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { PushBody } from "../schemas";
import type { Device } from "../store";
import {
	buildFcmData,
	FcmTokenCache,
	fcmSender,
	type HttpPost,
	type ServiceAccount,
} from "./fcm";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const TOKEN_URI = "https://oauth2.googleapis.com/token";

const device: Device = {
	relayId: "relay-id-0123456789ab",
	platform: "android",
	pushToken: "fcm-registration-token-0123456789",
	apnsEnvironment: null,
	liveActivityStartToken: null,
	secretHash: "0".repeat(64),
	createdAt: NOW,
	updatedAt: NOW,
	lastSeenAt: NOW,
};

const alert: PushBody = {
	relayId: "r".repeat(22),
	kind: "alert",
	ciphertext: "CIPHER",
};

const sentMessage = z.object({
	message: z
		.object({
			token: z.string(),
			data: z.record(z.string(), z.string()),
			android: z.object({ priority: z.literal("HIGH") }),
		})
		.strict(),
});

type Call = { url: string; headers: Record<string, string>; body: string };

const makeAccount = async (): Promise<{
	account: ServiceAccount;
	publicKey: CryptoKey;
}> => {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const der = Buffer.from(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey),
	).toString("base64");
	// Service account files hold the key with escaped line breaks.
	const pem = `-----BEGIN PRIVATE KEY-----\\n${der}\\n-----END PRIVATE KEY-----\\n`;
	return {
		account: {
			project_id: "farmer-test",
			client_email: "relay@farmer-test.iam.gserviceaccount.com",
			private_key: pem,
			token_uri: TOKEN_URI,
		},
		publicKey: pair.publicKey,
	};
};

const setup = async (
	answer: (call: Call) => { status: number; body: string },
) => {
	const { account, publicKey } = await makeAccount();
	const calls: Call[] = [];
	const post: HttpPost = async (url, headers, body) => {
		calls.push({ url, headers, body });
		if (url === TOKEN_URI) {
			return {
				status: 200,
				body: JSON.stringify({
					access_token: `access-${calls.length}`,
					expires_in: 3599,
				}),
			};
		}
		return answer({ url, headers, body });
	};
	const send = fcmSender(
		account,
		new FcmTokenCache(account, post, () => NOW),
		post,
	);
	return { send, calls, publicKey };
};

describe("buildFcmData", () => {
	test("an alert is the ciphertext and the kind, all strings", () => {
		expect(buildFcmData(alert)).toEqual({ e: "CIPHER", k: "alert" });
	});

	test("Live Activity fields become strings, the content state one JSON string", () => {
		expect(
			buildFcmData({
				...alert,
				kind: "liveactivity",
				liveActivity: {
					token: "ignored-on-android",
					event: "update",
					contentState: { startedAt: 1_790_000_000, paused: false },
					staleDate: 1_790_003_600,
				},
			}),
		).toEqual({
			e: "CIPHER",
			k: "liveactivity",
			la_event: "update",
			la_content_state: '{"startedAt":1790000000,"paused":false}',
			la_stale_date: "1790003600",
		});
	});
});

describe("fcmSender", () => {
	test("exchanges a valid RS256 assertion and sends a high-priority data message", async () => {
		const { send, calls, publicKey } = await setup(() => ({
			status: 200,
			body: '{"name":"projects/farmer-test/messages/1"}',
		}));

		expect(await send(device, alert)).toEqual({ outcome: "delivered" });

		const [exchange, message] = calls;
		if (!exchange || !message) throw new Error("Expected two calls.");
		const assertion = new URLSearchParams(exchange.body).get("assertion") ?? "";
		const [header, claims, signature] = assertion.split(".");
		expect(
			JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
		).toMatchObject({
			iss: "relay@farmer-test.iam.gserviceaccount.com",
			aud: TOKEN_URI,
			scope: "https://www.googleapis.com/auth/firebase.messaging",
		});
		const valid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			publicKey,
			Buffer.from(signature ?? "", "base64url"),
			new TextEncoder().encode(`${header}.${claims}`),
		);
		expect(valid).toBe(true);

		expect(message.url).toBe(
			"https://fcm.googleapis.com/v1/projects/farmer-test/messages:send",
		);
		expect(message.headers.authorization).toBe("Bearer access-1");
		const body = sentMessage.parse(JSON.parse(message.body));
		expect(body.message.token).toBe(device.pushToken);
		expect(body.message.data).toEqual({ e: "CIPHER", k: "alert" });
	});

	test("reuses the access token for the next push", async () => {
		const { send, calls } = await setup(() => ({ status: 200, body: "{}" }));
		await send(device, alert);
		await send(device, alert);
		expect(calls.filter((call) => call.url === TOKEN_URI)).toHaveLength(1);
	});

	test("UNREGISTERED is device_gone", async () => {
		const { send } = await setup(() => ({
			status: 404,
			body: JSON.stringify({
				error: {
					code: 404,
					status: "NOT_FOUND",
					details: [
						{
							"@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
							errorCode: "UNREGISTERED",
						},
					],
				},
			}),
		}));
		expect(await send(device, alert)).toEqual({ outcome: "device_gone" });
	});

	test("INVALID_ARGUMENT is a failure, not a dead device", async () => {
		const { send } = await setup(() => ({
			status: 400,
			body: JSON.stringify({
				error: {
					status: "INVALID_ARGUMENT",
					details: [{ errorCode: "INVALID_ARGUMENT" }],
				},
			}),
		}));
		expect(await send(device, alert)).toEqual({
			outcome: "failed",
			status: 400,
			reason: "INVALID_ARGUMENT",
		});
	});

	test("a data payload over 4 KB is too_large and is not sent", async () => {
		const { send, calls } = await setup(() => ({ status: 200, body: "{}" }));
		const result = await send(device, {
			...alert,
			kind: "liveactivity",
			ciphertext: "x".repeat(3_072),
			liveActivity: {
				event: "update",
				token: "t".repeat(10),
				contentState: Object.fromEntries(
					Array.from({ length: 4 }, (_, i) => [`k${i}`, "v".repeat(240)]),
				),
			},
		});
		expect(result).toEqual({ outcome: "too_large" });
		expect(calls).toHaveLength(0);
	});
});
