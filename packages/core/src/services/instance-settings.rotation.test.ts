// `refreshInstanceSettings`, on the reseal after a BETTER_AUTH_SECRETS
// rotation: a stored secret that is not under the current key is rewritten
// in the background, and the read never waits for it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { instanceOAuthProvider, instanceSetting } from "../db/schema/instance";
import { setting } from "../lib/instance-settings";
import { openSecret, sealSecret } from "../lib/secret-box";
import { createTestDb, present, type TestDb } from "../test/harness";
import {
	enabledOAuthProviders,
	instanceSettingsService,
	refreshInstanceSettings,
} from "./instance-settings.service";

const ROTATION = "2:the-second-secret-in-the-rotation-set";

let harness: TestDb;
let originalRotation: string | undefined;
let originalResend: string | undefined;

beforeAll(async () => {
	harness = await createTestDb();
	originalRotation = process.env.BETTER_AUTH_SECRETS;
	originalResend = process.env.RESEND_API_KEY;
	delete process.env.BETTER_AUTH_SECRETS;
	delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
	const restore = (name: string, value: string | undefined) => {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	};
	restore("BETTER_AUTH_SECRETS", originalRotation);
	restore("RESEND_API_KEY", originalResend);
	// The loaded snapshot is process state, and the next test file shares the
	// process. Load it again from empty tables, or this file's provider shows
	// up in another file's sign-in methods.
	await db.delete(instanceOAuthProvider);
	await db.delete(instanceSetting);
	await refreshInstanceSettings({ force: true });
	await harness.close();
});

/** The reseal is not awaited by the loader, so wait for the row to change. */
const eventually = async <T>(
	read: () => Promise<T>,
	done: (v: T) => boolean,
) => {
	for (let i = 0; i < 50; i++) {
		const value = await read();
		if (done(value)) return value;
		await Bun.sleep(10);
	}
	return read();
};

describe("refreshInstanceSettings after a rotation", () => {
	test("reseals a setting and an OAuth secret under the current version", async () => {
		// Written before the rotation: enc:v1, under BETTER_AUTH_SECRET.
		const oldKey = sealSecret("re_old_key");
		const oldClient = sealSecret("client-secret");
		expect(oldKey.startsWith("enc:v1:")).toBe(true);
		await db
			.insert(instanceSetting)
			.values({ name: "RESEND_API_KEY", value: oldKey });
		await db.insert(instanceOAuthProvider).values({
			providerId: "authentik",
			name: "Authentik",
			baseUrl: "https://auth.example.com",
			clientId: "farmer",
			clientSecret: oldClient,
		});

		process.env.BETTER_AUTH_SECRETS = ROTATION;
		await refreshInstanceSettings({ force: true });
		// The read answers from the old value straight away.
		expect(setting("RESEND_API_KEY")).toBe("re_old_key");
		expect(enabledOAuthProviders()[0]?.clientSecret).toBe("client-secret");

		const row = await eventually(
			async () =>
				present(
					await db.query.instanceSetting.findFirst({
						where: eq(instanceSetting.name, "RESEND_API_KEY"),
					}),
					"the RESEND_API_KEY row",
				),
			(r) => r.value !== oldKey,
		);
		expect(row.value.startsWith("enc:v2:2:")).toBe(true);
		expect(openSecret(row.value)).toBe("re_old_key");

		const provider = await eventually(
			async () =>
				present(
					await db.query.instanceOAuthProvider.findFirst({
						where: eq(instanceOAuthProvider.providerId, "authentik"),
					}),
					"the provider row",
				),
			(r) => r.clientSecret !== oldClient,
		);
		expect(provider.clientSecret.startsWith("enc:v2:2:")).toBe(true);
		expect(openSecret(provider.clientSecret)).toBe("client-secret");
	});
});

describe("a disabled provider", () => {
	test("is resealed too, so it still opens when it is switched on", async () => {
		delete process.env.BETTER_AUTH_SECRETS;
		const oldClient = sealSecret("dormant-secret");
		await db.insert(instanceOAuthProvider).values({
			providerId: "dormant",
			name: "Dormant",
			baseUrl: "https://dormant.example.com",
			clientId: "farmer",
			clientSecret: oldClient,
			enabled: false,
		});

		process.env.BETTER_AUTH_SECRETS = ROTATION;
		await refreshInstanceSettings({ force: true });
		expect(
			enabledOAuthProviders().some((p) => p.providerId === "dormant"),
		).toBe(false);
		const row = await eventually(
			async () =>
				present(
					await db.query.instanceOAuthProvider.findFirst({
						where: eq(instanceOAuthProvider.providerId, "dormant"),
					}),
					"the dormant row",
				),
			(r) => r.clientSecret !== oldClient,
		);
		expect(row.clientSecret.startsWith("enc:v2:2:")).toBe(true);
	});
});

describe("a secret under a retired key", () => {
	test("reads as unreadable, not as set and not as empty", async () => {
		process.env.BETTER_AUTH_SECRETS = ROTATION;
		await db.delete(instanceSetting);
		await db
			.insert(instanceSetting)
			.values({ name: "RESEND_API_KEY", value: sealSecret("re_retired") });
		await db.insert(instanceOAuthProvider).values({
			providerId: "retired",
			name: "Retired",
			baseUrl: "https://retired.example.com",
			clientId: "farmer",
			clientSecret: sealSecret("retired-secret"),
		});

		// Version 2 is retired: nothing sealed under it opens any more.
		process.env.BETTER_AUTH_SECRETS = "3:the-third-secret-in-the-rotation-set";
		await refreshInstanceSettings({ force: true });

		expect(setting("RESEND_API_KEY")).toBeUndefined();
		const view = present(
			(await instanceSettingsService.view()).find(
				(row) => row.name === "RESEND_API_KEY",
			),
			"the RESEND_API_KEY view",
		);
		expect(view).toMatchObject({ unreadable: true, secretHint: null });

		const provider = present(
			(await instanceSettingsService.listOAuthProviders()).find(
				(row) => row.providerId === "retired",
			),
			"the retired provider",
		);
		expect(provider).toMatchObject({ enabled: true, secretHint: null });
		expect(
			enabledOAuthProviders().some((p) => p.providerId === "retired"),
		).toBe(false);
	});
});
