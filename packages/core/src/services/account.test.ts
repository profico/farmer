// Sign-in methods and the guarded Google unlink.
//
// Reads the `account` table directly; the OAuth link itself (adding a Google
// or password identity) is better-auth's, runs over HTTP, and is not tested
// here. What is pinned is the lockout rule: unlinking Google is refused while
// it is the person's only way in, and the unlink touches exactly one row of
// exactly one person. Integration rows ("github", "google-calendar") are data
// access, not login, and must never read as a sign-in method.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { account, organization, user } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { accountService } from "./account.service";
import type { Ctx } from "./types";

const ORG = "ac-org";
const GOOGLE_ONLY = "u-ac-google-only";
const BOTH = "u-ac-both";
const INTEGRATIONS_ONLY = "u-ac-integrations";
const OTHER = "u-ac-other";

let harness: TestDb;

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

const providersOf = async (userId: string) =>
	(
		await db.query.account.findMany({
			where: eq(account.userId, userId),
			columns: { providerId: true },
		})
	)
		.map((r) => r.providerId)
		.sort();

beforeAll(async () => {
	harness = await createTestDb();

	await db
		.insert(organization)
		.values({ id: ORG, name: "Accounts", slug: ORG, createdAt: new Date() });
	await db.insert(user).values(
		[GOOGLE_ONLY, BOTH, INTEGRATIONS_ONLY, OTHER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	const rows: [string, string][] = [
		[GOOGLE_ONLY, "google"],
		[BOTH, "google"],
		[BOTH, "credential"],
		[BOTH, "github"],
		[INTEGRATIONS_ONLY, "github"],
		[INTEGRATIONS_ONLY, "google-calendar"],
		[OTHER, "google"],
	];
	await db.insert(account).values(
		rows.map(([userId, providerId]) => ({
			id: `acc-${userId}-${providerId}`,
			accountId: `${providerId}-${userId}`,
			providerId,
			userId,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

describe("signInMethods", () => {
	test("reports Google and a password from the caller's own rows", async () => {
		expect(await accountService.signInMethods(ctx(GOOGLE_ONLY))).toEqual({
			hasPassword: false,
			google: { linked: true },
		});
		expect(await accountService.signInMethods(ctx(BOTH))).toEqual({
			hasPassword: true,
			google: { linked: true },
		});
	});

	test("integration connections are not sign-in methods", async () => {
		expect(await accountService.signInMethods(ctx(INTEGRATIONS_ONLY))).toEqual({
			hasPassword: false,
			google: { linked: false },
		});
	});
});

describe("unlinkGoogle", () => {
	test("refused while Google is the only way to sign in, and the row survives", async () => {
		await expect(accountService.unlinkGoogle(ctx(GOOGLE_ONLY))).rejects.toThrow(
			"Set a password before disconnecting Google",
		);
		expect(await providersOf(GOOGLE_ONLY)).toEqual(["google"]);
	});

	test("with a password set, removes only the caller's Google row", async () => {
		await accountService.unlinkGoogle(ctx(BOTH));
		expect(await providersOf(BOTH)).toEqual(["credential", "github"]);
		expect(await providersOf(OTHER)).toEqual(["google"]);
		expect(await providersOf(GOOGLE_ONLY)).toEqual(["google"]);
	});

	test("with no Google row it is a no-op that leaves integrations alone", async () => {
		await accountService.unlinkGoogle(ctx(INTEGRATIONS_ONLY));
		expect(await providersOf(INTEGRATIONS_ONLY)).toEqual([
			"github",
			"google-calendar",
		]);
	});
});
