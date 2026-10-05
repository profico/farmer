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
import { eq } from "drizzle-orm";

import { db } from "../db";
import { session, user } from "../db/schema/auth";
import { mobileDevice } from "../db/schema/mobile";
import { createTestDb, type TestDb } from "../test/harness";
import { mobileDevicesService } from "./mobile-devices.service";

const ME = "user-mobile-me";
const OTHER = "user-mobile-other";
const HOUR = 3600 * 1000;

let harness: TestDb;
let publicKey = "";

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

const input = (
	overrides: Partial<{ installationId: string; relayId: string }> = {},
) => ({
	installationId: "install-0001",
	platform: "ios" as const,
	relayId: "relay-aaaaaaaaaaaaaaaa",
	publicKey,
	appVersion: "1.0.0",
	notificationsAllowed: true,
	...overrides,
});

const rowsOf = (userId: string) =>
	db.select().from(mobileDevice).where(eq(mobileDevice.userId, userId));

beforeAll(async () => {
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
	await db.delete(mobileDevice);
	await db.delete(session);
});

afterAll(async () => {
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
			{ ...input({ relayId: "relay-bbbbbbbbbbbbbbbb" }), publicKey: other },
			{ sessionToken: second },
		);

		const rows = await rowsOf(ME);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			sessionId: "s2",
			relayId: "relay-bbbbbbbbbbbbbbbb",
			publicKey: other,
		});
		expect(view.notificationsAllowed).toBe(true);
	});

	test("the 64-byte key form is stored as the 65-byte point", async () => {
		const token = await addSession("s1", ME);
		const raw = (await generateDeviceKeyPair()).publicKeyRaw;
		await mobileDevicesService.register(
			{ userId: ME },
			{ ...input(), publicKey: toBase64Url(raw.subarray(1)) },
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
				{ ...input(), publicKey: notOnCurve },
				{ sessionToken: token },
			),
		).rejects.toThrow("not a P-256 point");
	});

	// One phone has one relay id. A phone that changed hands must not keep
	// the last person's pushes.
	test("a relay id registered by another person takes the phone from the first", async () => {
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
