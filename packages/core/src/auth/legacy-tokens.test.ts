// `account.encryptOAuthTokens` and the self-heal beside it: a token stored in
// plaintext before encryption was on still reads, and is encrypted the next
// time it is used.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { symmetricDecrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { account, user } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";
import { sealLegacyOAuthTokens } from "./legacy-tokens";

const USER = "u-legacy-tokens";
const ACCOUNT = "account-legacy-github";
const ACCESS = "gho_legacyPlaintextAccessToken";
const REFRESH = "ghr_legacyPlaintextRefreshToken";

let harness: TestDb;

const stored = async () =>
	present(
		await db.query.account.findFirst({
			where: eq(account.id, ACCOUNT),
			columns: { id: true, accessToken: true, refreshToken: true },
		}),
		"the account row",
	);

const open = async (value: string | null) =>
	symmetricDecrypt({
		key: (await auth.$context).secretConfig,
		data: present(value, "a stored token"),
	});

beforeAll(async () => {
	// better-auth reads a GitHub token only through a registered GitHub
	// provider, and the auth instance registers one only when the settings
	// hold its credentials. CI has none, so pin placeholder ones here.
	setInstanceSettingsForTests({
		GITHUB_CLIENT_ID: "test-client-id",
		GITHUB_CLIENT_SECRET: "test-client-secret",
	});
	harness = await createTestDb();
	await db.insert(user).values({
		id: USER,
		name: "Legacy",
		email: "legacy@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(account).values({
		id: ACCOUNT,
		accountId: "999",
		providerId: "github",
		userId: USER,
		accessToken: ACCESS,
		refreshToken: REFRESH,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

describe("legacy plaintext OAuth tokens", () => {
	test("still read through better-auth before they are sealed", async () => {
		const result = await auth.api.getAccessToken({
			body: { providerId: "github", userId: USER },
		});
		expect(result.accessToken).toBe(ACCESS);
	});

	test("are encrypted in place, and read back the same", async () => {
		await sealLegacyOAuthTokens(await stored());

		const row = await stored();
		expect(row.accessToken).not.toBe(ACCESS);
		expect(row.refreshToken).not.toBe(REFRESH);
		expect(await open(row.accessToken)).toBe(ACCESS);
		expect(await open(row.refreshToken)).toBe(REFRESH);

		const result = await auth.api.getAccessToken({
			body: { providerId: "github", userId: USER },
		});
		expect(result.accessToken).toBe(ACCESS);
	});

	test("are not encrypted twice", async () => {
		const before = await stored();
		await sealLegacyOAuthTokens(before);
		expect(await stored()).toEqual(before);
	});

	test("leave a row that changed in between alone", async () => {
		// A refresh landed after the row was read: the reseal must not put the
		// old token back.
		const stale = { id: ACCOUNT, accessToken: "gho_stale", refreshToken: null };
		const before = await stored();
		await sealLegacyOAuthTokens(stale);
		expect(await stored()).toEqual(before);
	});
});
