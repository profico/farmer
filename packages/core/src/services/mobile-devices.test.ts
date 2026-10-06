// A phone's registration for native push (ADR 0006): which session owns the
// row, when the row goes, and who may make it.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { generateDeviceKeyPair, toBase64Url } from "@farmer/push-crypto";
import { bindingProof } from "@farmer/push-crypto/binding";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { session, user } from "../db/schema/auth";
import { mobileDevice } from "../db/schema/mobile";
import { type FakeRelay, startFakeRelay } from "../test/fake-relay";
import { createTestDb, type TestDb } from "../test/harness";
import { mobileDevicesService } from "./mobile-devices.service";

const ME = "user-mobile-me";
const OTHER = "user-mobile-other";
const HOUR = 3600 * 1000;

const RELAY_A = "relay-aaaaaaaaaaaaaaaa";
const RELAY_B = "relay-bbbbbbbbbbbbbbbb";

let harness: TestDb;
let relay: FakeRelay;
let publicKey = "";

/** The device secret that the fake relay holds for a relay id. */
const secretOf = (relayId: string) => `secret-of-${relayId}`;

const addSession = async (id: string, userId: string, expiresInMs = HOUR) => {
	await db.insert(session).values({
		id,
		token: `token-${id}`,
		userId,
		expiresAt: new Date(Date.now() + expiresInMs),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return `token-${id}`;
};

/** A registration with a proof that the secret of the relay id made. */
const input = (
	overrides: Partial<{
		installationId: string;
		relayId: string;
		publicKey: string;
		relayProof: string;
	}> = {},
) => {
	const relayId = overrides.relayId ?? RELAY_A;
	const key = overrides.publicKey ?? publicKey;
	return {
		installationId: "install-0001",
		platform: "ios" as const,
		appVersion: "1.0.0",
		notificationsAllowed: true,
		relayId,
		publicKey: key,
		relayProof: bindingProof(secretOf(relayId), relayId, key),
		...overrides,
	};
};

const rowsOf = (userId: string) =>
	db.select().from(mobileDevice).where(eq(mobileDevice.userId, userId));

beforeAll(async () => {
	relay = startFakeRelay();
	harness = await createTestDb();
	await db.insert(user).values(
		[ME, OTHER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	publicKey = toBase64Url((await generateDeviceKeyPair()).publicKeyRaw);
});

beforeEach(async () => {
	relay.reset();
	relay.registerDevice(RELAY_A, secretOf(RELAY_A));
	relay.registerDevice(RELAY_B, secretOf(RELAY_B));
	await db.delete(mobileDevice);
	await db.delete(session);
});

afterAll(async () => {
	await relay.stop();
	await harness.close();
});

describe("register", () => {
	test("the row belongs to the calling session, and a second registration replaces it", async () => {
		const first = await addSession("s1", ME);
		await mobileDevicesService.register({ userId: ME }, input(), {
			sessionToken: first,
		});

		const second = await addSession("s2", ME);
		const other = toBase64Url((await generateDeviceKeyPair()).publicKeyRaw);
		const view = await mobileDevicesService.register(
			{ userId: ME },
			input({ relayId: RELAY_B, publicKey: other }),
			{ sessionToken: second },
		);

		const rows = await rowsOf(ME);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			sessionId: "s2",
			relayId: RELAY_B,
			publicKey: other,
		});
		expect(view.notificationsAllowed).toBe(true);
	});

	test("the 64-byte key form is stored as the 65-byte point", async () => {
		const token = await addSession("s1", ME);
		const raw = (await generateDeviceKeyPair()).publicKeyRaw;
		await mobileDevicesService.register(
			{ userId: ME },
			input({ publicKey: toBase64Url(raw.subarray(1)) }),
			{ sessionToken: token },
		);
		expect((await rowsOf(ME))[0]?.publicKey).toBe(toBase64Url(raw));
	});

	test("an API token, another person's session and an expired one are refused", async () => {
		const others = await addSession("s-other", OTHER);
		const expired = await addSession("s-old", ME, -HOUR);
		for (const sessionToken of [null, others, expired]) {
			await expect(
				mobileDevicesService.register({ userId: ME }, input(), {
					sessionToken,
				}),
			).rejects.toThrow("not with an API token");
		}
		expect(await rowsOf(ME)).toHaveLength(0);
	});

	test("a key that is not a P-256 point is refused", async () => {
		const token = await addSession("s1", ME);
		const notOnCurve = toBase64Url(
			new Uint8Array([4, ...new Uint8Array(64).fill(1)]),
		);
		await expect(
			mobileDevicesService.register(
				{ userId: ME },
				input({ publicKey: notOnCurve }),
				{ sessionToken: token },
			),
		).rejects.toThrow("not a P-256 point");
	});

	// One phone has one relay id. A phone that changed hands must not keep
	// the last person's pushes. Only a phone with the proof can take the id.
	test("a person who holds the relay secret takes the phone from the first", async () => {
		await mobileDevicesService.register({ userId: ME }, input(), {
			sessionToken: await addSession("s1", ME),
		});
		await mobileDevicesService.register({ userId: OTHER }, input(), {
			sessionToken: await addSession("s2", OTHER),
		});
		expect(await rowsOf(ME)).toHaveLength(0);
		expect(await rowsOf(OTHER)).toHaveLength(1);
	});
});

describe("the relay proof", () => {
	const register = (userId: string, sessionToken: string, body = input()) =>
		mobileDevicesService.register({ userId }, body, { sessionToken });

	// The finding: a signed-in person who learns a relay id must not take it.
	test("another person cannot take a relay id without its secret", async () => {
		await register(ME, await addSession("s1", ME));
		const attackerKey = toBase64Url(
			(await generateDeviceKeyPair()).publicKeyRaw,
		);
		const attacker = await addSession("s2", OTHER);

		const guesses = [
			// A proof from a secret that the attacker made up.
			bindingProof("attacker-secret", RELAY_A, attackerKey),
			// A proof that the victim's phone made for the victim's key.
			bindingProof(secretOf(RELAY_A), RELAY_A, publicKey),
			// No usable proof at all.
			"A".repeat(43),
		];
		for (const relayProof of guesses) {
			await expect(
				register(
					OTHER,
					attacker,
					input({ publicKey: attackerKey, relayProof }),
				),
			).rejects.toThrow("does not confirm");
		}

		expect(await rowsOf(OTHER)).toHaveLength(0);
		const victim = await rowsOf(ME);
		expect(victim).toHaveLength(1);
		expect(victim[0]).toMatchObject({ relayId: RELAY_A, publicKey });
	});

	test("the same person cannot point an installation at another relay id without its secret", async () => {
		const token = await addSession("s1", ME);
		await register(ME, token);
		await expect(
			register(
				ME,
				token,
				input({
					relayId: RELAY_B,
					relayProof: bindingProof("wrong", RELAY_B, publicKey),
				}),
			),
		).rejects.toThrow("does not confirm");
		expect((await rowsOf(ME))[0]?.relayId).toBe(RELAY_A);
	});

	test("an unchanged re-registration makes no relay call, and works with the relay down", async () => {
		const token = await addSession("s1", ME);
		await register(ME, token);
		expect(relay.verifications).toHaveLength(1);

		relay.failVerifyWith(503);
		const view = await register(
			ME,
			token,
			input({ relayProof: "A".repeat(43) }),
		);
		expect(view.installationId).toBe("install-0001");
		expect(relay.verifications).toHaveLength(1);
	});

	test("a relay that cannot answer refuses a new binding and keeps the old row", async () => {
		const token = await addSession("s1", ME);
		await register(ME, token);
		relay.failVerifyWith(503);
		await expect(
			register(ME, token, input({ relayId: RELAY_B })),
		).rejects.toThrow("could not check");
		expect((await rowsOf(ME))[0]?.relayId).toBe(RELAY_A);
	});

	test("a new binding is refused while push is off", async () => {
		relay.setEnabled(false);
		await expect(register(ME, await addSession("s1", ME))).rejects.toThrow(
			"Native push is off",
		);
		expect(await rowsOf(ME)).toHaveLength(0);
	});
});

describe("the session owns the row", () => {
	test("deleting the session (sign-out, revoke) deletes the phone", async () => {
		const token = await addSession("s1", ME);
		await mobileDevicesService.register({ userId: ME }, input(), {
			sessionToken: token,
		});
		await db.delete(session).where(eq(session.id, "s1"));
		expect(await rowsOf(ME)).toHaveLength(0);
	});
});

describe("update and remove", () => {
	test("update sets and clears the Live Activity token, for the caller's own phone only", async () => {
		await mobileDevicesService.register({ userId: ME }, input(), {
			sessionToken: await addSession("s1", ME),
		});
		const set = await mobileDevicesService.update(
			{ userId: ME },
			{
				installationId: "install-0001",
				liveActivityToken: "abcdef0123456789",
				notificationsAllowed: false,
			},
		);
		expect(set).toMatchObject({
			liveActivity: true,
			notificationsAllowed: false,
		});
		const cleared = await mobileDevicesService.update(
			{ userId: ME },
			{ installationId: "install-0001", liveActivityToken: null },
		);
		expect(cleared.liveActivity).toBe(false);

		await expect(
			mobileDevicesService.update(
				{ userId: OTHER },
				{ installationId: "install-0001", notificationsAllowed: true },
			),
		).rejects.toThrow("Device not found");
	});

	test("remove forgets the phone, and a second remove is not an error", async () => {
		await mobileDevicesService.register({ userId: ME }, input(), {
			sessionToken: await addSession("s1", ME),
		});
		expect(
			await mobileDevicesService.remove(
				{ userId: OTHER },
				{ installationId: "install-0001" },
			),
		).toEqual({ removed: false });
		expect(
			await mobileDevicesService.remove(
				{ userId: ME },
				{ installationId: "install-0001" },
			),
		).toEqual({ removed: true });
		expect(
			await mobileDevicesService.remove(
				{ userId: ME },
				{ installationId: "install-0001" },
			),
		).toEqual({ removed: false });
	});
});
