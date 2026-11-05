// The exchange code of the mobile sign-in (ADR 0005): single use, a short
// life, the verifier, and a redirect that never carries the session and
// goes to the confirmation page first.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq, like } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { session, user, verification } from "../db/schema/auth";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";
import {
	challengeFor,
	EXCHANGE_TTL_MS,
	mintExchangeCode,
	peekConfirmation,
	redeemExchangeCode,
	rewriteExchangeRedirect,
} from "./mobile-exchange";

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
});

afterAll(async () => {
	await harness.close();
});

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const OTHER_VERIFIER = "x".repeat(43);

let sessionId = "";
const TOKEN = "session-token-1";

beforeEach(async () => {
	await db.delete(verification);
	await db.delete(session);
	await db.delete(user);
	await db.insert(user).values({
		id: "u-exchange",
		name: "Member",
		email: "exchange@example.com",
		emailVerified: true,
	});
	sessionId = "s-exchange";
	await db.insert(session).values({
		id: sessionId,
		token: TOKEN,
		userId: "u-exchange",
		expiresAt: new Date(Date.now() + 86_400_000),
	});
});

const post = (body: Record<string, string>) =>
	auth.handler(
		new Request("http://localhost:3000/api/auth/mobile/exchange", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

describe("the exchange", () => {
	test("gives the session token for the code and the verifier", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		expect(await redeemExchangeCode(code, VERIFIER)).toBe(TOKEN);
	});

	test("works once", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		expect(await redeemExchangeCode(code, VERIFIER)).toBe(TOKEN);
		expect(await redeemExchangeCode(code, VERIFIER)).toBeNull();
	});

	test("two requests at once get one session between them", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		const results = await Promise.all([
			redeemExchangeCode(code, VERIFIER),
			redeemExchangeCode(code, VERIFIER),
		]);
		expect(results.filter((token) => token !== null)).toHaveLength(1);
	});

	test("expires", async () => {
		const now = new Date();
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER), now);
		const late = new Date(now.getTime() + EXCHANGE_TTL_MS + 1);
		expect(await redeemExchangeCode(code, VERIFIER, late)).toBeNull();
	});

	test("refuses a wrong verifier, and burns only that code", async () => {
		const first = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		const second = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		expect(await redeemExchangeCode(first, OTHER_VERIFIER)).toBeNull();
		expect(await redeemExchangeCode(first, VERIFIER)).toBeNull();
		expect(await redeemExchangeCode(second, VERIFIER)).toBe(TOKEN);
	});

	test("refuses an unknown code", async () => {
		expect(await redeemExchangeCode("nope", VERIFIER)).toBeNull();
	});

	test("refuses a session that ended after the code was made", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		await db.delete(session).where(eq(session.id, sessionId));
		expect(await redeemExchangeCode(code, VERIFIER)).toBeNull();
	});

	test("stores only a hash of the code", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		const rows = await db
			.select()
			.from(verification)
			.where(like(verification.identifier, "mobile-exchange:%"));
		expect(rows).toHaveLength(1);
		const row = present(rows[0], "the code row");
		expect(row.identifier).not.toContain(code);
		expect(row.value).not.toContain(code);
		expect(row.value).not.toContain(TOKEN);
	});

	test("removes the rows that expired when it makes a new code", async () => {
		const old = new Date(Date.now() - 10 * EXCHANGE_TTL_MS);
		await mintExchangeCode(sessionId, challengeFor(VERIFIER), old);
		await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		expect(await db.select().from(verification)).toHaveLength(1);
	});
});

describe("POST /mobile/exchange", () => {
	test("answers the token, and the same answer for every refusal", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		const ok = await post({ code, verifier: VERIFIER });
		expect(ok.status).toBe(200);
		expect(z.object({ token: z.string() }).parse(await ok.json())).toEqual({
			token: TOKEN,
		});

		const fresh = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		const refusals = [
			await post({ code: fresh, verifier: OTHER_VERIFIER }),
			await post({ code, verifier: VERIFIER }),
			await post({ code: "unknown", verifier: VERIFIER }),
		];
		const bodies = [];
		for (const response of refusals) {
			expect(response.status).toBe(400);
			bodies.push(await response.json());
		}
		expect(bodies[0]).toEqual(bodies[1]);
		expect(bodies[1]).toEqual(bodies[2]);
		expect(bodies[0]).toMatchObject({ code: "INVALID_EXCHANGE" });
	});

	test("refuses a body with no verifier", async () => {
		const code = await mintExchangeCode(sessionId, challengeFor(VERIFIER));
		expect((await post({ code })).status).toBe(400);
		expect(await redeemExchangeCode(code, VERIFIER)).toBe(TOKEN);
	});
});

describe("the redirect", () => {
	const SET_COOKIE = `better-auth.session_token=${TOKEN}.sig; Path=/`;
	const CONFIRM = "http://localhost:3000/api/auth/mobile/confirm";
	const linkWith = (extra: Record<string, string>) => {
		const url = new URL("farmer://auth-callback?flow=n-1");
		for (const [key, value] of Object.entries(extra)) {
			url.searchParams.set(key, value);
		}
		return url.toString();
	};

	test("goes to the confirmation page, with no code and no session", async () => {
		const challenge = challengeFor(VERIFIER);
		const out = await rewriteExchangeRedirect(
			linkWith({ cc: challenge, cookie: SET_COOKIE }),
			sessionId,
			CONFIRM,
		);
		const url = new URL(present(out, "the rewritten link"));
		expect(`${url.origin}${url.pathname}`).toBe(CONFIRM);
		expect([...url.searchParams.keys()]).toEqual(["id"]);
		expect(url.toString()).not.toContain(TOKEN);
		const pending = present(
			await peekConfirmation(present(url.searchParams.get("id"), "id")),
			"the pending confirmation",
		);
		expect(pending).toEqual({
			challenge,
			sessionId,
			link: "farmer://auth-callback?flow=n-1",
		});
	});

	test("stores only a hash of the confirmation id", async () => {
		const out = await rewriteExchangeRedirect(
			linkWith({ cc: challengeFor(VERIFIER), cookie: SET_COOKIE }),
			sessionId,
			CONFIRM,
		);
		const id = present(
			new URL(present(out, "link")).searchParams.get("id"),
			"id",
		);
		const rows = await db
			.select()
			.from(verification)
			.where(like(verification.identifier, "mobile-confirm:%"));
		const row = present(rows[0], "the confirmation row");
		expect(row.identifier).not.toContain(id);
		expect(row.value).not.toContain(id);
		expect(row.value).not.toContain(TOKEN);
	});

	test("drops the session when the challenge is not a challenge", async () => {
		const out = await rewriteExchangeRedirect(
			linkWith({ cc: "short", cookie: SET_COOKIE }),
			sessionId,
			CONFIRM,
		);
		const url = new URL(present(out, "the rewritten link"));
		expect(url.toString()).not.toContain(TOKEN);
		expect(url.searchParams.get("error")).toBe("exchange_failed");
		expect(url.searchParams.has("code")).toBe(false);
	});

	test("drops the session when no new session is known", async () => {
		const out = await rewriteExchangeRedirect(
			linkWith({ cc: challengeFor(VERIFIER), cookie: SET_COOKIE }),
			null,
			CONFIRM,
		);
		const url = new URL(present(out, "the rewritten link"));
		expect(url.toString()).not.toContain(TOKEN);
		expect(url.searchParams.get("error")).toBe("exchange_failed");
		expect(url.searchParams.has("code")).toBe(false);
	});

	test("never leaves the cookie when the link has no challenge", async () => {
		const out = await rewriteExchangeRedirect(
			linkWith({ cookie: SET_COOKIE }),
			sessionId,
			CONFIRM,
		);
		const url = new URL(present(out, "the rewritten link"));
		expect(url.toString()).not.toContain(TOKEN);
		expect(url.searchParams.has("cookie")).toBe(false);
		expect(url.searchParams.get("error")).toBe("exchange_failed");
		expect(url.searchParams.has("code")).toBe(false);
	});

	test("keeps the error of a refused sign-in, with no cookie or code", async () => {
		// The callback of a refusal still sets a cookie (the state cookie).
		const out = await rewriteExchangeRedirect(
			linkWith({
				cc: challengeFor(VERIFIER),
				cookie: SET_COOKIE,
				error: "This_instance_does_not_accept_new_accounts.",
			}),
			null,
			CONFIRM,
		);
		const url = new URL(present(out, "the rewritten link"));
		expect(url.searchParams.get("error")).toBe(
			"This_instance_does_not_accept_new_accounts.",
		);
		expect(url.searchParams.has("cookie")).toBe(false);
		expect(url.searchParams.has("cc")).toBe(false);
		expect(url.searchParams.has("code")).toBe(false);
	});

	test("leaves a web redirect alone", async () => {
		expect(
			await rewriteExchangeRedirect(
				"https://x.example/?cc=a&cookie=b",
				sessionId,
				CONFIRM,
			),
		).toBeNull();
	});

	test("the plugin runs after expo()", () => {
		const ids = (auth.options.plugins ?? []).map((plugin) => plugin.id);
		expect(ids.indexOf("mobile-exchange")).toBeGreaterThan(ids.indexOf("expo"));
	});
});
