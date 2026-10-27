// A ban or a revocation of all sessions ends a person's MCP access
// (`./mcp-ban.ts`). Through `auth.handler`, so the hooks run where they run
// in production.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import {
	oauthAccessToken,
	oauthApplication,
	user,
	verification,
} from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { createTestDb, type TestDb } from "../test/harness";
import { auth } from "./index";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";
const CLIENT_ID = "mcp-ban-client";

let harness: TestDb;
let admin: { id: string; cookie: string };
let victim: { id: string; cookie: string };

const cookiesOf = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");

const signUp = async (email: string) => {
	const response = await auth.api.signUpEmail({
		body: { name: email, email, password: PASSWORD },
		asResponse: true,
	});
	const body = await response.json();
	return { id: String(body.user.id), cookie: cookiesOf(response) };
};

const post = (path: string, cookie: string, body: Record<string, string | boolean>) =>
	auth.handler(
		new Request(`${ORIGIN}/api/auth${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: ORIGIN, cookie },
			body: JSON.stringify(body),
		}),
	);

/** An access token and a refresh token for the person, as the plugin stores them. */
const giveToken = async (userId: string) => {
	const id = crypto.randomUUID();
	await db.insert(oauthAccessToken).values({
		id,
		accessToken: `access-${id}`,
		refreshToken: `refresh-${id}`,
		accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
		refreshTokenExpiresAt: new Date(Date.now() + 604_800_000),
		clientId: CLIENT_ID,
		userId,
		scopes: "openid offline_access",
	});
	return `refresh-${id}`;
};

const tokenCount = async (userId: string) =>
	(
		await db
			.select({ id: oauthAccessToken.id })
			.from(oauthAccessToken)
			.where(eq(oauthAccessToken.userId, userId))
	).length;

beforeAll(async () => {
	harness = await createTestDb();
	setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
	// The first account operates the instance.
	admin = await signUp("admin@example.com");
	victim = await signUp("victim@example.com");
	await db.insert(oauthApplication).values({
		id: CLIENT_ID,
		clientId: CLIENT_ID,
		name: "Claude Code",
		redirectUrls: "http://127.0.0.1:33418/callback",
		type: "public",
		disabled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

describe("an admin ban", () => {
	test("deletes the person's MCP tokens", async () => {
		await giveToken(victim.id);
		const response = await post("/admin/ban-user", admin.cookie, {
			userId: victim.id,
		});
		expect(response.status).toBe(200);
		expect(await tokenCount(victim.id)).toBe(0);
	});

	test("from a caller who is not an admin deletes nothing", async () => {
		const other = await signUp("other@example.com");
		await giveToken(admin.id);
		const response = await post("/admin/ban-user", other.cookie, {
			userId: admin.id,
		});
		expect(response.ok).toBe(false);
		expect(await tokenCount(admin.id)).toBe(1);
	});
});

describe("ending sessions", () => {
	test("all sessions of the person delete the MCP tokens", async () => {
		const person = await signUp("everywhere@example.com");
		await giveToken(person.id);
		const response = await post("/revoke-sessions", person.cookie, {});
		expect(response.status).toBe(200);
		expect(await tokenCount(person.id)).toBe(0);
	});

	test("all other sessions delete the MCP tokens", async () => {
		const person = await signUp("others@example.com");
		await giveToken(person.id);
		const response = await post("/revoke-other-sessions", person.cookie, {});
		expect(response.status).toBe(200);
		expect(await tokenCount(person.id)).toBe(0);
	});

	test("a password change that revokes other sessions deletes the tokens", async () => {
		const person = await signUp("change@example.com");
		await giveToken(person.id);
		const response = await post("/change-password", person.cookie, {
			currentPassword: PASSWORD,
			newPassword: "another horse battery",
			revokeOtherSessions: true,
		});
		expect(response.status).toBe(200);
		expect(await tokenCount(person.id)).toBe(0);
	});

	test("a password change that keeps other sessions keeps the tokens", async () => {
		const person = await signUp("keep@example.com");
		await giveToken(person.id);
		const response = await post("/change-password", person.cookie, {
			currentPassword: PASSWORD,
			newPassword: "another horse battery",
		});
		expect(response.status).toBe(200);
		expect(await tokenCount(person.id)).toBe(1);
	});

	test("a password reset deletes the MCP tokens", async () => {
		const person = await signUp("reset@example.com");
		await giveToken(person.id);
		await db.insert(verification).values({
			id: crypto.randomUUID(),
			identifier: "reset-password:reset-token",
			value: person.id,
			expiresAt: new Date(Date.now() + 3_600_000),
		});
		const response = await post("/reset-password", "", {
			token: "reset-token",
			newPassword: "another horse battery",
		});
		expect(response.status).toBe(200);
		expect(await tokenCount(person.id)).toBe(0);
	});

	test("a plain sign-out keeps the MCP tokens", async () => {
		const person = await signUp("browser@example.com");
		await giveToken(person.id);
		const response = await post("/sign-out", person.cookie, {});
		expect(response.status).toBe(200);
		expect(await tokenCount(person.id)).toBe(1);
	});
});

describe("a refresh grant", () => {
	const refresh = (refreshToken: string) =>
		auth.handler(
			new Request(`${ORIGIN}/api/auth/mcp/token`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: CLIENT_ID,
				}),
			}),
		);

	test("is refused for a banned person", async () => {
		const person = await signUp("banned@example.com");
		const refreshToken = await giveToken(person.id);
		await db.update(user).set({ banned: true }).where(eq(user.id, person.id));
		const response = await refresh(refreshToken);
		expect(response.status).toBe(401);
		expect((await response.json()).error).toBe("invalid_grant");
	});

	test("is not refused for a person who is not banned", async () => {
		const person = await signUp("fine@example.com");
		const refreshToken = await giveToken(person.id);
		const response = await refresh(refreshToken);
		expect(response.status).toBe(200);
	});
});
