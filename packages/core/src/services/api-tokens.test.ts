// Preferences → API tokens.
//
// What is pinned is what makes a token safe to hand to a script: the database
// never holds the token itself, a token stops working the moment it is revoked
// or expires, one person cannot see or revoke another's, and a workspace-bound
// token remembers its workspace. `last_used_at` is pinned on its throttle,
// because a script in a loop must not write a row per request.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { API_TOKEN_PREFIX, isApiToken } from "../api/tokens";
import { db } from "../db";
import { apiToken } from "../db/schema/api-tokens";
import { organization, user } from "../db/schema/auth";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import {
	ApiTokenLimitError,
	apiTokensService,
	hashApiToken,
	MAX_API_TOKENS_PER_USER,
} from "./api-tokens.service";
import type { Ctx } from "./types";

const ORG = "at-org";
const ALICE = "u-at-alice";
const BOB = "u-at-bob";
const CAROL = "u-at-carol";

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

const DAY = 86_400_000;
const NOW = new Date("2026-09-01T09:00:00Z");

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db
		.insert(organization)
		.values({ id: ORG, name: "Acme", slug: ORG, createdAt: new Date() });
	await db.insert(user).values(
		[ALICE, BOB, CAROL].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

const make = (
	userId: string,
	overrides: Partial<Parameters<typeof apiTokensService.create>[1]> = {},
	now = NOW,
) =>
	apiTokensService.create(
		ctx(userId),
		{
			name: "Nightly export",
			scope: "read",
			workspace: "all",
			expiresInDays: null,
			...overrides,
		},
		{ now },
	);

describe("create", () => {
	test("returns a prefixed token and stores only its hash", async () => {
		const { token, apiToken: view } = await make(ALICE);

		expect(isApiToken(token)).toBe(true);
		expect(token.length).toBe(API_TOKEN_PREFIX.length + 43);
		expect(view.hint).toBe(token.slice(-4));

		const row = present(
			await db.query.apiToken.findFirst({ where: eq(apiToken.id, view.id) }),
			"the stored token",
		);
		expect(row.tokenHash).toBe(hashApiToken(token));
		expect(Object.values(row)).not.toContain(token);
	});

	test("binds the token to the workspace it was made in when asked", async () => {
		const { apiToken: bound } = await make(ALICE, { workspace: "this" });
		expect(bound.organization).toEqual({ slug: ORG, name: "Acme" });

		const { apiToken: open } = await make(ALICE, { workspace: "all" });
		expect(open.organization).toBeNull();
	});

	test("sets the expiry from the chosen lifetime", async () => {
		const { apiToken: view } = await make(ALICE, { expiresInDays: 30 });
		expect(view.expiresAt?.getTime()).toBe(NOW.getTime() + 30 * DAY);
	});

	test("refuses a token past the per-person limit", async () => {
		await db.insert(apiToken).values(
			Array.from({ length: MAX_API_TOKENS_PER_USER }, (_, i) => ({
				userId: CAROL,
				name: `t${i}`,
				tokenHash: `hash-carol-${i}`,
				hint: "abcd",
				scope: "read",
			})),
		);
		await expect(make(CAROL)).rejects.toBeInstanceOf(ApiTokenLimitError);
	});
});

describe("listMine", () => {
	test("lists only the caller's tokens, oldest first, and never the hash", async () => {
		await make(BOB, { name: "First" }, new Date(NOW.getTime() - DAY));
		await make(BOB, { name: "Second" });

		const mine = await apiTokensService.listMine(ctx(BOB), { now: NOW });
		expect(mine.map((row) => row.name)).toEqual(["First", "Second"]);
		expect(Object.keys(at(mine, 0))).not.toContain("tokenHash");

		const alices = await apiTokensService.listMine(ctx(ALICE), { now: NOW });
		const names = alices.map((row) => row.name);
		expect(names).not.toContain("First");
		expect(names).not.toContain("Second");
	});

	test("marks an expired token rather than hiding it", async () => {
		const { apiToken: view } = await make(BOB, {
			name: "Short-lived",
			expiresInDays: 30,
		});
		const later = new Date(NOW.getTime() + 31 * DAY);
		const mine = await apiTokensService.listMine(ctx(BOB), { now: later });
		const row = present(
			mine.find((entry) => entry.id === view.id),
			"the expired token",
		);
		expect(row.expired).toBe(true);
	});
});

describe("authenticate", () => {
	test("answers the owner, the scope and the workspace", async () => {
		const { token } = await make(ALICE, { scope: "write", workspace: "this" });
		const principal = present(
			await apiTokensService.authenticate(token, { now: NOW }),
			"the principal",
		);
		expect(principal.userId).toBe(ALICE);
		expect(principal.user.email).toBe(`${ALICE}@example.com`);
		expect(principal.scope).toBe("write");
		expect(principal.organizationId).toBe(ORG);
	});

	test("refuses a token nobody made", async () => {
		expect(
			await apiTokensService.authenticate(`${API_TOKEN_PREFIX}made-up`),
		).toBeNull();
	});

	test("refuses a token once it has expired", async () => {
		const { token } = await make(ALICE, { expiresInDays: 30 });
		const before = new Date(NOW.getTime() + 29 * DAY);
		const after = new Date(NOW.getTime() + 30 * DAY);
		expect(
			await apiTokensService.authenticate(token, { now: before }),
		).not.toBeNull();
		expect(
			await apiTokensService.authenticate(token, { now: after }),
		).toBeNull();
	});

	test("moves last_used_at at most once a minute", async () => {
		const { token, apiToken: view } = await make(ALICE);
		const lastUsed = async () =>
			present(
				await db.query.apiToken.findFirst({ where: eq(apiToken.id, view.id) }),
				"the token",
			).lastUsedAt;

		await apiTokensService.authenticate(token, { now: NOW });
		expect(await lastUsed()).toEqual(NOW);

		const soon = new Date(NOW.getTime() + 30_000);
		await apiTokensService.authenticate(token, { now: soon });
		expect(await lastUsed()).toEqual(NOW);

		const later = new Date(NOW.getTime() + 61_000);
		await apiTokensService.authenticate(token, { now: later });
		expect(await lastUsed()).toEqual(later);
	});
});

describe("revoke", () => {
	test("ends the caller's own token at once", async () => {
		const { token, apiToken: view } = await make(ALICE);
		expect(await apiTokensService.revoke(ctx(ALICE), view.id)).toEqual({
			revoked: true,
		});
		expect(await apiTokensService.authenticate(token)).toBeNull();
	});

	test("does nothing to another person's token, and says so like a made-up id", async () => {
		const { token, apiToken: view } = await make(ALICE);
		expect(await apiTokensService.revoke(ctx(BOB), view.id)).toEqual({
			revoked: false,
		});
		expect(
			await apiTokensService.revoke(ctx(BOB), crypto.randomUUID()),
		).toEqual({ revoked: false });
		expect(await apiTokensService.authenticate(token)).not.toBeNull();
	});

	test("revokePresented ends the token a request was made with", async () => {
		const { token } = await make(ALICE);
		const principal = present(
			await apiTokensService.authenticate(token),
			"the principal",
		);
		await apiTokensService.revokePresented(principal);
		expect(await apiTokensService.authenticate(token)).toBeNull();
	});
});
